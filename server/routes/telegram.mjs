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
 * A photo from a linked chat is stored, read (telegramVision.mjs),
 * matched (telegramMatch.mjs), and either queued for Smart Inbox or held
 * as a pending match. Every path ends in a reply — nothing is ever silent.
 */
import express from 'express';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { requireAuth } from './auth.mjs';
import { isTelegramConfigured, parseStartCommand, verifyWebhookSecret } from '../lib/telegram.mjs';
import { downloadFile, sendMessage } from '../lib/telegramApi.mjs';
import { consumeLinkCode, createLinkCode, findLinkByChatId, findLinkByUserId, findUploadByFileId, queueActivity, saveUpload, savePendingMatch } from '../lib/telegramStore.mjs';
import { readPracticeSnapshot } from '../lib/briefingStore.mjs';
import { readLetter } from '../lib/telegramVision.mjs';
import { buildRoster, decideMatch } from '../lib/telegramMatch.mjs';

const router = express.Router();

/** The image types the vision model accepts. A photo is always JPEG; a file sent "as a document" can be anything. */
const READABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** What was sent, if it's something to read: { fileId, contentType } or { unsupported: true }. */
function incomingImage(message) {
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    // Telegram lists the sizes smallest first.
    return { fileId: message.photo.at(-1).file_id, contentType: 'image/jpeg' };
  }
  if (message.document) {
    return READABLE_TYPES.includes(message.document.mime_type) ? { fileId: message.document.file_id, contentType: message.document.mime_type } : { unsupported: true };
  }
  return null;
}

function fileNameFor(contentType, now = new Date()) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[contentType];
  return `telegram-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
}

async function fileLetter(chatId, image) {
  if (await findUploadByFileId(chatId, image.fileId)) return; // A redelivery of one already handled.

  await sendMessage(chatId, 'Got it — reading it now…');
  let bytes;
  try {
    ({ bytes } = await downloadFile(image.fileId));
  } catch (err) {
    await sendMessage(chatId, err?.message === 'file_too_large' ? "That file's too large — send it as a photo instead." : "I couldn't download that — try sending it again.");
    return;
  }
  const fileName = fileNameFor(image.contentType);
  const uploadId = await saveUpload({ chatId, fileId: image.fileId, fileName, contentType: image.contentType, bytes });

  if (!process.env.ANTHROPIC_API_KEY) {
    await sendMessage(chatId, "Saved, but reading letters isn't set up on the server yet.");
    return;
  }

  const snapshot = await readPracticeSnapshot();
  const extraction = await readLetter({ bytes, mediaType: image.contentType, roster: buildRoster(snapshot) });
  if (!extraction) {
    await sendMessage(chatId, "I couldn't read that one — it's saved. Try a clearer, flatter photo.");
    return;
  }

  const clientName = (id) => snapshot?.clients?.find((c) => c.id === id)?.name ?? id;
  const decision = decideMatch(extraction, snapshot);
  if (decision.kind === 'filed') {
    await queueActivity({ uploadId, fileName, sizeBytes: bytes.length, suggestion: decision.suggestion });
    await sendMessage(chatId, `Filed under ${clientName(decision.clientId)}: ${decision.suggestion.documentType}.`);
    return;
  }

  const guesses = decision.candidates.map(clientName);
  const text = guesses.length
    ? `I couldn't tell for sure which client this ${decision.suggestion.documentType} is for — best guess: ${guesses.join(', or ')}. It's saved; I'll ask you to pick soon.`
    : `I couldn't match this ${decision.suggestion.documentType} to any client. It's saved; I'll ask you to pick soon.`;
  const messageId = await sendMessage(chatId, text);
  await savePendingMatch({ chatId, messageId, uploadId, candidates: decision.candidates, extracted: { ...extraction, suggestion: decision.suggestion } });
}

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

    const image = incomingImage(message);
    if (image?.unsupported) {
      await sendMessage(chatId, 'I can only read photos for now — send the letter as a photo (JPEG or PNG).');
      return;
    }
    if (image) {
      await fileLetter(chatId, image);
      return;
    }

    await sendMessage(chatId, "Send a photo of an HMRC letter and I'll file it.");
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'telegram', message: `Webhook handling failed: ${err?.message ?? err}` }));
    await sendMessage(chatId, 'Something went wrong on my side handling that — please send it again.');
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
