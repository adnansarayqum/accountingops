/**
 * Personal upload keys for the iPhone Shortcut. A Shortcut can't hold a
 * signed-in session, so each person makes a key in Settings and pastes it
 * into the Shortcut. The key opens exactly one door — sending a share to
 * POST /api/intake/batches — and is the only thing here a person has to
 * keep secret.
 *
 * Only a SHA-256 of the key is stored (it is 256 random bits, so a fast hash
 * is enough — there is nothing to brute-force). The key itself is returned
 * once, when made. Keys are revoked one at a time, or all at once when the
 * account signs out everywhere, changes its password or has it reset.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ensureSchema, query } from './db.mjs';

/** Recognisable on sight, and to secret scanners, as one of this app's keys. */
export const TOKEN_PREFIX = 'frk_';
export const MAX_ACTIVE_TOKENS = 5;
export const MAX_LABEL_CHARS = 60;
/** last_used_at is only rewritten when older than this, so a busy Shortcut doesn't write on every upload. */
const TOUCH_AFTER_MINUTES = 5;

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** The key out of an `Authorization: Bearer …` header, or null when there is none. */
export function parseBearer(header) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(typeof header === 'string' ? header : '');
  return match ? match[1] : null;
}

/** Makes a key for a user. Returns { id, label, token } (token shown once) or { error: 'too_many' }. */
export async function createToken(userId, label) {
  await ensureSchema();
  const { rows } = await query('select count(*)::int as n from intake_tokens where user_id = $1 and revoked_at is null', [userId]);
  if (rows[0].n >= MAX_ACTIVE_TOKENS) return { error: 'too_many' };
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const id = `ink_${randomUUID()}`;
  const clean = String(label ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_CHARS) || 'iPhone';
  await query('insert into intake_tokens (id, user_id, token_hash, label) values ($1, $2, $3, $4)', [id, userId, hashToken(token), clean]);
  return { id, label: clean, token };
}

export async function listTokens(userId) {
  await ensureSchema();
  const { rows } = await query(
    'select id, label, created_at, last_used_at from intake_tokens where user_id = $1 and revoked_at is null order by created_at desc',
    [userId],
  );
  return rows.map((r) => ({ id: r.id, label: r.label, createdAt: new Date(r.created_at).toISOString(), lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null }));
}

/** Revokes one of this user's keys. Returns whether there was one to revoke. */
export async function revokeToken(id, userId) {
  await ensureSchema();
  const { rowCount } = await query('update intake_tokens set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null', [id, userId]);
  return rowCount > 0;
}

export async function revokeAllTokens(userId) {
  await ensureSchema();
  const { rowCount } = await query('update intake_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
  return rowCount;
}

/**
 * The user a key belongs to, or null for an unknown or revoked key — or an
 * account still on a temporary password, which can't reach any data route
 * and so can't use a key either.
 */
export async function userForToken(token) {
  await ensureSchema();
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
  const { rows } = await query(
    `select u.id, u.username, u.name, u.role, t.id as token_id, t.last_used_at
       from intake_tokens t
       join practice_users u on u.id = t.user_id
      where t.token_hash = $1 and t.revoked_at is null and not u.must_change_password`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > TOUCH_AFTER_MINUTES * 60 * 1000) {
    await query('update intake_tokens set last_used_at = now() where id = $1', [row.token_id]).catch(() => {});
  }
  return { id: row.id, username: row.username, name: row.name, role: row.role };
}
