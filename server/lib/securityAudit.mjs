/**
 * The server's own security audit trail — the authoritative record of who did
 * what to the practice as a whole.
 *
 * Deliberately NOT PracticeData.auditEvents. Those are built by the browser
 * and saved inside the snapshot the browser sends, so a modified client (or
 * anyone with a session and curl) can write, edit or delete them freely; they
 * are a convenience activity trail and prove nothing. Rows here are only ever
 * written by server code, from the authenticated session (never from a
 * request body), and the table is append-only at the database level (see
 * lib/db.mjs: triggers refuse UPDATE, DELETE and TRUNCATE).
 *
 * What is recorded is who (user id, username, role at the time), what
 * (action, target), whether it went ahead (outcome), and the smallest detail
 * needed to understand it. Never passwords, tokens, cookie values, message
 * bodies or client data — this table must be safe to show to whoever audits
 * the practice.
 */
import { ensureSchema, query } from './db.mjs';

/** Fields that must never be stored, even if a caller passes them by mistake. */
const FORBIDDEN_DETAIL_KEYS = /password|token|secret|cookie|authorization|body|content/i;

function scrubDetails(details) {
  if (!details || typeof details !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(details)) {
    if (FORBIDDEN_DETAIL_KEYS.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Appends one event. `db` is anything with `.query(text, params)` — pass a
 * transaction client to make the record commit or roll back together with
 * the operation it describes (restore does); omit it to use the pool.
 *
 * `req` supplies the actor (req.user, set by requireAuth) and the network
 * details; `actor` overrides it for the few events that happen before a
 * session exists (a failed login).
 */
export async function recordSecurityEvent({ req, actor, action, outcome = 'success', targetType = null, targetId = null, details = {}, db = null }) {
  const who = actor ?? req?.user ?? null;
  const run = db ? (text, params) => db.query(text, params) : async (text, params) => {
    await ensureSchema();
    return query(text, params);
  };
  await run(
    `insert into security_audit_log (actor_user_id, actor_username, actor_role, action, outcome, target_type, target_id, details, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
    [
      who?.id ?? null,
      who?.username ?? null,
      who?.role ?? null,
      action,
      outcome,
      targetType,
      targetId === null || targetId === undefined ? null : String(targetId),
      JSON.stringify(scrubDetails(details)),
      req?.ip ?? null,
      typeof req?.get === 'function' ? (req.get('user-agent') ?? '').slice(0, 300) || null : null,
    ],
  );
}

/** Newest first. `limit` is clamped; filtering is by exact action only — this is a review tool, not a search engine. */
export async function readSecurityEvents({ limit = 100, action = null } = {}) {
  await ensureSchema();
  const capped = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { rows } = await query(
    `select id, occurred_at as "occurredAt", actor_user_id as "actorUserId", actor_username as "actorUsername", actor_role as "actorRole",
            action, outcome, target_type as "targetType", target_id as "targetId", details, ip
     from security_audit_log
     where ($2::text is null or action = $2)
     order by id desc limit $1`,
    [capped, action],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}
