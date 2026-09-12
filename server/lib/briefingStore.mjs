/**
 * Who gets the morning briefing, where, and when they last got it. Three
 * columns on practice_users: an address (accounts have a username, not an
 * email, so this is the first place one is recorded), a switch, and the
 * local date of the last send so a restart at 07:30 doesn't send twice and
 * a server asleep at seven still sends once it wakes.
 */
import { ensureSchema, query } from './db.mjs';

const PRACTICE_ID = 'prac_main';

export async function readBriefingSettings(userId) {
  await ensureSchema();
  const { rows } = await query('select briefing_email, briefing_enabled, briefing_last_sent_on from practice_users where id = $1', [userId]);
  const row = rows[0];
  if (!row) return null;
  return { email: row.briefing_email ?? null, enabled: Boolean(row.briefing_enabled), lastSentOn: row.briefing_last_sent_on ? String(row.briefing_last_sent_on).slice(0, 10) : null };
}

export async function writeBriefingSettings(userId, { email, enabled }) {
  await ensureSchema();
  await query('update practice_users set briefing_email = $2, briefing_enabled = $3 where id = $1', [userId, email ?? null, Boolean(enabled)]);
  return readBriefingSettings(userId);
}

/** Everyone switched on with an address to send to. */
export async function listBriefingRecipients() {
  await ensureSchema();
  const { rows } = await query('select id, name, briefing_email, briefing_last_sent_on from practice_users where briefing_enabled and briefing_email is not null');
  return rows.map((r) => ({ userId: r.id, name: r.name, email: r.briefing_email, lastSentOn: r.briefing_last_sent_on ? String(r.briefing_last_sent_on).slice(0, 10) : null }));
}

export async function markBriefingSent(userId, localDate) {
  await query('update practice_users set briefing_last_sent_on = $2 where id = $1', [userId, localDate]);
}

export async function readPracticeSnapshot() {
  await ensureSchema();
  const { rows } = await query('select data from practice_snapshots where practice_id = $1', [PRACTICE_ID]);
  return rows[0]?.data ?? null;
}
