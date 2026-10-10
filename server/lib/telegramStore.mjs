/**
 * What remains of the retired Telegram bot: the photos it stored. Smart
 * Inbox items and documents filed through it still link to them, so they
 * stay readable; nothing new is written here (sharing into the app —
 * routes/intake.mjs — replaced the bot).
 */
import { ensureSchema, query } from './db.mjs';

export async function readUpload(id) {
  await ensureSchema();
  const { rows } = await query('select file_name, content_type, content from telegram_uploads where id = $1', [id]);
  const row = rows[0];
  return row ? { fileName: row.file_name, contentType: row.content_type, content: row.content } : null;
}
