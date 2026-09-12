/**
 * Seeds the three practice accounts on first boot against a fresh
 * database. Each account's temporary password comes from an environment
 * variable (so it is never committed to source control); an account whose
 * env var isn't set gets a random temporary password instead. That
 * generated password is logged to stdout only when LOG_GENERATED_PASSWORDS=1
 * — a deploy platform's logs are often visible to more people than have
 * credential access, so the default is to say an account needs setup
 * rather than print its password there. Idempotent — an account that
 * already exists is left untouched.
 *
 * Called once at boot (server/index.mjs, or once per dev/preview server
 * start in vite.config.ts) — not on every request. A seed account deleted
 * from the database stays deleted until the next restart, rather than
 * quietly reappearing on the next login attempt.
 *
 * Lost password: set the account's *_RESET_PASSWORD variable and restart.
 * The password becomes that value, a change is forced on the next sign-in,
 * and every session for the account is signed out. It is applied once per
 * value — a restart with the variable still set does nothing more, so a
 * forgotten variable can't keep resetting a password the person has since
 * changed. Remove the variable once they're back in.
 */
import { createHash } from 'node:crypto';
import { ensureSchema, query } from './db.mjs';
import { generateTempPassword, hashPassword } from './passwords.mjs';

const SEED_USERS = [
  { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: 'owner', envVar: 'ADNAN_TEMP_PASSWORD', resetVar: 'ADNAN_RESET_PASSWORD' },
  { id: 'u_farhan', username: 'farhan', name: 'Farhan', role: 'owner', envVar: 'FARHAN_TEMP_PASSWORD', resetVar: 'FARHAN_RESET_PASSWORD' },
  { id: 'u_rayhan', username: 'rayhan', name: 'Raihan', role: 'owner', envVar: 'RAYHAN_TEMP_PASSWORD', resetVar: 'RAYHAN_RESET_PASSWORD' },
];

// In-flight promise so concurrent callers (e.g. this run once at boot, but
// still cheap insurance) share one seeding pass rather than racing on the
// same INSERT.
let inFlight = null;

export function ensureSeedUsers() {
  if (!inFlight) {
    inFlight = runSeed().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function runSeed() {
  await ensureSchema();
  for (const spec of SEED_USERS) {
    const { rows } = await query('select id from practice_users where username = $1', [spec.username]);
    if (rows.length > 0) continue;
    const envPassword = process.env[spec.envVar];
    const password = envPassword || generateTempPassword();
    const { hash, salt } = await hashPassword(password);
    await query(
      'insert into practice_users (id, username, name, role, password_hash, password_salt, must_change_password) values ($1,$2,$3,$4,$5,$6,true)',
      [spec.id, spec.username, spec.name, spec.role, hash, salt],
    );
    const log = { level: 'info', at: new Date().toISOString(), message: `Created account "${spec.username}"`, source: envPassword ? 'env' : 'generated' };
    if (!envPassword) {
      if (process.env.LOG_GENERATED_PASSWORDS === '1') log.temporaryPassword = password;
      else log.message += ` — a temporary password was generated but not logged; set ${spec.envVar} or LOG_GENERATED_PASSWORDS=1 to see it`;
    }
    console.log(JSON.stringify(log));
  }
  await applyPasswordResets();
}

/** Which reset value was applied, without storing the value: enough to tell "same variable still set" from "a new value". */
function resetMarker(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function applyPasswordResets() {
  for (const spec of SEED_USERS) {
    const value = process.env[spec.resetVar];
    if (!value) continue;
    const { rows } = await query('select id, password_reset_applied from practice_users where username = $1', [spec.username]);
    const row = rows[0];
    if (!row) continue;
    const marker = resetMarker(value);
    if (row.password_reset_applied === marker) {
      console.log(JSON.stringify({ level: 'info', at: new Date().toISOString(), message: `${spec.resetVar} is still set but was already applied — remove the variable; it will not reset the password again` }));
      continue;
    }
    if (value.length < 8) {
      console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), message: `${spec.resetVar} ignored: a reset password must be at least 8 characters` }));
      continue;
    }
    const { hash, salt } = await hashPassword(value);
    await query('update practice_users set password_hash = $1, password_salt = $2, must_change_password = true, password_reset_applied = $3 where id = $4', [hash, salt, marker, row.id]);
    await query('delete from practice_sessions where user_id = $1', [row.id]);
    console.log(JSON.stringify({ level: 'info', at: new Date().toISOString(), message: `Password for "${spec.username}" reset from ${spec.resetVar}; every session for the account was signed out and a new password must be set on the next sign-in — remove the variable once they are back in` }));
  }
}
