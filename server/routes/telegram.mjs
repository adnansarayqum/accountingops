/**
 * Telegram photo intake. Two very different trust levels, like the portal:
 *
 *  - /webhook — Telegram itself is the caller, verified by the shared
 *    secret Telegram sends on every update, never a signed-in session.
 *  - everything else — the practice, signed in, managing their own link.
 *
 * Needs a database (nowhere else to hold a chat-to-user link), so the
 * whole router answers 503 without one and the browser-only build is
 * untouched.
 *
 * This phase is the webhook skeleton only: linking, and a placeholder
 * reply to a photo. Reading the photo and matching it to a client is the
 * next phase, built on top of this once the inbound pipe is proven against
 * a real bot.
 */
import express from 'express';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { requireAuth } from './auth.mjs';
import { isTelegramConfigured, parseStartCommand, verifyWebhookSecret } from '../lib/telegram.mjs';
import { sendMessage } from '../lib/telegramApi.mjs';
import { consumeLinkCode, createLinkCode, findLinkByChatId, findLinkByUserId } from '../lib/telegramStore.mjs';

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json({ configured: isTelegramConfigured() });
});

router.use((req, res, next) => (isDatabaseConfigured() ? next() : res.status(503).json({ error: 'not_configured' })));

// ---------------------------------------------------------------------------
// Inbound: Telegram itself
// ---------------------------------------------------------------------------

// Checked before the body is parsed or anything keys off it: the limiter
// below trusts the chat id in the body, which only a verified caller may set.
function verifyTelegram(req, res, next) {
  if (!isTelegramConfigured() || !verifyWebhookSecret(req.get('X-Telegram-Bot-Api-Secret-Token'), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return res.status(403).json({ error: 'invalid_signature' });
  }
  next();
}

// Per chat, not per address: Telegram's own servers make every call, so an
// IP-keyed limit would cap every chat in the practice together.
const webhookLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, keyFor: (req) => req.body?.message?.chat?.id ?? req.ip, name: 'rate_limited' });

router.post('/webhook', verifyTelegram, express.json({ limit: '1mb' }), webhookLimiter, async (req, res) => {
  // Telegram retries on anything but a 200, so every update is acknowledged
  // immediately; a reply failure below is logged, never turned into a
  // retried (and possibly duplicated) delivery.
  res.status(200).json({ ok: true });

  const message = req.body?.message;
  const chatId = message?.chat?.id;
  if (chatId == null) return; // callback_query and anything else land in a later phase.

  try {
    const start = parseStartCommand(message.text);
    if (start) {
      if (!start.code) {
        await sendMessage(chatId, 'Send /start followed by the code from Settings → Connect Telegram, for example: /start ABC1234567');
        return;
      }
      const userId = await consumeLinkCode(start.code, chatId);
      if (!userId) {
        await sendMessage(chatId, "That code isn't valid any more — get a new one from Settings → Connect Telegram and try again.");
        return;
      }
      await sendMessage(chatId, "You're connected. Send a photo of an HMRC letter any time and I'll file it.");
      return;
    }

    const link = await findLinkByChatId(chatId);
    if (!link) {
      await sendMessage(chatId, "This chat isn't connected to an account yet — get a code from Settings → Connect Telegram and send /start <code> here.");
      return;
    }

    if (Array.isArray(message.photo) && message.photo.length > 0) {
      await sendMessage(chatId, "Got it — reading photos isn't wired up yet, hang tight.");
      return;
    }

    await sendMessage(chatId, "Send a photo of an HMRC letter and I'll file it.");
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'telegram', message: `Webhook handling failed: ${err?.message ?? err}` }));
  }
});

// ---------------------------------------------------------------------------
// Practice: signed in, managing their own link
// ---------------------------------------------------------------------------

router.use(requireAuth);
router.use(express.json());

router.get('/link', async (req, res) => {
  const link = await findLinkByUserId(req.user.id);
  res.json({ linked: Boolean(link), linkedAt: link?.linkedAt ?? null });
});

router.post('/link-codes', createRateLimiter({ windowMs: 60 * 1000, max: 5, keyFor: (req) => req.user.id, name: 'rate_limited' }), async (req, res) => {
  const { code, expiresAt } = await createLinkCode(req.user.id);
  res.status(201).json({ code, expiresAt });
});

export default router;
