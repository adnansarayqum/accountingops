/**
 * Session-cookie authentication for the three practice accounts. Mounted at
 * /api/auth by both the production server and the Vite dev server, same as
 * every other router here. Returns 503 (not the app's normal error shape)
 * when DATABASE_URL isn't configured, so the client can fall back to the
 * pre-auth, browser-only mode instead of getting stuck.
 *
 * Session tokens are stored hashed (see lib/sessionTokens.mjs) — a database
 * row alone can never authenticate as anyone. Accounts are seeded once at
 * boot (server/index.mjs, or once per dev/preview server start in
 * vite.config.ts), not on every request here.
 */
import express from 'express';
import { randomBytes } from 'node:crypto';
import { isDatabaseConfigured, query } from '../lib/db.mjs';
import { hashPassword, needsRehash, verifyPassword } from '../lib/passwords.mjs';
import { hashSessionToken } from '../lib/sessionTokens.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { clearSessionCookie, parseCookies, SESSION_COOKIE, setSessionCookie } from '../lib/cookies.mjs';
import { permissionsFor } from '../lib/authorization.mjs';
import { recordSecurityEvent } from '../lib/securityAudit.mjs';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

// Three accounts with human-typed passwords: ten tries in a quarter of an
// hour is generous for a person who has forgotten which password they set
// and hopeless for anyone guessing. The per-address limit is a backstop so
// one machine can't spread a guessing run across all three usernames.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPTS_PER_USERNAME = 10;
const LOGIN_ATTEMPTS_PER_ADDRESS = 60;

function normaliseUsername(value) {
  return String(value ?? '').toLowerCase().trim();
}

const loginByUsername = createRateLimiter({
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_ATTEMPTS_PER_USERNAME,
  keyFor: (req) => normaliseUsername(req.body?.username),
  name: 'too_many_attempts',
});
const loginByAddress = createRateLimiter({
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_ATTEMPTS_PER_ADDRESS,
  keyFor: (req) => req.ip,
  name: 'too_many_attempts',
});

/** Test hook — forget every login attempt counted so far. */
export function resetLoginLimits() {
  loginByUsername.reset();
  loginByAddress.reset();
}

// A login for a username that doesn't exist must cost the same as one for
// a username that does, or the response time alone reveals which of the
// three account names are real. Derived once, lazily, so importing this
// module never blocks on a key derivation.
let decoy = null;
async function verifyAgainstDecoy(password) {
  decoy ??= await hashPassword(randomBytes(24).toString('hex'));
  await verifyPassword(password, decoy.hash, decoy.salt);
  return false;
}

/**
 * A hash made with older (or the original, un-parameterised) scrypt cost is
 * re-derived at the current cost the moment the password is known to be
 * right — sign-in is the only time the server has it. Best effort: a
 * failure here must not turn a correct password into a failed login.
 */
async function upgradeHashIfStale(user, password) {
  if (!needsRehash(user.password_hash, user.password_salt)) return;
  try {
    const { hash, salt } = await hashPassword(password);
    await query('update practice_users set password_hash = $1, password_salt = $2 where id = $3 and password_hash = $4', [hash, salt, user.id, user.password_hash]);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'password hash upgrade failed', userId: user.id, error: err instanceof Error ? err.message : String(err) }));
  }
}

export async function currentUser(req) {
  if (!isDatabaseConfigured()) return null;
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await query(
    `select u.id, u.username, u.name, u.role, u.must_change_password as "mustChangePassword"
     from practice_sessions s
     join practice_users u on u.id = s.user_id
     where s.token = $1 and s.expires_at > now()`,
    [hashSessionToken(token)],
  );
  return rows[0] ?? null;
}

/**
 * Reusable guard for any other router that needs a signed-in user (e.g.
 * practiceData, companiesHouse, messages). Also the enforcement point for
 * "must change password first": a session is fully valid the moment it's
 * created (so /me and /change-password work), but it may not touch any
 * data route until the temporary password has been replaced — previously
 * this was only enforced by the client showing the change-password screen,
 * so a session cookie obtained any other way (a temp password read from
 * deploy logs, say) could reach every client's identifiers regardless.
 */
export async function requireAuth(req, res, next) {
  if (!isDatabaseConfigured()) return res.status(503).json({ error: 'not_configured' });
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  if (user.mustChangePassword) return res.status(403).json({ error: 'password_change_required' });
  req.user = user;
  next();
}

const router = express.Router();
router.use(express.json());

router.use((req, res, next) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ error: 'not_configured' });
  next();
});

/**
 * Writes to the security audit log without ever failing the request: sign-in
 * must not become unavailable because the note about it could not be saved
 * (the failure is logged). Operations that change the practice as a whole
 * are stricter — see routes/practiceData.mjs and routes/hmrc.mjs.
 */
async function auditBestEffort(event) {
  try {
    await recordSecurityEvent(event);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'security_audit', message: `Could not record ${event.action}: ${err?.message ?? err}` }));
  }
}

router.post('/login', loginByAddress, loginByUsername, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: 'missing_credentials' });
  const { rows } = await query('select * from practice_users where username = $1', [normaliseUsername(username)]);
  const user = rows[0];
  const ok = user ? await verifyPassword(String(password), user.password_hash, user.password_salt) : await verifyAgainstDecoy(String(password));
  if (!ok) {
    // The attempted username is recorded (capped); the password never is. An
    // unknown name and a wrong password look identical to the caller and are
    // told apart only here, where an administrator can see them.
    await auditBestEffort({ req, actor: { id: user?.id ?? null, username: normaliseUsername(username).slice(0, 100), role: user?.role ?? null }, action: 'auth.login', outcome: 'failure', targetType: 'user', targetId: user?.id ?? null, details: { knownUser: Boolean(user) } });
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  await upgradeHashIfStale(user, String(password));
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query('insert into practice_sessions (token, user_id, expires_at) values ($1,$2,$3)', [hashSessionToken(token), user.id, expiresAt]);
  setSessionCookie(res, token, expiresAt);
  await auditBestEffort({ req, actor: { id: user.id, username: user.username, role: user.role }, action: 'auth.login', targetType: 'user', targetId: user.id, details: { mustChangePassword: user.must_change_password } });
  res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role, mustChangePassword: user.must_change_password, permissions: permissionsFor(user.role) } });
});

router.post('/logout', async (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await query('delete from practice_sessions where token = $1', [hashSessionToken(token)]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** Signs out every session for this account, not just the one making the request — "I think someone else has access". */
router.post('/logout-everywhere', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  await query('delete from practice_sessions where user_id = $1', [user.id]);
  await auditBestEffort({ req, actor: user, action: 'auth.logout_everywhere', targetType: 'user', targetId: user.id });
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  // What this role may do, computed here so the UI never carries its own
  // copy of the matrix (docs/PERMISSIONS.md). Advisory for the UI only: every
  // route re-checks on the server.
  res.json({ user: { ...user, permissions: permissionsFor(user.role) } });
});

router.post('/change-password', async (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ error: 'weak_password' });
  const { rows } = await query('select password_hash, password_salt from practice_users where id = $1', [user.id]);
  const row = rows[0];
  if (!row || !(await verifyPassword(String(currentPassword ?? ''), row.password_hash, row.password_salt))) {
    return res.status(401).json({ error: 'invalid_current_password' });
  }
  const { hash, salt } = await hashPassword(newPassword);
  await query('update practice_users set password_hash = $1, password_salt = $2, must_change_password = false where id = $3', [hash, salt, user.id]);
  // A password change is often exactly the moment someone worries who else
  // has access — make it actually lock the others out, not just the
  // account. Keeps the session making this request signed in.
  await query('delete from practice_sessions where user_id = $1 and token != $2', [user.id, hashSessionToken(token)]);
  await auditBestEffort({ req, actor: user, action: 'auth.password_changed', targetType: 'user', targetId: user.id, details: { wasTemporary: user.mustChangePassword } });
  res.json({ ok: true });
});

export default router;
