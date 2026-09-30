import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * The Telegram link store against real PostgreSQL, in its own schema so it
 * can run alongside the other database suites. Skipped unless DATABASE_URL
 * is set.
 */
const RAW_URL = process.env.DATABASE_URL;
const RUN = Boolean(RAW_URL);
const SCHEMA = `t_telegram_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

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

describe.skipIf(!RUN)('telegram link store (PostgreSQL)', () => {
  let db;
  let store;
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await withAdmin((admin) => admin.query(`create schema ${SCHEMA}`));
    const url = new URL(RAW_URL);
    url.searchParams.set('options', `-c search_path=${SCHEMA}`);
    process.env.DATABASE_URL = url.toString();
    db = await import('../db.mjs');
    store = await import('../telegramStore.mjs');
    await db.ensureSchema();
    for (const id of ['u_ray', 'u_farhan']) {
      await db.query("insert into practice_users (id, username, name, role, password_hash, password_salt) values ($1, $1, $1, 'owner', 'x', 'x')", [id]);
    }
  });

  beforeEach(async () => {
    await db.query('delete from telegram_links');
    await db.query('delete from telegram_link_codes');
  });

  afterAll(async () => {
    await db?.getPool().end();
    process.env.DATABASE_URL = originalUrl;
    await withAdmin((admin) => admin.query(`drop schema ${SCHEMA} cascade`));
  });

  it('stores only the hash of a code, and links the chat that sends it', async () => {
    const { code } = await store.createLinkCode('u_ray');
    const { rows } = await db.query('select code_hash from telegram_link_codes');
    expect(rows[0].code_hash).not.toContain(code);

    expect(await store.consumeLinkCode(code.toLowerCase(), 1001)).toBe('u_ray');
    expect(await store.findLinkByChatId(1001)).toMatchObject({ userId: 'u_ray' });
    expect(await store.findLinkByUserId('u_ray')).toMatchObject({ chatId: '1001' });
  });

  it('lets a code be used once, even by two messages racing for it', async () => {
    const { code } = await store.createLinkCode('u_ray');
    const results = await Promise.all([store.consumeLinkCode(code, 1), store.consumeLinkCode(code, 2)]);
    expect(results.filter(Boolean)).toEqual(['u_ray']);
    expect(await store.consumeLinkCode(code, 3)).toBeNull();
    expect((await db.query('select count(*)::int as n from telegram_links')).rows[0].n).toBe(1);
  });

  it('refuses an expired or unknown code', async () => {
    const { code } = await store.createLinkCode('u_ray');
    await db.query("update telegram_link_codes set expires_at = now() - interval '1 minute'");
    expect(await store.consumeLinkCode(code, 1)).toBeNull();
    expect(await store.consumeLinkCode('DEADBEEF00', 1)).toBeNull();
    expect(await store.findLinkByChatId(1)).toBeNull();
  });

  it('moves a user’s link to a new chat rather than keeping two', async () => {
    await store.consumeLinkCode((await store.createLinkCode('u_ray')).code, 1);
    await store.consumeLinkCode((await store.createLinkCode('u_ray')).code, 2);
    expect(await store.findLinkByChatId(1)).toBeNull();
    expect(await store.findLinkByUserId('u_ray')).toMatchObject({ chatId: '2' });
  });

  it('hands a chat over to whichever user links it last', async () => {
    await store.consumeLinkCode((await store.createLinkCode('u_ray')).code, 1);
    await store.consumeLinkCode((await store.createLinkCode('u_farhan')).code, 1);
    expect(await store.findLinkByChatId(1)).toMatchObject({ userId: 'u_farhan' });
    expect(await store.findLinkByUserId('u_ray')).toBeNull();
  });
});
