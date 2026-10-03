/**
 * Telegram persistence. See telegram.mjs for the rules; this is only where
 * the rows live — links, uploads and the activity queue, never the practice
 * snapshot (see db.mjs's ensureSchema for why).
 */
import { randomUUID } from 'node:crypto';
import { ensureSchema, query } from './db.mjs';
import { generateLinkCode, hashLinkCode, LINK_CODE_EXPIRY_MINUTES } from './telegram.mjs';

/** Creates a one-time code and returns it in plain text exactly once — the store keeps only its hash. */
export async function createLinkCode(userId) {
  await ensureSchema();
  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_EXPIRY_MINUTES * 60 * 1000);
  await query('insert into telegram_link_codes (code_hash, user_id, expires_at) values ($1, $2, $3)', [hashLinkCode(code), userId, expiresAt]);
  return { code, expiresAt };
}

/**
 * Consumes a code: links the chat to the code's user if it is still live,
 * marking it used either way so it can never be replayed. Returns the
 * linked userId, or null when the code is unknown, used, or expired.
 */
export async function consumeLinkCode(code, chatId) {
  await ensureSchema();
  // One statement, so two messages racing with the same code can't both claim it.
  const { rows } = await query(
    'update telegram_link_codes set used_at = now() where code_hash = $1 and used_at is null and expires_at > now() returning user_id',
    [hashLinkCode(code)],
  );
  const row = rows[0];
  if (!row) return null;
  // One chat per user: linking from a new phone moves the link, it doesn't add a second.
  await query('delete from telegram_links where user_id = $1 and chat_id <> $2', [row.user_id, String(chatId)]);
  await query(
    `insert into telegram_links (id, chat_id, user_id) values ($1, $2, $3)
     on conflict (chat_id) do update set user_id = excluded.user_id, linked_at = now()`,
    [`tgl_${randomUUID()}`, String(chatId), row.user_id],
  );
  return row.user_id;
}

export async function findLinkByChatId(chatId) {
  await ensureSchema();
  const { rows } = await query('select user_id, linked_at from telegram_links where chat_id = $1', [String(chatId)]);
  return rows[0] ? { userId: rows[0].user_id, linkedAt: rows[0].linked_at } : null;
}

export async function findLinkByUserId(userId) {
  await ensureSchema();
  const { rows } = await query('select chat_id, linked_at from telegram_links where user_id = $1', [userId]);
  return rows[0] ? { chatId: rows[0].chat_id, linkedAt: rows[0].linked_at } : null;
}

// ---------------------------------------------------------------------------
// Photos and what became of them
// ---------------------------------------------------------------------------

/**
 * Telegram redelivers an update it thinks went unanswered, with the same
 * file_id — so a photo already stored for this chat is the same photo, and
 * must not be read (and paid for) a second time.
 */
export async function findUploadByFileId(chatId, fileId) {
  await ensureSchema();
  const { rows } = await query('select id from telegram_uploads where chat_id = $1 and telegram_file_id = $2', [String(chatId), fileId]);
  return rows[0]?.id ?? null;
}

export async function saveUpload({ chatId, fileId, fileName, contentType, bytes }) {
  await ensureSchema();
  const id = `tgu_${randomUUID()}`;
  await query(
    'insert into telegram_uploads (id, chat_id, telegram_file_id, file_name, content_type, size_bytes, content) values ($1, $2, $3, $4, $5, $6, $7)',
    [id, String(chatId), fileId, fileName, contentType, bytes.length, bytes],
  );
  return id;
}

/** Queues a matched letter for the practice's next open tab to pull into Smart Inbox. */
export async function queueActivity({ uploadId, fileName, sizeBytes, suggestion }) {
  await ensureSchema();
  const id = `tga_${randomUUID()}`;
  await query(
    `insert into telegram_activity (id, upload_id, client_id, document_type, period, extracted_reference, extracted_date, confidence, rationale, file_name, size_kb)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      uploadId,
      suggestion.clientId ?? null,
      suggestion.documentType,
      suggestion.period ?? null,
      suggestion.extractedReference ?? null,
      suggestion.extractedDate ?? null,
      suggestion.confidence,
      suggestion.rationale,
      fileName,
      Math.max(1, Math.round(sizeBytes / 1024)),
    ],
  );
  return id;
}

/** A letter the bot couldn't place, held until someone says which client it is for. */
export async function savePendingMatch({ chatId, messageId, uploadId, candidates, extracted }) {
  await ensureSchema();
  const id = `tgp_${randomUUID()}`;
  await query(
    'insert into telegram_pending_matches (id, chat_id, message_id, upload_id, candidates, extracted) values ($1, $2, $3, $4, $5, $6)',
    [id, String(chatId), String(messageId ?? ''), uploadId, JSON.stringify(candidates), JSON.stringify(extracted)],
  );
  return id;
}

/** Attaches the "which client?" prompt's message id once it has been sent, so the answer can edit it. */
export async function setPendingMessageId(id, messageId) {
  await ensureSchema();
  await query('update telegram_pending_matches set message_id = $2 where id = $1', [id, String(messageId ?? '')]);
}

/**
 * Claims a pending match for an answer, once. A single statement, so a
 * double tap (or a tap from any other chat) resolves nothing and gets null.
 * Returns the row joined with its upload's name and size for queueing.
 */
export async function resolvePendingMatch(id, chatId) {
  await ensureSchema();
  const { rows } = await query(
    `update telegram_pending_matches p set resolved_at = now()
       from telegram_uploads u
      where p.id = $1 and p.chat_id = $2 and p.resolved_at is null and u.id = p.upload_id
      returning p.id, p.message_id, p.upload_id, p.candidates, p.extracted, u.file_name, u.size_bytes`,
    [id, String(chatId)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    messageId: row.message_id,
    uploadId: row.upload_id,
    candidates: row.candidates,
    extracted: row.extracted,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
  };
}

// ---------------------------------------------------------------------------
// The practice's side: pulling filed letters into Smart Inbox
// ---------------------------------------------------------------------------

/** Letters not yet pulled into the practice's data, oldest first. */
export async function pendingActivity(limit = 100) {
  await ensureSchema();
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  const { rows } = await query(
    // extracted_date as text: a pg `date` comes back as local midnight, which
    // toISOString() can shift a day in any timezone east of UTC.
    `select id, upload_id, client_id, document_type, period, extracted_reference, extracted_date::text as extracted_date, confidence, rationale, file_name, size_kb, created_at
       from telegram_activity where applied_at is null order by created_at asc limit $1`,
    [n],
  );
  return rows.map((r) => ({
    id: r.id,
    uploadId: r.upload_id,
    clientId: r.client_id ?? null,
    documentType: r.document_type,
    period: r.period ?? null,
    extractedReference: r.extracted_reference ?? null,
    extractedDate: r.extracted_date ?? null,
    confidence: Number(r.confidence),
    rationale: r.rationale,
    fileName: r.file_name,
    sizeKb: r.size_kb,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function markActivityApplied(ids) {
  await ensureSchema();
  const list = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
  if (list.length === 0) return 0;
  const { rowCount } = await query('update telegram_activity set applied_at = now() where applied_at is null and id = any($1)', [list]);
  return rowCount;
}

export async function readUpload(id) {
  await ensureSchema();
  const { rows } = await query('select file_name, content_type, content from telegram_uploads where id = $1', [id]);
  const row = rows[0];
  return row ? { fileName: row.file_name, contentType: row.content_type, content: row.content } : null;
}
