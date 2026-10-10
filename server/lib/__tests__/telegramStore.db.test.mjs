import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

/** The retired Telegram bot's stored photos stay readable. Skipped unless DATABASE_URL is set. */
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

describe.skipIf(!RUN)('retired Telegram store (PostgreSQL)', () => {
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
  });

  afterAll(async () => {
    await db?.getPool().end();
    process.env.DATABASE_URL = originalUrl;
    await withAdmin((admin) => admin.query(`drop schema ${SCHEMA} cascade`));
  });

  it('reads back a photo the bot stored, byte for byte', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    await db.query("insert into telegram_uploads (id, chat_id, telegram_file_id, file_name, content_type, size_bytes, content) values ('tgu_1', '77', 'f1', 'telegram-1.jpg', 'image/jpeg', 4, $1)", [bytes]);
    const file = await store.readUpload('tgu_1');
    expect(file).toMatchObject({ fileName: 'telegram-1.jpg', contentType: 'image/jpeg' });
    expect(Buffer.compare(file.content, bytes)).toBe(0);
    expect(await store.readUpload('tgu_missing')).toBeNull();
  });
});
