import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDatabaseUrl = process.env.DATABASE_URL;

/**
 * db.mjs caches its connection pool for the life of the module, so each
 * case imports a fresh copy of health.mjs (and therefore db.mjs) after
 * setting DATABASE_URL — otherwise the first case's pool would answer for
 * every later one regardless of the URL.
 */
async function freshHealthPayload() {
  vi.resetModules();
  const { healthPayload } = await import('../health.mjs');
  return healthPayload();
}

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('healthPayload', () => {
  it('reports no database configured, with reachability not applicable', async () => {
    delete process.env.DATABASE_URL;
    expect(await freshHealthPayload()).toEqual({ status: 'ok', database: false, databaseReachable: null });
  });

  it('reports a configured but unreachable database as degraded, not as "no database"', async () => {
    // Nothing listens on port 1; the connection is refused immediately.
    process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/nowhere';
    process.env.PGSSLMODE = 'disable';
    const payload = await freshHealthPayload();
    expect(payload).toEqual({ status: 'degraded', database: true, databaseReachable: false });
  });

  it.skipIf(!originalDatabaseUrl)('reports a reachable database as ok', async () => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    expect(await freshHealthPayload()).toEqual({ status: 'ok', database: true, databaseReachable: true });
  });
});
