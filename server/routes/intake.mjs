/**
 * Shared intake: whatever Ray shares into the app from WhatsApp or email
 * (and, later, an iPhone Shortcut or a forwarding address). Every route is
 * for a signed-in practice user — the share screen runs inside the app —
 * and the whole router answers 503 without a database, so browser-only
 * mode is untouched.
 *
 * The share flow: POST /batches stores and reads the share and returns
 * what it found, held back from the practice's tabs for a few minutes so
 * the share screen can correct a client (POST /activity/:id/assign) before
 * anyone sees it; Done (POST /batches/:id/release) lets it through at once.
 *
 * Emails forwarded to the practice's inbound address arrive at
 * POST /email/inbound — a Postmark webhook, authenticated by the Basic
 * credentials in its URL rather than a session. The sender must be an
 * address a user has listed (GET/PUT /email), and its SPF must have passed.
 *
 * POST /batches is also what the iPhone Shortcut calls, with a personal
 * upload key (Authorization: Bearer frk_…) and a multipart form instead of
 * JSON. That key opens this one route and nothing else, and a Shortcut
 * has no share screen, so its batches are not held. Form uploads are
 * refused on a session cookie: a multipart POST is a "simple" cross-site
 * request, so a cookie alone must not be enough to make one.
 */
import express from 'express';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { requireAuth } from './auth.mjs';
import { BODY_LIMIT_BYTES, ERROR_MESSAGES, readMultipart, SHARE_HOLD_MINUTES, shareMessage, validateBatch, validateParts } from '../lib/intake.mjs';
import { createToken, listTokens, parseBearer, revokeToken, userForToken } from '../lib/intakeTokens.mjs';
import { checkBasicAuth, emailToBatch, senderOf, spfPassed } from '../lib/inboundEmail.mjs';
import { listSenders, MAX_SENDERS, setSenders, userForSender } from '../lib/intakeSenders.mjs';
import { assignDocument, findDuplicateBatch, markActivityApplied, pendingActivity, queueDocument, readUpload, releaseBatch, saveBatch } from '../lib/intakeStore.mjs';
import { readBatch } from '../lib/intakeReader.mjs';
import { readPracticeSnapshot } from '../lib/briefingStore.mjs';
import { extractStatement } from '../lib/bankStatement.mjs';
import { claimStatement, failStatement, saveStatement } from '../lib/bankStore.mjs';
import { readStatementsIn } from '../lib/bankExtraction.mjs';
import { processBatch } from '../lib/intakePipeline.mjs';

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json({ configured: isDatabaseConfigured() });
});

router.use((req, res, next) => (isDatabaseConfigured() ? next() : res.status(503).json({ error: 'not_configured' })));

// A share that turns out to hold a bank statement also has its transactions read, queued behind any others.
const bankDeps = { claimStatement, failStatement, saveStatement, readUpload, extractStatement };

const fail = (res, status, error) => res.status(status).json({ error, message: ERROR_MESSAGES[error] });

// Each share is one model request — this bounds what a stolen session or key can spend.
const batchLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10, keyFor: (req) => req.user.id, name: 'rate_limited' });
// Keys are 256 random bits, so guessing one is hopeless; this just keeps a flood of bad ones cheap.
const keyAttemptLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60, keyFor: (req) => (req.get('authorization') ? req.ip : null), name: 'rate_limited' });

/** An upload key, when one is presented — and then only a valid one will do, never a fall back to the cookie. */
async function uploadAuth(req, res, next) {
  const token = parseBearer(req.get('authorization'));
  if (!token) {
    if (req.get('authorization')) return res.status(401).json({ error: 'not_authenticated' });
    return requireAuth(req, res, next);
  }
  const user = await userForToken(token);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  req.user = user;
  req.viaKey = true;
  next();
}

const readJson = express.json({ limit: BODY_LIMIT_BYTES });

/** JSON from the app; a multipart form only from a Shortcut with a key. Leaves the checked parts on req. */
async function batchBody(req, res, next) {
  if (req.is('multipart/form-data')) {
    if (!req.viaKey) return fail(res, 415, 'use_json');
    req.checked = await readMultipart(req);
    return next();
  }
  readJson(req, res, (err) => {
    if (err) return next(err);
    req.checked = validateBatch(req.body);
    next();
  });
}

router.post('/batches', keyAttemptLimiter, uploadAuth, batchLimiter, batchBody, async (req, res) => {
  if (req.checked.error) return fail(res, 400, req.checked.error);
  const result = await processBatch(
    // A Shortcut has no share screen to correct a client on, so nothing waits.
    { parts: req.checked.parts, userId: req.user.id, source: req.viaKey ? 'shortcut' : 'share', holdMinutes: req.viaKey ? 0 : SHARE_HOLD_MINUTES },
    { saveBatch, findDuplicateBatch, queueDocument, readBatch, readPracticeSnapshot },
  );
  if (result.duplicate) return fail(res, 409, 'already_shared');
  await readStatementsIn(result, bankDeps);
  res.status(201).json({ ...result, message: shareMessage(result) });
});

// A forwarded email, from Postmark. Everything that can refuse it does so
// before a byte is parsed or a model asked anything; once it passes, Postmark
// gets its 200 at once and the (slow) read carries on, so a long statement
// never makes Postmark time out and send the same email again.
const MAX_EMAIL_BODY = '50mb';
const emailDeps = { saveBatch, findDuplicateBatch, queueDocument, readBatch, readPracticeSnapshot };
const emailLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20, keyFor: (req) => req.emailUser?.id, name: 'rate_limited' });
const inboundAttemptLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 120, keyFor: (req) => req.ip, name: 'rate_limited' });

function logInbound(message, extra = {}) {
  console.log(JSON.stringify({ level: 'info', at: new Date().toISOString(), source: 'inbound-email', message, ...extra }));
}

router.post(
  '/email/inbound',
  inboundAttemptLimiter,
  (req, res, next) => {
    const credentials = { username: process.env.INBOUND_EMAIL_USERNAME, password: process.env.INBOUND_EMAIL_PASSWORD };
    if (!credentials.username || !credentials.password) return res.status(503).json({ error: 'not_configured' });
    if (!checkBasicAuth(req.get('authorization'), credentials)) return res.status(401).json({ error: 'not_authenticated' });
    next();
  },
  express.json({ limit: MAX_EMAIL_BODY }),
  async (req, res, next) => {
    // Always 200 for an email we choose not to file: Postmark retries anything else, and a retry changes nothing.
    const ignore = (reason) => {
      logInbound('Ignored an email', { reason });
      res.json({ ok: true, ignored: reason });
    };
    const sender = senderOf(req.body);
    const user = sender ? await userForSender(sender) : null;
    if (!user) return ignore('unknown_sender');
    if (process.env.INBOUND_EMAIL_REQUIRE_SPF !== '0' && !spfPassed(req.body)) return ignore('spf_failed');
    req.emailUser = user;
    next();
  },
  emailLimiter,
  async (req, res) => {
    const batch = emailToBatch(req.body);
    const checked = validateParts(batch.files, batch.text);
    if (checked.error) {
      logInbound('Ignored an email', { reason: checked.error });
      return res.json({ ok: true, ignored: checked.error });
    }
    res.json({ ok: true });
    // Nothing waits on this: a failure is logged, and every part was stored before any read could fail.
    processBatch({ parts: checked.parts, userId: req.emailUser.id, source: 'email', holdMinutes: 0 }, emailDeps).then(
      async (result) => {
        logInbound(result.duplicate ? 'Skipped a repeat of an email' : 'Filed an email', { documents: result.documents?.length ?? 0 });
        await readStatementsIn(result, bankDeps);
      },
      (err) => console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'inbound-email', message: `Could not process an email: ${err?.message ?? err}` })),
    );
  },
);

router.use(requireAuth);

router.use(express.json({ limit: '16kb' }));

router.post('/activity/:id/assign', async (req, res) => {
  const clientId = req.body?.clientId;
  if (clientId !== null && (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > 100)) return res.status(400).json({ error: 'invalid_client' });
  const changed = await assignDocument(String(req.params.id), req.user.id, clientId);
  if (!changed) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// Upload keys are made and revoked from a signed-in session only — a key can't mint another.
router.get('/tokens', async (req, res) => {
  res.json({ tokens: await listTokens(req.user.id) });
});

router.post('/tokens', async (req, res) => {
  const label = typeof req.body?.label === 'string' ? req.body.label : '';
  const made = await createToken(req.user.id, label);
  if (made.error) return res.status(409).json({ error: made.error });
  res.status(201).json(made);
});

router.delete('/tokens/:id', async (req, res) => {
  if (!(await revokeToken(String(req.params.id), req.user.id))) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// Where to forward emails, and which addresses to accept them from.
router.get('/email', async (req, res) => {
  const address = process.env.INBOUND_EMAIL_ADDRESS || null;
  const ready = Boolean(address && process.env.INBOUND_EMAIL_USERNAME && process.env.INBOUND_EMAIL_PASSWORD);
  res.json({ address: ready ? address : null, ready, senders: await listSenders(req.user.id), maxSenders: MAX_SENDERS });
});

router.put('/email/senders', async (req, res) => {
  const result = await setSenders(req.user.id, req.body?.senders);
  if (result.error === 'taken') return res.status(409).json({ error: 'taken', email: result.email });
  if (result.error) return res.status(400).json({ error: result.error, email: result.email });
  res.json({ senders: result.senders });
});

router.post('/batches/:id/release', async (req, res) => {
  res.json({ released: await releaseBatch(String(req.params.id), req.user.id) });
});

router.get('/activity', async (_req, res) => {
  res.json({ activity: await pendingActivity() });
});

router.post('/activity/ack', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
  res.json({ applied: await markActivityApplied(ids) });
});

// Inline: "View file" should open the photo or PDF in the browser. Text is
// served as text/plain with nosniff, so it can never render as markup.
router.get('/uploads/:id', async (req, res) => {
  const file = await readUpload(String(req.params.id));
  if (!file) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', file.contentType === 'text/plain' ? 'text/plain; charset=utf-8' : file.contentType);
  res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/[^\w.\- ()+]/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.content);
});

export default router;
