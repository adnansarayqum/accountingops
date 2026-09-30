/**
 * Telegram bot — pure helpers. Network IO lives in telegramApi.mjs, storage
 * in telegramStore.mjs; this file is the part that needs no server to test.
 *
 * No inbound-webhook-signature-verification precedent exists anywhere else
 * in this codebase — every other integration only ever calls out. This is
 * the first inbound, unsolicited third-party-initiated route.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 5 bytes -> 10 hex characters, short enough to type, long enough not to guess at the rate limit on /webhook. Not a bearer credential like a portal token — single-use and short-lived. */
export const LINK_CODE_BYTES = 5;
export const LINK_CODE_EXPIRY_MINUTES = 15;

export function generateLinkCode() {
  return randomBytes(LINK_CODE_BYTES).toString('hex').toUpperCase();
}

/** What gets stored. Given the hash you cannot recover the code; given the code you can find the row — same reasoning as the portal's own token hashing. */
export function hashLinkCode(code) {
  return createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}

/**
 * Telegram's own webhook verification: the secret set via setWebhook's
 * secret_token, checked against the X-Telegram-Bot-Api-Secret-Token header.
 * Length-checked first — timingSafeEqual throws on a length mismatch rather
 * than returning false, and a length check alone leaks nothing a timing
 * attack could use (the secret length isn't sensitive, only its value).
 */
export function verifyWebhookSecret(headerValue, expected) {
  if (!expected || typeof headerValue !== 'string') return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * "/start CODE" — both a person typing it by hand and Telegram's own
 * deep-link convention (t.me/<bot>?start=CODE) arrive this way. "/start"
 * alone (code null) is a bare open with no code yet.
 */
export function parseStartCommand(text) {
  if (typeof text !== 'string') return null;
  const match = /^\/start(?:@\w+)?(?:\s+(\S+)[\s\S]*)?$/.exec(text.trim());
  if (!match) return null;
  return { code: match[1] ?? null };
}

export function isTelegramConfigured(env = process.env) {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET);
}
