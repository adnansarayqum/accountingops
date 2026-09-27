/**
 * Durable idempotency for real outbound email.
 *
 * A double-click, a retried request, a second tab, or a request replayed
 * after a server restart must not send a client the same reminder twice. The
 * first version remembered keys in a Map: gone on restart, invisible to a
 * second server instance, and — worse — checked and then set with an `await`
 * in between, so two simultaneous requests could both find nothing and both
 * send.
 *
 * Here the claim IS an INSERT into `email_send_claims` (primary key
 * `(scope, idempotency_key)`), so the database decides who won: exactly one
 * request per key gets `claimed` and may call the provider; every concurrent
 * or later request sees the winner's row.
 *
 *   pending   claimed, provider call in progress. Others get `in_progress`.
 *   sent      provider accepted it. The stored result is replayed unchanged.
 *   unknown   we cannot tell whether the provider sent it (connection lost
 *             mid-call, a crash after the claim, a lease that ran out).
 *             Never re-sent automatically — a duplicate to a client is worse
 *             than asking a person to check.
 *
 * A send the provider definitively refused is released (row deleted): nothing
 * left, so the same key may try again once the cause is fixed.
 *
 * Keys are scoped to the signed-in user, so one person's key can never replay
 * — or block — another's, and are bound to the message they were first used
 * for (`request_hash`): the same key with different content is refused rather
 * than answered with the wrong message's result.
 *
 * Only authenticated sends use this. The browser-only (no database)
 * simulated mode keeps its own in-memory map in routes/messages.mjs — it
 * sends nothing, so losing that memory on restart costs nothing.
 */
import { createHash } from 'node:crypto';
import { ensureSchema, query } from './db.mjs';

/** How long a finished claim is remembered — the window in which a retry is answered from it. */
export const CLAIM_TTL_HOURS = 24;

/** How long a provider call may hold `pending` before its outcome is treated as unknown. Must exceed the provider timeout. */
export const CLAIM_LEASE_SECONDS = 120;

/** Stable digest of what a key was first used to send. */
export function hashMessage({ channel, to, subject, body, replyTo }) {
  return createHash('sha256').update(JSON.stringify([channel, to, subject, body, replyTo ?? ''])).digest('hex');
}

let lastPurge = 0;

/** Expired claims are dead weight; sweep them at most once a minute per process, without making a request wait on it. */
function purgeExpiredSoon() {
  const now = Date.now();
  if (now - lastPurge < 60_000) return;
  lastPurge = now;
  void query("delete from email_send_claims where expires_at <= now() - interval '1 hour'").catch(() => {});
}

/**
 * Tries to claim (scope, key) for a message with digest `requestHash`.
 * Resolves to one of:
 *   { state: 'claimed' }                 you own it — call the provider, then complete or release
 *   { state: 'replay', result }          already sent — answer with `result`
 *   { state: 'in_progress' }             another request holds it right now
 *   { state: 'unknown' }                 sent-or-not is unknowable; do not send again
 *   { state: 'mismatch' }                the key was first used for a different message
 */
export async function claimSend({ scope, key, requestHash }) {
  await ensureSchema();
  purgeExpiredSoon();
  // Two attempts: the row we lose to can be released (deleted) between our
  // failed insert and our read of it, in which case the next insert wins.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const claimed = await query(
      `insert into email_send_claims (scope, idempotency_key, request_hash, status, lease_expires_at, expires_at)
       values ($1, $2, $3, 'pending', now() + make_interval(secs => $4), now() + make_interval(hours => $5))
       on conflict (scope, idempotency_key) do update
         set request_hash = excluded.request_hash, status = 'pending', result = null,
             created_at = now(), updated_at = now(),
             lease_expires_at = excluded.lease_expires_at, expires_at = excluded.expires_at
         where email_send_claims.expires_at <= now()
       returning 1`,
      [scope, key, requestHash, CLAIM_LEASE_SECONDS, CLAIM_TTL_HOURS],
    );
    if (claimed.rowCount === 1) return { state: 'claimed' };

    const { rows } = await query(
      `select request_hash, status, result, lease_expires_at <= now() as "leaseExpired"
       from email_send_claims where scope = $1 and idempotency_key = $2`,
      [scope, key],
    );
    const row = rows[0];
    if (!row) continue;
    if (row.request_hash !== requestHash) return { state: 'mismatch' };
    if (row.status === 'sent') return { state: 'replay', result: row.result };
    if (row.status === 'unknown') return { state: 'unknown' };
    if (row.leaseExpired) {
      // The request that claimed this never reported back. It may have
      // reached the provider; we cannot know, so we do not risk a second send.
      await markUnknown({ scope, key });
      return { state: 'unknown' };
    }
    return { state: 'in_progress' };
  }
  return { state: 'in_progress' };
}

/** Records the provider's acceptance; from now on every retry of the key replays `result`. */
export async function completeSend({ scope, key, result }) {
  await query(
    "update email_send_claims set status = 'sent', result = $3::jsonb, updated_at = now() where scope = $1 and idempotency_key = $2 and status = 'pending'",
    [scope, key, JSON.stringify(result)],
  );
}

/** The provider definitively did not send: forget the claim so the key can be tried again. */
export async function releaseSend({ scope, key }) {
  await query("delete from email_send_claims where scope = $1 and idempotency_key = $2 and status = 'pending'", [scope, key]);
}

/** The outcome cannot be known: keep the claim, and refuse to send this key again. */
export async function markUnknown({ scope, key }) {
  await query("update email_send_claims set status = 'unknown', updated_at = now() where scope = $1 and idempotency_key = $2 and status = 'pending'", [scope, key]);
}
