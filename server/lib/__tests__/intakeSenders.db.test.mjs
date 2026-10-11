import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

/** Forwarding-sender addresses against real PostgreSQL, in their own schema. Skipped unless DATABASE_URL is set. */
const RAW_URL = process.env.DATABASE_URL;
const RUN = Boolean(RAW_URL);
const SCHEMA = `t_senders_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
const sslOption = () => (process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false });

async function withAdmin(fn) {
  const admin = new pg.Client({ connectionString: RAW_URL, ssl: sslOption() });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

describe.skipIf(!RUN)('forwarding senders (PostgreSQL)', () => {
  let db;
  let senders;
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await withAdmin((admin) => admin.query(`create schema ${SCHEMA}`));
    const url = new URL(RAW_URL);
    url.searchParams.set('options', `-c search_path=${SCHEMA}`);
    process.env.DATABASE_URL = url.toString();
    db = await import('../db.mjs');
    senders = await import('../intakeSenders.mjs');
    await db.ensureSchema();
    for (const id of ['u_ray', 'u_farhan']) {
      await db.query("insert into practice_users (id, username, name, role, password_hash, password_salt) values ($1, $1, $1, 'owner', 'x', 'x')", [id]);
    }
  });

  beforeEach(async () => {
    await db.query('delete from intake_senders');
    await db.query('update practice_users set must_change_password = false');
  });

  afterAll(async () => {
    await db?.getPool().end();
    process.env.DATABASE_URL = originalUrl;
    await withAdmin((admin) => admin.query(`drop schema ${SCHEMA} cascade`));
  });

  it('saves a user’s addresses, tidied and de-duplicated, replacing the old list', async () => {
    expect(await senders.setSenders('u_ray', ['Ray@Example.com', 'ray@example.com', 'ray@work.co.uk'])).toEqual({ senders: ['ray@example.com', 'ray@work.co.uk'] });
    expect(await senders.listSenders('u_ray')).toEqual(['ray@example.com', 'ray@work.co.uk']);
    expect(await senders.setSenders('u_ray', ['new@example.com'])).toEqual({ senders: ['new@example.com'] });
    expect(await senders.listSenders('u_ray')).toEqual(['new@example.com']);
    expect(await senders.setSenders('u_ray', [])).toEqual({ senders: [] });
  });

  it('finds the user an address belongs to — case-insensitively, and not for an unknown or unusable one', async () => {
    await senders.setSenders('u_ray', ['ray@example.com']);
    expect(await senders.userForSender('RAY@example.com')).toEqual({ id: 'u_ray', username: 'u_ray', name: 'u_ray', role: 'owner' });
    expect(await senders.userForSender('someone@else.com')).toBeNull();
    expect(await senders.userForSender('not an address')).toBeNull();
    await db.query("update practice_users set must_change_password = true where id = 'u_ray'");
    expect(await senders.userForSender('ray@example.com')).toBeNull();
  });

  it('gives an address to one person only, and leaves the list as it was when one is taken', async () => {
    await senders.setSenders('u_ray', ['shared@example.com', 'ray@example.com']);
    expect(await senders.setSenders('u_farhan', ['farhan@example.com', 'shared@example.com'])).toEqual({ error: 'taken', email: 'shared@example.com' });
    expect(await senders.listSenders('u_farhan')).toEqual([]);
    expect(await senders.setSenders('u_ray', ['shared@example.com', 'extra@example.com'])).toEqual({ senders: ['shared@example.com', 'extra@example.com'] });
  });

  it('refuses a bad address, and more than five', async () => {
    await senders.setSenders('u_ray', ['keep@example.com']);
    expect(await senders.setSenders('u_ray', ['ok@example.com', 'nope'])).toEqual({ error: 'invalid', email: 'nope' });
    expect(await senders.setSenders('u_ray', Array.from({ length: 6 }, (_, i) => `a${i}@example.com`))).toEqual({ error: 'too_many' });
    expect(await senders.listSenders('u_ray')).toEqual(['keep@example.com']);
  });
});
