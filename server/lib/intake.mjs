/**
 * Shared intake — the rules for what can be shared into the app, as pure
 * functions. Everything here runs before a byte is stored or read by a
 * model, and none of it needs a database to test.
 */
import { READABLE_TYPES } from './intakeReader.mjs';
import { safeFileName } from './portal.mjs';

export const MAX_FILES_PER_BATCH = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Claude takes up to 32 MB a request, and base64 inflates by a third. */
export const MAX_BATCH_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 20_000;
/** How long a shared batch waits for the share screen before a tab may pick it up. */
export const SHARE_HOLD_MINUTES = 10;
/** The JSON body that carries a full batch as base64, plus room for the text and field names. */
export const BODY_LIMIT_BYTES = Math.ceil((MAX_BATCH_BYTES * 4) / 3) + MAX_TEXT_CHARS * 4 + 64 * 1024;

const EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf', 'text/plain': '.txt' };

const SIGNATURES = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/gif': (b) => b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1')),
  'image/webp': (b) => b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
  // No signature: plausibly text means no NUL and nothing from the C0 range below tab.
  'text/plain': (b) => !b.subarray(0, 4096).some((byte) => byte === 0x00 || byte < 0x09),
};

/** Whether the bytes are what the declared type says — the label alone is the sender's word. */
export function bytesMatchType(bytes, contentType) {
  const check = SIGNATURES[contentType];
  return Boolean(check && check(bytes));
}

/**
 * Turns a request body — { files: [{ fileName, contentType, contentBase64 }], text? } —
 * into parts ready to store and read: { parts: [{ fileName, contentType, bytes }] }
 * or { error } naming the first problem. Shared text becomes a text part of its own.
 */
export function validateBatch(body) {
  const files = Array.isArray(body?.files) ? body.files : [];
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (files.length === 0 && !text) return { error: 'empty' };
  if (files.length > MAX_FILES_PER_BATCH) return { error: 'too_many_files' };
  if (text.length > MAX_TEXT_CHARS) return { error: 'text_too_long' };

  const parts = [];
  let total = 0;
  for (const file of files) {
    const contentType = String(file?.contentType ?? '').toLowerCase().split(';')[0].trim();
    if (!READABLE_TYPES.includes(contentType)) return { error: 'unsupported_type' };
    if (typeof file?.contentBase64 !== 'string' || file.contentBase64.length === 0) return { error: 'missing_content' };
    const bytes = Buffer.from(file.contentBase64, 'base64');
    if (bytes.length === 0) return { error: 'missing_content' };
    if (bytes.length > MAX_FILE_BYTES) return { error: 'file_too_large' };
    total += bytes.length;
    if (total > MAX_BATCH_BYTES) return { error: 'batch_too_large' };
    if (!bytesMatchType(bytes, contentType)) return { error: 'content_mismatch' };
    parts.push({ fileName: safeFileName(file.fileName, EXTENSIONS[contentType]), contentType, bytes });
  }
  if (text) parts.push({ fileName: 'Shared text.txt', contentType: 'text/plain', bytes: Buffer.from(text, 'utf8') });
  return { parts };
}

/** The name a document gets in Smart Inbox: its first part's, noting any further pages. */
export function documentFileName(parts) {
  const [first, ...rest] = parts;
  return rest.length > 0 ? `${first.fileName} (+${rest.length} more ${rest.length === 1 ? 'page' : 'pages'})` : first.fileName;
}
