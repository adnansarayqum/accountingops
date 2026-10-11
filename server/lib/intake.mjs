/**
 * Shared intake — the rules for what can be shared into the app, as pure
 * functions. Everything here runs before a byte is stored or read by a
 * model, and none of it needs a database to test.
 */
import Busboy from 'busboy';
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

const normaliseType = (value) => String(value ?? '').toLowerCase().split(';')[0].trim();

/**
 * Turns a JSON request body — { files: [{ fileName, contentType, contentBase64 }], text? } —
 * into parts ready to store and read: { parts: [{ fileName, contentType, bytes }] }
 * or { error } naming the first problem. Shared text becomes a text part of its own.
 */
export function validateBatch(body) {
  const files = Array.isArray(body?.files) ? body.files : [];
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (files.length > MAX_FILES_PER_BATCH) return { error: 'too_many_files' };
  const decoded = [];
  for (const file of files) {
    const contentType = normaliseType(file?.contentType);
    if (!READABLE_TYPES.includes(contentType)) return { error: 'unsupported_type' };
    if (typeof file?.contentBase64 !== 'string' || file.contentBase64.length === 0) return { error: 'missing_content' };
    decoded.push({ fileName: file.fileName, contentType, bytes: Buffer.from(file.contentBase64, 'base64') });
  }
  return validateParts(decoded, text);
}

/** The same checks for files already decoded — [{ fileName, contentType, bytes }] — however they arrived. */
export function validateParts(files, rawText = '') {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (files.length === 0 && !text) return { error: 'empty' };
  if (files.length > MAX_FILES_PER_BATCH) return { error: 'too_many_files' };
  if (text.length > MAX_TEXT_CHARS) return { error: 'text_too_long' };

  const parts = [];
  let total = 0;
  for (const file of files) {
    const { contentType, bytes } = file;
    if (!READABLE_TYPES.includes(contentType)) return { error: 'unsupported_type' };
    if (!bytes || bytes.length === 0) return { error: 'missing_content' };
    if (bytes.length > MAX_FILE_BYTES) return { error: 'file_too_large' };
    total += bytes.length;
    if (total > MAX_BATCH_BYTES) return { error: 'batch_too_large' };
    if (!bytesMatchType(bytes, contentType)) return { error: 'content_mismatch' };
    parts.push({ fileName: safeFileName(file.fileName, EXTENSIONS[contentType]), contentType, bytes });
  }
  if (text) parts.push({ fileName: 'Shared text.txt', contentType: 'text/plain', bytes: Buffer.from(text, 'utf8') });
  return { parts };
}

/**
 * What a file is, from its own bytes. The iPhone Shortcut labels files
 * loosely (often application/octet-stream), so for a multipart upload the
 * bytes decide, and validateParts then confirms them. Text has no
 * signature, so it is only what the sender said it is.
 */
export function sniffType(bytes, declared = '', fileName = '') {
  for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']) {
    if (bytesMatchType(bytes, type)) return type;
  }
  const said = normaliseType(declared);
  if (said === 'text/plain' || (/\.txt$/i.test(fileName) && (said === '' || said === 'application/octet-stream'))) return 'text/plain';
  return said || 'application/octet-stream';
}

/**
 * A multipart/form-data upload — what the iPhone Shortcut's "Form" body
 * sends: any number of file fields, plus an optional `text` field. Reads
 * the stream under the same limits as the JSON path and stops as soon as
 * one is exceeded, so an oversized upload never fills memory. Resolves to
 * { parts } or { error }, like validateBatch.
 */
export function readMultipart(req) {
  return new Promise((resolve) => {
    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { files: MAX_FILES_PER_BATCH + 1, fileSize: MAX_FILE_BYTES + 1, fields: 8, fieldSize: MAX_TEXT_CHARS * 4, parts: MAX_FILES_PER_BATCH + 10 },
      });
    } catch {
      return resolve({ error: 'bad_request' });
    }
    const files = [];
    let text = '';
    let total = 0;
    let failure = null;
    const fail = (error) => {
      if (failure) return;
      failure = error;
      req.unpipe(busboy);
      req.resume();
      resolve({ error });
    };

    busboy.on('file', (_field, stream, info) => {
      const chunks = [];
      stream.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_BATCH_BYTES + MAX_FILE_BYTES) return fail('batch_too_large');
        chunks.push(chunk);
      });
      stream.on('limit', () => fail('file_too_large'));
      stream.on('end', () => {
        const bytes = Buffer.concat(chunks);
        if (bytes.length === 0) return; // an empty file field — a Shortcut with nothing to send
        files.push({ fileName: info.filename, contentType: sniffType(bytes, info.mimeType, info.filename), bytes });
      });
    });
    busboy.on('field', (name, value, info) => {
      if (name !== 'text') return;
      if (info.valueTruncated) return fail('text_too_long');
      text += (text ? '\n' : '') + value;
    });
    busboy.on('filesLimit', () => fail('too_many_files'));
    busboy.on('error', () => fail('bad_request'));
    busboy.on('close', () => {
      if (!failure) resolve(validateParts(files, text));
    });
    req.pipe(busboy);
  });
}

/** What each refusal means, in words a person (or a Shortcut's notification) can show. */
export const ERROR_MESSAGES = {
  empty: 'There was nothing to send.',
  too_many_files: `Send at most ${MAX_FILES_PER_BATCH} files at a time.`,
  text_too_long: 'That text is too long to send.',
  unsupported_type: 'Only photos (JPEG, PNG, WebP, GIF), PDFs and plain text can be sent. If this is an iPhone photo, convert it to JPEG first.',
  missing_content: 'A file was empty.',
  file_too_large: `A file is over ${MAX_FILE_BYTES / (1024 * 1024)} MB.`,
  batch_too_large: `That is more than ${MAX_BATCH_BYTES / (1024 * 1024)} MB in one go — send it in smaller batches.`,
  content_mismatch: 'A file is not what it says it is.',
  bad_request: 'That upload could not be read.',
  already_shared: 'You already shared exactly this in the last week.',
  rate_limited: 'Too many shares just now — wait a minute and try again.',
  use_json: 'Form uploads need an upload key; the app itself sends JSON.',
};

/**
 * One short text saying what became of a share — shown by the Shortcut
 * as a notification, so Ray can see it landed and where.
 */
export function shareMessage(result) {
  if (result?.duplicate) return ERROR_MESSAGES.already_shared;
  const docs = result?.documents ?? [];
  if (!result?.read) return `Saved ${docs.length} ${docs.length === 1 ? 'document' : 'documents'}. Not read automatically — sort ${docs.length === 1 ? 'it' : 'them'} in Smart Inbox.`;
  return docs
    .map((d) => {
      if (d.filed) return `Filed under ${d.clientName}: ${d.documentType}`;
      if (d.clientName) return `${d.documentType}: best guess ${d.clientName} — confirm in Smart Inbox`;
      return `${d.documentType}: choose a client in Smart Inbox`;
    })
    .join('\n');
}

/** The name a document gets in Smart Inbox: its first part's, noting any further pages. */
export function documentFileName(parts) {
  const [first, ...rest] = parts;
  return rest.length > 0 ? `${first.fileName} (+${rest.length} more ${rest.length === 1 ? 'page' : 'pages'})` : first.fileName;
}
