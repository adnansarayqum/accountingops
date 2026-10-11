/**
 * Emails forwarded to the practice's inbound address (Postmark), as pure
 * functions: who sent one, whether to believe it, and what it holds that
 * the intake pipeline can read. Everything here runs before any model is
 * asked anything, and none of it needs a database or a network to test.
 *
 * An email becomes one share: every readable attachment, plus the email's
 * own text (subject, sender, body) as a text part — the body of a forwarded
 * client email is often the whole message. Attachments the pipeline can't
 * read (a spreadsheet, a zip) are named in that text rather than dropped
 * silently, so the person can see something came with it.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { bytesMatchType, MAX_BATCH_BYTES, MAX_FILE_BYTES, MAX_FILES_PER_BATCH, MAX_TEXT_CHARS, sniffType } from './intake.mjs';
import { READABLE_TYPES } from './intakeReader.mjs';

/** Small inline images (a logo in a signature) aren't documents. */
const INLINE_IMAGE_MAX_BYTES = 30 * 1024;
const MAX_ADDRESS_CHARS = 254;
const EMAIL_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

const digest = (value) => createHash('sha256').update(String(value)).digest();

/** Postmark calls the webhook with HTTP Basic credentials taken from its URL. Constant-time, and false when none are configured. */
export function checkBasicAuth(header, { username, password }) {
  if (!username || !password) return false;
  const match = /^Basic\s+(\S+)$/i.exec(typeof header === 'string' ? header : '');
  if (!match) return false;
  const given = Buffer.from(match[1], 'base64').toString('utf8');
  // Hash both sides so lengths always match and the comparison can't leak one.
  return timingSafeEqual(digest(given), digest(`${username}:${password}`));
}

/** A tidy, lower-cased address — or null when it isn't one. */
export function normaliseEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= MAX_ADDRESS_CHARS && EMAIL_PATTERN.test(email) ? email : null;
}

/** Who the email says it is from. The message is only believed after the checks below. */
export function senderOf(payload) {
  return normaliseEmail(payload?.FromFull?.Email) ?? normaliseEmail(/<([^>]+)>/.exec(String(payload?.From ?? ''))?.[1] ?? payload?.From);
}

const headerValue = (payload, name) => (Array.isArray(payload?.Headers) ? payload.Headers.find((h) => String(h?.Name).toLowerCase() === name)?.Value : undefined);

/** Whether the sending server was allowed, per SPF, to send for its domain — Postmark records the result in a header. */
export function spfPassed(payload) {
  return /^\s*pass\b/i.test(String(headerValue(payload, 'received-spf') ?? ''));
}

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

/** Readable text from an HTML-only email: tags dropped, block ends kept as line breaks. */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * The email as text for the pipeline: who and what, then the message,
 * then the names of any attachments that couldn't be read. Clipped to the
 * intake text limit, keeping the header and the skipped-attachment note.
 */
export function emailText(payload, skipped = []) {
  const head = [`Email forwarded by ${senderOf(payload) ?? 'unknown'}`, payload?.Subject ? `Subject: ${String(payload.Subject).replace(/\s+/g, ' ').trim()}` : null, payload?.Date ? `Date: ${payload.Date}` : null].filter(Boolean).join('\n');
  const body = String(payload?.TextBody ?? '').trim() || htmlToText(payload?.HtmlBody);
  const tail = skipped.length > 0 ? `\n\nAttachments that could not be read: ${skipped.join(', ')}` : '';
  const room = MAX_TEXT_CHARS - head.length - tail.length - 4;
  return `${head}\n\n${clip(body, Math.max(room, 0))}${tail}`.trim();
}

/**
 * What the pipeline can read from the email: { parts: [{ fileName, contentType, bytes }], text, skipped }.
 * Attachments are kept in order until a limit is reached; anything unreadable,
 * oversized, over the count, an inline signature image, or not what it says it
 * is, goes in `skipped` by name.
 */
export function emailToBatch(payload) {
  const files = [];
  const skipped = [];
  let total = 0;
  const attachments = Array.isArray(payload?.Attachments) ? payload.Attachments : [];
  for (const attachment of attachments) {
    const name = String(attachment?.Name ?? 'attachment').slice(0, 120);
    const bytes = typeof attachment?.Content === 'string' ? Buffer.from(attachment.Content, 'base64') : Buffer.alloc(0);
    const type = sniffType(bytes, attachment?.ContentType, name);
    if (!READABLE_TYPES.includes(type) || bytes.length === 0 || !bytesMatchType(bytes, type)) {
      // A tiny inline image is a logo, not something to mention.
      if (!(attachment?.ContentID && type.startsWith('image/') && bytes.length < INLINE_IMAGE_MAX_BYTES)) skipped.push(name);
      continue;
    }
    if (attachment?.ContentID && type.startsWith('image/') && bytes.length < INLINE_IMAGE_MAX_BYTES) continue;
    if (bytes.length > MAX_FILE_BYTES || total + bytes.length > MAX_BATCH_BYTES || files.length >= MAX_FILES_PER_BATCH) {
      skipped.push(name);
      continue;
    }
    total += bytes.length;
    files.push({ fileName: name, contentType: type, bytes });
  }
  return { files, text: emailText(payload, skipped), skipped };
}
