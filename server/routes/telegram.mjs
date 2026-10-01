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
import { encodePick, isTelegramConfigured, parsePick, parseStartCommand, PICK_ELSEWHERE, verifyWebhookSecret } from '../lib/telegram.mjs';
import { answerCallback, downloadFile, editMessage, sendMessage } from '../lib/telegramApi.mjs';
import {
  consumeLinkCode,
  createLinkCode,
  findLinkByChatId,
  findLinkByUserId,
  findUploadByFileId,
  queueActivity,
  resolvePendingMatch,
  saveUpload,
  savePendingMatch,
  setPendingMessageId,
} from '../lib/telegramStore.mjs';
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

  // Saved before the prompt is sent: its buttons carry the row's id, and the
  // message id they need to edit only exists once it has gone out.
  const pendingId = await savePendingMatch({ chatId, messageId: null, uploadId, candidates: decision.candidates, extracted: { ...extraction, suggestion: decision.suggestion } });
  const buttons = [
    ...decision.candidates.map((id, index) => ({ text: clientName(id), data: encodePick(pendingId, index) })),
    { text: 'Someone else — sort it in Smart Inbox', data: encodePick(pendingId, PICK_ELSEWHERE) },
  ];
  const text = decision.candidates.length
    ? `I couldn't tell for sure which client this ${decision.suggestion.documentType} is for. Which is it?`
    : `I couldn't match this ${decision.suggestion.documentType} to any client. It's saved — sort it in Smart Inbox?`;
  const messageId = await sendMessage(chatId, text, { buttons });
  await setPendingMessageId(pendingId, messageId);
}

/** A tap on one of fileLetter's "which client?" buttons. */
async function resolvePick(callback) {
  const chatId = callback.message?.chat?.id;
  const pick = parsePick(callback.data);
  if (chatId == null || !pick || !(await findLinkByChatId(chatId))) {
    await answerCallback(callback.id, "That button doesn't work any more.");
    return;
  }
  const pending = await resolvePendingMatch(pick.pendingId, chatId);
  if (!pending) {
    await answerCallback(callback.id, "That one's already been dealt with.");
    return;
  }

  const base = pending.extracted?.suggestion ?? { documentType: 'Other' };
  const clientId = pick.choice === PICK_ELSEWHERE ? null : (pending.candidates[pick.choice] ?? null);
  const suggestion = clientId
    ? { ...base, clientId, confidence: 1, rationale: 'Picked in Telegram.' }
    : { ...base, clientId: null, confidence: 0, rationale: 'Left to sort in Smart Inbox.' };
  await queueActivity({ uploadId: pending.uploadId, fileName: pending.fileName, sizeBytes: pending.sizeBytes, suggestion });

  let text = `Left for you in Smart Inbox: ${base.documentType}.`;
  if (clientId) {
    const snapshot = await readPracticeSnapshot();
    text = `Filed under ${snapshot?.clients?.find((c) => c.id === clientId)?.name ?? clientId}: ${base.documentType}.`;
  }
  await answerCallback(callback.id, clientId ? 'Filed.' : 'Left for Smart Inbox.');
  if (pending.messageId) await editMessage(chatId, pending.messageId, text);
  else await sendMessage(chatId, text);
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
const webhookLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyFor: (req) => req.body?.message?.chat?.id ?? req.body?.callback_query?.message?.chat?.id ?? req.ip,
  name: 'rate_limited',
});

router.post('/webhook', verifyTelegram, express.json({ limit: '1mb' }), webhookLimiter, async (req, res) => {
  // Telegram retries on anything but a 200, so every update is acknowledged
  // immediately; a reply failure below is logged, never turned into a
  // retried (and possibly duplicated) delivery.
  res.status(200).json({ ok: true });

  const callback = req.body?.callback_query;
  if (callback) {
    try {
      await resolvePick(callback);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'telegram', message: `Button handling failed: ${err?.message ?? err}` }));
      await answerCallback(callback.id, 'Something went wrong — try again.');
    }
    return;
  }

  const message = req.body?.message;
  const chatId = message?.chat?.id;
  if (chatId == null) return; // Edits, channel posts and the like — nothing to answer.

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
