import pg from 'pg';

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
  // Re-seeded on next request. Pin ADNAN_TEMP_PASSWORD / FARHAN_TEMP_PASSWORD
  // / RAYHAN_TEMP_PASSWORD when running this suite so the seeded passwords
  // are deterministic across repeated runs, not freshly randomised each time.
  await p.query('delete from practice_users');
}
