/**
 * Seeds the three practice accounts on first boot against a fresh
 * database. Each account's temporary password comes from an environment
 * variable (so it is never committed to source control); an account whose
 * env var isn't set gets a random temporary password instead, logged once
 * to stdout so it can be retrieved from the deploy platform's logs.
 * Idempotent — an account that already exists is left untouched.
 */
import { ensureSchema, query } from './db.mjs';
import { generateTempPassword, hashPassword } from './passwords.mjs';

const SEED_USERS = [
  { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: 'owner', envVar: 'ADNAN_TEMP_PASSWORD' },
  { id: 'u_farhan', username: 'farhan', name: 'Farhan', role: 'owner', envVar: 'FARHAN_TEMP_PASSWORD' },
  { id: 'u_rayhan', username: 'rayhan', name: 'Rayhan', role: 'owner', envVar: 'RAYHAN_TEMP_PASSWORD' },
];

// In-flight promise, not a permanent "already done" flag: concurrent
// requests share one seeding pass (so two simultaneous cold-start requests
// can't race on the same INSERT), but each new call after the previous one
// settles re-checks the table. That makes this self-healing — if a seed
// account is ever removed from the database, the next request recreates it
// — for a real cost of three cheap, indexed SELECTs per request, which is
// negligible for a handful of practice accounts.
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
    const { hash, salt } = hashPassword(password);
    await query(
      'insert into practice_users (id, username, name, role, password_hash, password_salt, must_change_password) values ($1,$2,$3,$4,$5,$6,true)',
      [spec.id, spec.username, spec.name, spec.role, hash, salt],
    );
    const log = { level: 'info', at: new Date().toISOString(), message: `Created account "${spec.username}"`, source: envPassword ? 'env' : 'generated' };
    if (!envPassword) log.temporaryPassword = password;
    console.log(JSON.stringify(log));
  }
}
