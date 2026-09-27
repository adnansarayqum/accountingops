/**
 * Server-side authorisation: what each role may do, and the middleware that
 * enforces it. The single source of truth for the matrix documented in
 * docs/PERMISSIONS.md — change one, change the other.
 *
 * The role that counts is `practice_users.role` (the row behind the session
 * cookie, loaded by requireAuth), never a `role` a request body or a snapshot
 * claims: the browser is not trusted to say who it is.
 *
 * Least privilege, fail closed: a permission not listed for a role is denied,
 * and a role this table has never heard of holds nothing at all. Ordinary
 * accountancy work (reading and saving practice data, sending a reminder,
 * checking VAT obligations) is open to every known role; what is reserved is
 * the practice-wide, hard-to-undo tier — restoring history, connecting the
 * practice to HMRC, and editing the practice's own settings and team.
 */
import { recordSecurityEvent } from './securityAudit.mjs';

export const PERMISSIONS = Object.freeze({
  /** Read the shared practice snapshot. */
  DATA_READ: 'data.read',
  /** Save the shared practice snapshot — ordinary client, job and communication work. */
  DATA_WRITE: 'data.write',
  /** See which earlier snapshot versions exist (metadata only). */
  HISTORY_READ: 'history.read',
  /** Replace the live practice data with an earlier version. Affects everyone, every client. */
  SNAPSHOT_RESTORE: 'snapshot.restore',
  /** Change practice-level settings: name, timezone, timing thresholds. */
  PRACTICE_CONFIGURE: 'practice.configure',
  /** Change the team roster: who is on it, their roles and capacity. */
  TEAM_MANAGE: 'team.manage',
  /** Link the practice's HMRC agent account to this app, or unlink it. */
  HMRC_CONNECT: 'hmrc.connect',
  /** Look up clients' VAT obligations through the existing HMRC connection. */
  HMRC_READ: 'hmrc.read',
  /** Send a client email through the configured provider. */
  MESSAGES_SEND: 'messages.send',
  /** Read the server's security audit trail. */
  AUDIT_READ: 'audit.read',
});

const P = PERMISSIONS;

const ORDINARY_WORK = [P.DATA_READ, P.DATA_WRITE, P.HISTORY_READ, P.MESSAGES_SEND];

/**
 * `admin` is treated as office administration, not as a superuser: the same
 * day-to-day access as an accountant. Nothing in the app creates one today
 * (every seeded account is an owner), so this only ever narrows.
 */
export const ROLE_PERMISSIONS = Object.freeze({
  owner: Object.freeze(Object.values(P)),
  manager: Object.freeze([...ORDINARY_WORK, P.HMRC_READ, P.PRACTICE_CONFIGURE]),
  accountant: Object.freeze([...ORDINARY_WORK, P.HMRC_READ]),
  admin: Object.freeze([...ORDINARY_WORK, P.HMRC_READ]),
});

/** Whether `role` holds `permission`. Unknown roles and unknown permissions are denied. */
export function can(role, permission) {
  return Object.hasOwn(ROLE_PERMISSIONS, role) && ROLE_PERMISSIONS[role].includes(permission);
}

/** Every permission `role` holds — sent to the browser so its UI can hide what the server would refuse. */
export function permissionsFor(role) {
  return Object.hasOwn(ROLE_PERMISSIONS, role) ? [...ROLE_PERMISSIONS[role]] : [];
}

/**
 * Records a refusal in the security audit trail. Best effort by design: a
 * failure to write the note must not turn a refusal into a 500 (the request
 * is denied either way), but it is logged loudly.
 */
export async function auditDenial(req, permission, extra = {}) {
  try {
    await recordSecurityEvent({
      req,
      action: 'authorization.denied',
      outcome: 'denied',
      targetType: 'permission',
      targetId: permission,
      details: { method: req.method, path: req.baseUrl ? `${req.baseUrl}${req.path}` : req.path, ...extra },
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'security_audit', message: `Could not record a denial: ${err?.message ?? err}` }));
  }
}

/** Sends the standard 403 and records it. */
export async function deny(req, res, permission, extra) {
  await auditDenial(req, permission, extra);
  return res.status(403).json({ error: 'forbidden', permission });
}

/**
 * Route guard. Must run after requireAuth (which sets req.user); without a
 * user it answers 401 rather than guessing.
 */
export function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'not_authenticated' });
    if (!can(req.user.role, permission)) return deny(req, res, permission);
    next();
  };
}
