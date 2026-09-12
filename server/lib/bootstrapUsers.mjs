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
 */
import { ensureSchema, query } from './db.mjs';
import { generateTempPassword, hashPassword } from './passwords.mjs';

const SEED_USERS = [
  { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: 'owner', envVar: 'ADNAN_TEMP_PASSWORD' },
  { id: 'u_farhan', username: 'farhan', name: 'Farhan', role: 'owner', envVar: 'FARHAN_TEMP_PASSWORD' },
  { id: 'u_rayhan', username: 'rayhan', name: 'Raihan', role: 'owner', envVar: 'RAYHAN_TEMP_PASSWORD' },
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
}
