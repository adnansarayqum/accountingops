/**
 * Outbound messaging. The browser never holds a provider credential; it
 * asks this route to send, and records the result against the job. Only
 * email is sent from here — WhatsApp is handed to the accountant's own
 * WhatsApp by the client (see src/integrations/messaging.ts), SMS stays
 * simulated until a sender is chosen.
 *
 * Two modes, and the line between them is the point of this file:
 *
 *  - Authenticated, server-backed (DATABASE_URL set). Every request carries a
 *    signed-in user (`requireAuth` below). Only here can a real provider
 *    (Postmark) send, and idempotency is durable: the key is claimed with an
 *    INSERT in PostgreSQL (lib/emailClaims.mjs), so a retry, a second tab or a
 *    restart cannot send twice, and two simultaneous requests with one key
 *    send once.
 *  - Browser-only (no database, no login). Only the simulated provider may
 *    run: nothing leaves the process. A real provider configured here is
 *    refused with 503 `authenticated_mode_required` — never sent, and never
 *    quietly simulated — because anyone who can reach the URL could otherwise
 *    make the practice's mail account send to whoever they liked. Its
 *    idempotency stays an in-memory map: nothing is sent, so nothing durable
 *    is at stake.
 *
 * Mounted at /api/messages by both the production server and the Vite
 * dev/preview server, like every other router here.
 */
import express from 'express';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { emailProvider, MessagingError, messagingStatus } from '../lib/messaging/index.mjs';
import { claimSend, completeSend, hashMessage, markUnknown, releaseSend } from '../lib/emailClaims.mjs';
import { PERMISSIONS, requirePermission } from '../lib/authorization.mjs';
import { recordSecurityEvent } from '../lib/securityAudit.mjs';
import { requireAuth } from './auth.mjs';

const MAX_SUBJECT = 300;
const MAX_BODY = 20_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Browser-only mode only (see the header): a double-click on a simulated
// send is answered from memory. Authenticated sends never touch this.
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const recentSimulatedSends = new Map();

function rememberedSimulatedSend(key) {
  const hit = recentSimulatedSends.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    recentSimulatedSends.delete(key);
    return null;
  }
  return hit.result;
}

function rememberSimulatedSend(key, result) {
  const now = Date.now();
  for (const [k, v] of recentSimulatedSends) if (v.expiresAt <= now) recentSimulatedSends.delete(k);
  recentSimulatedSends.set(key, { result, expiresAt: now + IDEMPOTENCY_TTL_MS });
}

/** Test hook — forget every remembered browser-only simulated send. */
export function resetIdempotency() {
  recentSimulatedSends.clear();
}

/**
 * Whether the provider might have delivered a message even though we hold no
 * confirmation. Postmark answering with an error status means it did not
 * accept the message; a dropped connection, a timeout or a bug of ours means
 * we cannot say.
 */
function outcomeIsAmbiguous(err) {
  return !(err instanceof MessagingError) || err.code === 'upstream_unreachable';
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

// Signed-in users only meet this in server-backed mode; browser-only mode has no roles.
router.post('/send', (req, res, next) => (req.user ? requirePermission(PERMISSIONS.MESSAGES_SEND)(req, res, next) : next()));

router.post('/send', async (req, res) => {
  const { channel, to, subject, body, replyTo, idempotencyKey } = req.body ?? {};
  if (channel !== 'email') return res.status(400).json({ error: 'channel_not_supported' });
  if (typeof to !== 'string' || !EMAIL.test(to.trim())) return res.status(400).json({ error: 'invalid_recipient' });
  if (typeof subject !== 'string' || subject.trim() === '' || subject.length > MAX_SUBJECT) return res.status(400).json({ error: 'invalid_subject' });
  if (typeof body !== 'string' || body.trim() === '' || body.length > MAX_BODY) return res.status(400).json({ error: 'invalid_body' });
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 100) return res.status(400).json({ error: 'idempotency_key_required' });

  const message = { to: to.trim(), subject: subject.trim(), body, replyTo: typeof replyTo === 'string' ? replyTo.trim() : undefined };

  try {
    // Resolved before anything is claimed: a refusal here (no authenticated
    // mode for a real provider, an unknown provider name) must not consume
    // the caller's key. Throws MessagingError → mapped below.
    const provider = emailProvider();
    const real = provider.name !== 'simulated';
    // Belt and braces on top of emailProvider(): a real send needs a
    // signed-in user, whatever else about the mounting changes.
    if (real && !req.user) return res.status(401).json({ error: 'not_authenticated' });
    if (!provider.isConfigured()) return res.status(503).json({ error: 'not_configured' });

    if (!req.user) {
      // Browser-only, simulated. Not durable, and does not need to be.
      const remembered = rememberedSimulatedSend(idempotencyKey);
      if (remembered) return res.json({ ...remembered, deduplicated: true });
      const sent = await provider.send(message);
      const result = { ok: true, providerName: provider.name, providerMessageId: sent.providerMessageId, status: sent.status };
      rememberSimulatedSend(idempotencyKey, result);
      return res.json(result);
    }

    const scope = `user:${req.user.id}`;
    const claim = await claimSend({ scope, key: idempotencyKey, requestHash: hashMessage({ channel, ...message }) });
    if (claim.state === 'replay') return res.json({ ...claim.result, deduplicated: true });
    if (claim.state === 'in_progress') return res.status(409).set('Retry-After', '2').json({ error: 'send_in_progress' });
    if (claim.state === 'unknown') return res.status(409).json({ error: 'send_outcome_unknown' });
    if (claim.state === 'mismatch') return res.status(422).json({ error: 'idempotency_key_reused' });

    let sent;
    try {
      sent = await provider.send(message);
    } catch (err) {
      // Best effort either way: failing to tidy the claim must not hide the send failure.
      if (outcomeIsAmbiguous(err)) await markUnknown({ scope, key: idempotencyKey }).catch(() => {});
      else await releaseSend({ scope, key: idempotencyKey }).catch(() => {});
      throw err;
    }
    const result = { ok: true, providerName: provider.name, providerMessageId: sent.providerMessageId, status: sent.status };
    // The message has gone. Whatever happens to the bookkeeping from here, the
    // caller must hear that it was sent — a 500 now would invite a duplicate.
    await completeSend({ scope, key: idempotencyKey, result }).catch((err) => {
      console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'messaging', message: `Sent but could not record the result: ${err?.message ?? err}` }));
    });
    if (real) {
      // Domain only: the recipient's address is client data the audit log has no need to hold.
      await recordSecurityEvent({ req, action: 'message.email_sent', targetType: 'email', targetId: sent.providerMessageId ?? null, details: { provider: provider.name, recipientDomain: message.to.split('@').pop().toLowerCase() } }).catch((err) => {
        console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'security_audit', message: `Could not record message.email_sent: ${err?.message ?? err}` }));
      });
    }
    res.json(result);
  } catch (err) {
    if (err instanceof MessagingError) return res.status(err.status).json({ error: err.code, detail: err.detail ?? undefined });
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'messaging', message: err?.message ?? String(err) }));
    res.status(500).json({ error: 'unknown_error' });
  }
});

export default router;
