/**
 * Session-cookie authentication for the three practice accounts. Mounted at
 * /api/auth by both the production server and the Vite dev server, same as
 * every other router here. Returns 503 (not the app's normal error shape)
 * when DATABASE_URL isn't configured, so the client can fall back to the
 * pre-auth, browser-only mode instead of getting stuck.
 */
import express from 'express';
import { randomBytes } from 'node:crypto';
import { isDatabaseConfigured, query } from '../lib/db.mjs';
import { hashPassword, verifyPassword } from '../lib/passwords.mjs';
import { ensureSeedUsers } from '../lib/bootstrapUsers.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { clearSessionCookie, parseCookies, SESSION_COOKIE, setSessionCookie } from '../lib/cookies.mjs';

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

export async function currentUser(req) {
  if (!isDatabaseConfigured()) return null;
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await query(
    `select u.id, u.username, u.name, u.role, u.must_change_password as "mustChangePassword"
     from practice_sessions s
     join practice_users u on u.id = s.user_id
     where s.token = $1 and s.expires_at > now()`,
    [token],
  );
  return rows[0] ?? null;
}

/** Reusable guard for any other router that needs a signed-in user (e.g. practiceData). */
export async function requireAuth(req, res, next) {
  if (!isDatabaseConfigured()) return res.status(503).json({ error: 'not_configured' });
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  req.user = user;
  next();
}

const router = express.Router();
router.use(express.json());

router.use(async (req, res, next) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ error: 'not_configured' });
  try {
    await ensureSeedUsers();
    next();
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginByAddress, loginByUsername, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: 'missing_credentials' });
  const { rows } = await query('select * from practice_users where username = $1', [normaliseUsername(username)]);
  const user = rows[0];
  const ok = user ? await verifyPassword(String(password), user.password_hash, user.password_salt) : await verifyAgainstDecoy(String(password));
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query('insert into practice_sessions (token, user_id, expires_at) values ($1,$2,$3)', [token, user.id, expiresAt]);
  setSessionCookie(res, token, expiresAt);
  res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role, mustChangePassword: user.must_change_password } });
});

router.post('/logout', async (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await query('delete from practice_sessions where token = $1', [token]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  res.json({ user });
});

router.post('/change-password', async (req, res) => {
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
  res.json({ ok: true });
});

export default router;
