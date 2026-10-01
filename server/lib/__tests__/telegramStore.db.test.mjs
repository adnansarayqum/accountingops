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
    await db.query('delete from telegram_uploads');
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

  it('stores a photo, finds it again by file id for this chat only, and queues what it was matched to', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
    const uploadId = await store.saveUpload({ chatId: 77, fileId: 'file_a', fileName: 'telegram-1.jpg', contentType: 'image/jpeg', bytes });
    expect(await store.findUploadByFileId(77, 'file_a')).toBe(uploadId);
    expect(await store.findUploadByFileId(78, 'file_a')).toBeNull();
    const { rows } = await db.query('select content, size_bytes from telegram_uploads where id = $1', [uploadId]);
    expect(Buffer.compare(rows[0].content, bytes)).toBe(0);
    expect(rows[0].size_bytes).toBe(5);

    await store.queueActivity({
      uploadId,
      fileName: 'telegram-1.jpg',
      sizeBytes: 300_000,
      suggestion: { clientId: 'cl_acme', documentType: 'VAT notice', extractedReference: 'R1', extractedDate: '2026-09-20', confidence: 0.95, rationale: 'VAT number matches.' },
    });
    const activity = (await db.query('select * from telegram_activity')).rows[0];
    expect(activity).toMatchObject({ upload_id: uploadId, client_id: 'cl_acme', document_type: 'VAT notice', extracted_reference: 'R1', period: null, rationale: 'VAT number matches.', size_kb: 293, applied_at: null });
    expect(activity.confidence).toBeCloseTo(0.95);

    await store.savePendingMatch({ chatId: 77, messageId: 901, uploadId, candidates: ['cl_acme'], extracted: { documentType: 'Other' } });
    const pending = (await db.query('select * from telegram_pending_matches')).rows[0];
    expect(pending).toMatchObject({ chat_id: '77', message_id: '901', candidates: ['cl_acme'], extracted: { documentType: 'Other' }, resolved_at: null });
  });

  it('resolves a pending match once — even two taps racing — and only from its own chat', async () => {
    const uploadId = await store.saveUpload({ chatId: 77, fileId: 'file_b', fileName: 'telegram-2.jpg', contentType: 'image/jpeg', bytes: Buffer.alloc(4096) });
    const id = await store.savePendingMatch({ chatId: 77, messageId: null, uploadId, candidates: ['cl_acme', 'cl_khan'], extracted: { suggestion: { documentType: 'VAT notice' } } });
    await store.setPendingMessageId(id, 905);

    expect(await store.resolvePendingMatch(id, 78)).toBeNull();
    const results = await Promise.all([store.resolvePendingMatch(id, 77), store.resolvePendingMatch(id, 77)]);
    const won = results.filter(Boolean);
    expect(won).toHaveLength(1);
    expect(won[0]).toEqual({ id, messageId: '905', uploadId, candidates: ['cl_acme', 'cl_khan'], extracted: { suggestion: { documentType: 'VAT notice' } }, fileName: 'telegram-2.jpg', sizeBytes: 4096 });
    expect(await store.resolvePendingMatch(id, 77)).toBeNull();
  });

  it('queues a letter with no client for Smart Inbox to sort', async () => {
    const uploadId = await store.saveUpload({ chatId: 77, fileId: 'file_c', fileName: 'telegram-3.jpg', contentType: 'image/jpeg', bytes: Buffer.alloc(10) });
    await store.queueActivity({ uploadId, fileName: 'telegram-3.jpg', sizeBytes: 10, suggestion: { clientId: null, documentType: 'Other', confidence: 0, rationale: 'Left to sort in Smart Inbox.' } });
    expect((await db.query('select client_id from telegram_activity where upload_id = $1', [uploadId])).rows[0].client_id).toBeNull();
  });

  it('hands a chat over to whichever user links it last', async () => {
    await store.consumeLinkCode((await store.createLinkCode('u_ray')).code, 1);
    await store.consumeLinkCode((await store.createLinkCode('u_farhan')).code, 1);
    expect(await store.findLinkByChatId(1)).toMatchObject({ userId: 'u_farhan' });
    expect(await store.findLinkByUserId('u_ray')).toBeNull();
  });
});
