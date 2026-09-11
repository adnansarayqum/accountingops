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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');
const port = Number(process.env.PORT ?? 3000);
const startedAt = new Date().toISOString();

const app = express();
app.disable('x-powered-by');

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

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'accountingops-web', startedAt, env: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? 'development', build: existsSync(path.join(dist, 'index.html')) });
});

// Security headers appropriate for a static SPA.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(express.static(dist, { index: false, maxAge: '1y', immutable: true, setHeaders: (res, filePath) => { if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); } }));

// SPA fallback for client-side routes.
app.get('/{*splat}', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(dist, 'index.html'));
});

app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), message: err?.message ?? String(err) }));
  res.status(500).json({ error: 'Something went wrong. Nothing has been lost — try again.' });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', at: new Date().toISOString(), message: `accountingops web listening on ${port}` }));
});

// Graceful shutdown so Railway deploys don't drop in-flight requests.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(JSON.stringify({ level: 'info', at: new Date().toISOString(), message: `${signal} received, shutting down` }));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000).unref();
  });
}
