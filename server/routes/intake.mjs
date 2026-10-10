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
 */
import express from 'express';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { requireAuth } from './auth.mjs';
import { BODY_LIMIT_BYTES, SHARE_HOLD_MINUTES, validateBatch } from '../lib/intake.mjs';
import { assignDocument, findDuplicateBatch, markActivityApplied, pendingActivity, queueDocument, readUpload, releaseBatch, saveBatch } from '../lib/intakeStore.mjs';
import { readBatch } from '../lib/intakeReader.mjs';
import { readPracticeSnapshot } from '../lib/briefingStore.mjs';
import { processBatch } from '../lib/intakePipeline.mjs';

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json({ configured: isDatabaseConfigured() });
});

router.use((req, res, next) => (isDatabaseConfigured() ? next() : res.status(503).json({ error: 'not_configured' })));
router.use(requireAuth);

// Each share is one model request — this bounds what a stolen session can spend.
const batchLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10, keyFor: (req) => req.user.id, name: 'rate_limited' });

router.post('/batches', batchLimiter, express.json({ limit: BODY_LIMIT_BYTES }), async (req, res) => {
  const checked = validateBatch(req.body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const result = await processBatch(
    { parts: checked.parts, userId: req.user.id, source: 'share', holdMinutes: SHARE_HOLD_MINUTES },
    { saveBatch, findDuplicateBatch, queueDocument, readBatch, readPracticeSnapshot },
  );
  if (result.duplicate) return res.status(409).json({ error: 'already_shared' });
  res.status(201).json(result);
});

router.use(express.json({ limit: '16kb' }));

router.post('/activity/:id/assign', async (req, res) => {
  const clientId = req.body?.clientId;
  if (clientId !== null && (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > 100)) return res.status(400).json({ error: 'invalid_client' });
  const changed = await assignDocument(String(req.params.id), req.user.id, clientId);
  if (!changed) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
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
