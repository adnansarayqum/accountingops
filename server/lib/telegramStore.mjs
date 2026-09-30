/**
 * Telegram linking persistence. See telegram.mjs for the rules; this is
 * only where the rows live — telegram_links and telegram_link_codes, never
 * the practice snapshot (see db.mjs's ensureSchema for why).
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
