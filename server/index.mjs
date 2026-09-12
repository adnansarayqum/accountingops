/**
 * Production web server for Railway.
 *
 * Serves the built SPA from ./dist with an explicit health check. Designed so
 * that an API layer (tenant-scoped, PostgreSQL-backed) can be mounted under
 * /api without changing the deployment shape.
 */
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import companiesHouseRouter from './routes/companiesHouse.mjs';
import companiesHouseStreamRouter from './routes/companiesHouseStream.mjs';
import hmrcRouter from './routes/hmrc.mjs';
import portalRouter from './routes/portal.mjs';
import briefingRouter from './routes/briefing.mjs';
import { BriefingScheduler } from './lib/briefingScheduler.mjs';
import authRouter from './routes/auth.mjs';
import practiceDataRouter from './routes/practiceData.mjs';
import messagesRouter from './routes/messages.mjs';
import { healthPayload } from './lib/health.mjs';
import { securityHeaders } from './lib/securityHeaders.mjs';
import { spaFallback } from './lib/spaFallback.mjs';
import { isDatabaseConfigured } from './lib/db.mjs';
import { ensureSeedUsers } from './lib/bootstrapUsers.mjs';
import { CompaniesHouseStreamListener, isStreamConfigured } from './lib/companiesHouseStreamListener.mjs';
import { pruneAcknowledgedChanges, readStreamState } from './lib/companiesHouseStreamStore.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');
const port = Number(process.env.PORT ?? 3000);
const startedAt = new Date().toISOString();

const app = express();
app.disable('x-powered-by');

// Railway terminates TLS at its edge and forwards over plain HTTP, one hop
// away. Trusting that hop is what makes req.ip the visitor's address (for
// the login rate limits) and req.secure honest (for the Secure cookie flag
// and HSTS) rather than always reporting the proxy.
app.set('trust proxy', 1);

// On every response, API and static alike — a JSON error from /api/* is as
// much a document as index.html is, and the headers cost nothing.
app.use(securityHeaders());

// Structured request log — one line per request, no bodies, no identifiers.
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health') return;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(JSON.stringify({ level: 'info', at: new Date().toISOString(), method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) }));
  });
  next();
});

// Always 200, even when the database is unreachable: the payload carries the
// detail, and a non-200 here would make Railway restart a container that is
// perfectly healthy itself and waiting on a database it can't fix.
app.get('/health', async (_req, res) => {
  res.json({ ...(await healthPayload()), service: 'accountingops-web', startedAt, env: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? 'development', build: existsSync(path.join(dist, 'index.html')) });
});

// External integrations. Each router owns its own credentials — the
// browser only ever talks to /api/*, never to a third-party API directly.
app.use('/api/companies-house/stream', companiesHouseStreamRouter);
app.use('/api/companies-house', companiesHouseRouter);
app.use('/api/hmrc', hmrcRouter);
app.use('/api/portal', portalRouter);
app.use('/api/briefing', briefingRouter);
app.use('/api/messages', messagesRouter);

// Authentication and shared practice-data persistence. Both return 503 when
// DATABASE_URL isn't configured, so the client falls back to the original
// browser-only mode instead of getting stuck — see src/App.tsx.
app.use('/api/auth', authRouter);
app.use('/api/practice-data', practiceDataRouter);

app.use(express.static(dist, { index: false, maxAge: '1y', immutable: true, setHeaders: (res, filePath) => { if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); } }));

// SPA fallback for client-side routes; missing files and unknown API paths
// fall through to the JSON 404 below (see lib/spaFallback.mjs).
app.get('/{*splat}', spaFallback(dist));

app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

app.use((err, _req, res, _next) => {
  console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), message: err?.message ?? String(err) }));
  res.status(500).json({ error: 'Something went wrong. Nothing has been lost — try again.' });
});

// Seeded once, here, at boot — not on every request (see
// server/lib/bootstrapUsers.mjs) — so a seed account removed from the
// database stays removed until the next deploy instead of quietly
// reappearing on the next request that happens to touch auth.
if (isDatabaseConfigured()) {
  try {
    await ensureSeedUsers();
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), message: `Failed to seed practice accounts: ${err?.message ?? err}` }));
  }
}

// The Companies House stream: one long-lived connection for the whole
// process, started only when both a streaming key and a database are
// configured (it has nowhere to record what it sees otherwise). A failure
// here must never stop the web server from serving — the app works exactly
// as it did before, just without live change notifications.
let streamListener = null;
if (isStreamConfigured() && isDatabaseConfigured()) {
  try {
    const state = await readStreamState();
    streamListener = new CompaniesHouseStreamListener();
    // Deliberately not awaited: the listener runs for the life of the process.
    void streamListener.start(state.timepoint).catch((err) => {
      console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'companies_house_stream', message: `Listener stopped: ${err?.message ?? err}` }));
    });
    await pruneAcknowledgedChanges().catch(() => {});
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'companies_house_stream', message: `Could not start listener: ${err?.message ?? err}` }));
  }
} else if (isStreamConfigured()) {
  console.log(JSON.stringify({ level: 'info', at: new Date().toISOString(), source: 'companies_house_stream', message: 'Streaming key set but no database configured; listener not started.' }));
}

// The morning briefing: one timer for the process, checking each minute
// whether anyone is due their weekday email. Needs the database for who
// wants it; whether anything is actually delivered depends on the email
// provider, exactly as for reminders. Nothing here can stop the server.
let briefingScheduler = null;
if (isDatabaseConfigured()) {
  try {
    briefingScheduler = new BriefingScheduler();
    briefingScheduler.start();
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'briefing', message: `Could not start scheduler: ${err?.message ?? err}` }));
  }
}

const server = app.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', at: new Date().toISOString(), message: `accountingops web listening on ${port}` }));
});

// Graceful shutdown so Railway deploys don't drop in-flight requests.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(JSON.stringify({ level: 'info', at: new Date().toISOString(), message: `${signal} received, shutting down` }));
    void streamListener?.stop();
    briefingScheduler?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000).unref();
  });
}
