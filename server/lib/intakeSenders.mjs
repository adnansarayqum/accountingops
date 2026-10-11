/**
 * Who a forwarded email is for. Each person lists the addresses they
 * forward from (their own mail accounts); an email is filed for whichever
 * user lists its sender, and ignored when nobody does. An address can
 * belong to only one person, or one forward could land in two inboxes.
 */
import { ensureSchema, getPool, query } from './db.mjs';
import { normaliseEmail } from './inboundEmail.mjs';

export const MAX_SENDERS = 5;

export async function listSenders(userId) {
  await ensureSchema();
  const { rows } = await query('select email from intake_senders where user_id = $1 order by created_at, email', [userId]);
  return rows.map((r) => r.email);
}

/** The user an email from this address is for, or null. */
export async function userForSender(email) {
  await ensureSchema();
  const address = normaliseEmail(email);
  if (!address) return null;
  const { rows } = await query(
    `select u.id, u.username, u.name, u.role
       from intake_senders s join practice_users u on u.id = s.user_id
      where s.email = $1 and not u.must_change_password`,
    [address],
  );
  return rows[0] ?? null;
}

/**
 * Replaces a user's list with these addresses. Returns { senders } or
 * { error: 'invalid' | 'too_many' | 'taken', email? } — `taken` names the
 * address another person already has.
 */
export async function setSenders(userId, emails) {
  await ensureSchema();
  const wanted = [];
  for (const raw of Array.isArray(emails) ? emails : []) {
    const email = normaliseEmail(raw);
    if (!email) return { error: 'invalid', email: String(raw).slice(0, 80) };
    if (!wanted.includes(email)) wanted.push(email);
  }
  if (wanted.length > MAX_SENDERS) return { error: 'too_many' };

  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('delete from intake_senders where user_id = $1', [userId]);
    for (const email of wanted) {
      const { rowCount } = await client.query('insert into intake_senders (email, user_id) values ($1, $2) on conflict (email) do nothing', [email, userId]);
      if (rowCount === 0) {
        await client.query('rollback');
        return { error: 'taken', email };
      }
    }
    await client.query('commit');
    return { senders: wanted };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
