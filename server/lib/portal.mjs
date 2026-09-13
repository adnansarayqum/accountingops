/**
 * Client portal — the security boundary, as pure functions.
 *
 * A portal link is the one place this app hands something to a person who
 * has no account: a client uploading the records we are chasing, or
 * approving accounts before we file them. So the rules here are about blast
 * radius. A link that leaks must expose one job for one client, do one kind
 * of thing, stop working when it should, and give nothing away when guessed.
 *
 *  - The token is 32 random bytes. Only its SHA-256 is stored, so a database
 *    read does not yield working links.
 *  - A link has one purpose: upload, or approve. An approval link is
 *    single-use.
 *  - Every link expires. Every link can be revoked.
 *  - A bad, expired, revoked or used token all produce the same answer, so a
 *    guesser learns nothing about which of those it was.
 *  - Uploads are capped in size, count and type, before a byte is stored.
 *
 * The store and routes (portalStore.mjs, routes/portal.mjs) call these; none
 * of it needs a database to test.
 */
import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_BYTES = 32;
export const PURPOSES = ['upload', 'approve'];
export const DEFAULT_EXPIRY_DAYS = 30;
export const MAX_EXPIRY_DAYS = 90;

/** Per-file and per-link caps. Generous for records, tight enough that a leaked link cannot be used as free storage. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_LINK = 12;
export const MAX_NOTE_LENGTH = 500;
export const MAX_NAME_LENGTH = 120;

/** What a client can plausibly send an accountant. Anything executable or scriptable is not on the list. */
export const ALLOWED_CONTENT_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/heic', '.heic'],
  ['text/csv', '.csv'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
]);

export function generateToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** What gets stored. Given the hash you cannot recover the token; given the token you can find the row. */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** A token as it should look in a URL: base64url of 32 bytes is 43 characters. Reject anything else before touching the database. */
export function looksLikeToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function isPurpose(value) {
  return PURPOSES.includes(value);
}

export function expiryFor(days, now = () => new Date()) {
  const n = Number(days);
  const clamped = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_EXPIRY_DAYS) : DEFAULT_EXPIRY_DAYS;
  return new Date(now().getTime() + clamped * 24 * 60 * 60 * 1000);
}

/**
 * Why a link can't be used, or null when it can. The reasons are for the
 * practice's own view of its links; the public route collapses every one
 * of them to the same 404 so nothing can be learned by probing.
 */
export function linkProblem(link, now = () => new Date()) {
  if (!link) return 'not_found';
  if (link.revokedAt) return 'revoked';
  if (link.usedAt) return 'used';
  if (new Date(link.expiresAt).getTime() <= now().getTime()) return 'expired';
  return null;
}

/**
 * Validates an upload before any of it is stored. The base64 length gives
 * the decoded size without decoding, which is the point: a 200 MB body must
 * be refused from its declared size, not after it has been buffered.
 */
export function validateUpload({ fileName, contentType, contentBase64 }, { existingCount = 0 } = {}) {
  if (existingCount >= MAX_FILES_PER_LINK) return { ok: false, error: 'too_many_files' };
  if (typeof contentType !== 'string' || !ALLOWED_CONTENT_TYPES.has(contentType.toLowerCase())) return { ok: false, error: 'unsupported_type' };
  if (typeof contentBase64 !== 'string' || contentBase64.length === 0) return { ok: false, error: 'empty' };
  const approxBytes = Math.floor((contentBase64.length * 3) / 4);
  if (approxBytes > MAX_FILE_BYTES) return { ok: false, error: 'too_large' };
  if (!/^[A-Za-z0-9+/=\s]+$/.test(contentBase64)) return { ok: false, error: 'malformed' };
  return { ok: true, fileName: safeFileName(fileName, ALLOWED_CONTENT_TYPES.get(contentType.toLowerCase())), contentType: contentType.toLowerCase() };
}

const OLE_COMPOUND_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** ISO base media (MP4/HEIF family) brand codes that mean "this is a HEIC/HEIF image". */
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);

function isOleCompoundFile(buffer) {
  return buffer.length >= OLE_COMPOUND_SIGNATURE.length && buffer.subarray(0, OLE_COMPOUND_SIGNATURE.length).equals(OLE_COMPOUND_SIGNATURE);
}

/** .xlsx and .docx are both Office Open XML: a ZIP container. This can't tell the two apart without unzipping — it can only rule out something that isn't a ZIP at all. */
function isZipContainer(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
}

function isHeic(buffer) {
  return buffer.length >= 12 && buffer.subarray(4, 8).toString('latin1') === 'ftyp' && HEIC_BRANDS.has(buffer.subarray(8, 12).toString('latin1').toLowerCase());
}

/**
 * CSV has no signature — it's plain text, and a real one could start with
 * almost any printable character. The bar here is only "this plausibly
 * isn't binary content mislabelled as CSV": no embedded NUL, and nothing
 * from the C0 control range below tab, which a genuine delimited text
 * file never contains.
 */
function looksLikePlainText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0x00 || byte < 0x09) return false;
  }
  return true;
}

/** One check per allowed type; text/csv has none of its own and is handled directly in matchesDeclaredType. */
const MAGIC_BYTE_CHECKS = new Map([
  ['application/pdf', (buf) => buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-'],
  ['image/jpeg', (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff],
  ['image/png', (buf) => buf.length >= PNG_SIGNATURE.length && buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)],
  ['image/heic', isHeic],
  ['application/vnd.ms-excel', isOleCompoundFile],
  ['application/msword', isOleCompoundFile],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', isZipContainer],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', isZipContainer],
]);

/**
 * Whether the file's actual bytes look like what it claims to be, checked
 * *after* the type has already passed the ALLOWED_CONTENT_TYPES allowlist —
 * this is a second, independent check, not a replacement for it. A client
 * declares its own content-type; nothing before this point looks past that
 * label, so labelling arbitrary bytes as a PDF would otherwise sail
 * through untouched. Every currently-allowed type but CSV has a real
 * signature to check; CSV gets the plain-text heuristic instead.
 */
export function matchesDeclaredType(buffer, contentType) {
  const type = String(contentType ?? '').toLowerCase();
  if (type === 'text/csv') return looksLikePlainText(buffer);
  const check = MAGIC_BYTE_CHECKS.get(type);
  return check ? check(buffer) : false;
}

/** Characters that must never appear in a file name: path separators, and C0/DEL control codes. */
const UNSAFE_NAME_CHARS = /[\\/]|\p{Cc}/gu;

/**
 * A file name that is safe to show and to write anywhere: no path
 * separators, no control characters, bounded length, and the extension the
 * declared type says it should have rather than whatever the client typed.
 */
export function safeFileName(name, extension) {
  const base = String(name ?? 'document')
    .replace(UNSAFE_NAME_CHARS, (ch) => (ch === '/' || ch === '\\' ? '-' : ''))
    // Only a trailing extension comes off. "..-..-etc-passwd" has dots, none
    // of them an extension, and stripping from the first one would gut it.
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return `${base || 'document'}${extension ?? ''}`;
}

export function cleanNote(note) {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  return trimmed ? trimmed.slice(0, MAX_NOTE_LENGTH) : null;
}

export function cleanName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, MAX_NAME_LENGTH) : null;
}

/**
 * The public view of a job: exactly what the client needs to act and not
 * one field more. No identifiers, no other jobs, no internal notes, no
 * staff names. Built from the practice snapshot server-side so the token
 * never has to carry any of it.
 */
export function publicJobView(data, link) {
  const job = data?.jobs?.find((j) => j.id === link.jobId);
  const client = data?.clients?.find((c) => c.id === link.clientId);
  if (!job || !client || job.clientId !== client.id) return null;
  const practiceName = data?.practice?.name ?? 'Your accountant';
  const outstanding = (data?.requestItems ?? [])
    .filter((i) => i.jobId === job.id && i.status !== 'received')
    .map((i) => ({ id: i.id, label: i.label }));
  const approvalPending = (data?.approvals ?? []).some((a) => a.jobId === job.id && a.kind === 'client' && a.status === 'pending') || job.status === 'waiting_client_approval';
  return {
    practiceName,
    clientName: client.name,
    jobName: job.name,
    periodEnd: job.periodEnd,
    dueDate: job.dueDate,
    purpose: link.purpose,
    outstanding: link.purpose === 'upload' ? outstanding : [],
    approvalPending: link.purpose === 'approve' ? approvalPending : false,
    message: link.message ?? null,
    hasAttachment: Boolean(link.attachmentId),
    expiresAt: link.expiresAt,
  };
}
