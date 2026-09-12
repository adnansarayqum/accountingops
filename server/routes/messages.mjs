/**
 * Outbound messaging. The browser never holds a provider credential; it
 * asks this route to send, and records the result against the job. Only
 * email is sent from here — WhatsApp is handed to the accountant's own
 * WhatsApp by the client (see src/integrations/messaging.ts), SMS stays
 * simulated until a sender is chosen.
 *
 * Mounted at /api/messages by both the production server and the Vite
 * dev/preview server, like every other router here.
 */
import express from 'express';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { emailProvider, MessagingError, messagingStatus } from '../lib/messaging/index.mjs';
import { requireAuth } from './auth.mjs';

const MAX_SUBJECT = 300;
const MAX_BODY = 20_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A double-click, a retried request or a replayed mutation must not send a
// client the same reminder twice. The composer sends one key per draft;
// the answer is remembered for a while and returned again unchanged.
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const recentSends = new Map();

function rememberedSend(key) {
  const hit = recentSends.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    recentSends.delete(key);
    return null;
  }
  return hit.result;
}

function rememberSend(key, result) {
  const now = Date.now();
  for (const [k, v] of recentSends) if (v.expiresAt <= now) recentSends.delete(k);
  recentSends.set(key, { result, expiresAt: now + IDEMPOTENCY_TTL_MS });
}

/** Test hook — forget every remembered send. */
export function resetIdempotency() {
  recentSends.clear();
}

const router = express.Router();
router.use(express.json({ limit: '256kb' }));

// Whether a provider is configured is not secret; sending is.
router.get('/status', (_req, res) => {
  res.json(messagingStatus());
});

router.use((req, res, next) => (isDatabaseConfigured() ? requireAuth(req, res, next) : next()));

export const sendLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyFor: (req) => req.user?.id ?? req.ip,
});
router.use(sendLimiter);

router.post('/send', async (req, res) => {
  const { channel, to, subject, body, replyTo, idempotencyKey } = req.body ?? {};
  if (channel !== 'email') return res.status(400).json({ error: 'channel_not_supported' });
  if (typeof to !== 'string' || !EMAIL.test(to.trim())) return res.status(400).json({ error: 'invalid_recipient' });
  if (typeof subject !== 'string' || subject.trim() === '' || subject.length > MAX_SUBJECT) return res.status(400).json({ error: 'invalid_subject' });
  if (typeof body !== 'string' || body.trim() === '' || body.length > MAX_BODY) return res.status(400).json({ error: 'invalid_body' });
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 100) return res.status(400).json({ error: 'idempotency_key_required' });

  const remembered = rememberedSend(idempotencyKey);
  if (remembered) return res.json({ ...remembered, deduplicated: true });

  try {
    const provider = emailProvider();
    const sent = await provider.send({ to: to.trim(), subject: subject.trim(), body, replyTo: typeof replyTo === 'string' ? replyTo.trim() : undefined });
    const result = { ok: true, providerName: provider.name, providerMessageId: sent.providerMessageId, status: sent.status };
    rememberSend(idempotencyKey, result);
    res.json(result);
  } catch (err) {
    if (err instanceof MessagingError) return res.status(err.status).json({ error: err.code, detail: err.detail ?? undefined });
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'messaging', message: err?.message ?? String(err) }));
    res.status(500).json({ error: 'unknown_error' });
  }
});

export default router;
