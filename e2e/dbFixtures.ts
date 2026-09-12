import pg from 'pg';
import { ensureSeedUsers } from '../server/lib/bootstrapUsers.mjs';

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  // One pool for the whole test run, not a fresh connect/disconnect per
  // test — opening and tearing down a pool on every beforeEach added
  // connection-churn timing that made the suite occasionally flaky.
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  });
  return pool;
}

/** Wipes auth + shared practice data between e2e runs against a real local test Postgres. */
export async function resetServerState(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const p = getPool();
  await p.query('delete from practice_sessions');
  await p.query('delete from practice_snapshots');
  await p.query('delete from practice_snapshot_history').catch(() => {});
  await p.query('delete from practice_users');
  // Accounts are seeded once at server boot now, not on every request (see
  // server/lib/bootstrapUsers.mjs), so this test hook re-seeds immediately
  // itself rather than relying on the app under test to do it. Pin
  // ADNAN_TEMP_PASSWORD / FARHAN_TEMP_PASSWORD / RAYHAN_TEMP_PASSWORD when
  // running this suite so the seeded passwords are deterministic across
  // repeated runs, not freshly randomised each time.
  await ensureSeedUsers();
}
