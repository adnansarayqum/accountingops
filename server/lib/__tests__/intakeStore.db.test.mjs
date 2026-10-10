import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * The shared-intake store against real PostgreSQL, in its own schema.
 * Skipped unless DATABASE_URL is set.
 */
const RAW_URL = process.env.DATABASE_URL;
const RUN = Boolean(RAW_URL);
const SCHEMA = `t_intake_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
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

describe.skipIf(!RUN)('shared intake store (PostgreSQL)', () => {
  let db;
  let store;
  const originalUrl = process.env.DATABASE_URL;

  const part = (text, contentType = 'text/plain') => ({ fileName: `${text}.txt`, contentType, bytes: Buffer.from(text) });
  const suggestion = (overrides = {}) => ({ clientId: 'cl_acme', documentType: 'Bank statement', extractedDate: '2026-01-31', summary: 'Statement', confidence: 0.9, rationale: 'Name matches.', ...overrides });

  beforeAll(async () => {
    await withAdmin((admin) => admin.query(`create schema ${SCHEMA}`));
    const url = new URL(RAW_URL);
    url.searchParams.set('options', `-c search_path=${SCHEMA}`);
    process.env.DATABASE_URL = url.toString();
    db = await import('../db.mjs');
    store = await import('../intakeStore.mjs');
    await db.ensureSchema();
    for (const id of ['u_ray', 'u_farhan']) {
      await db.query("insert into practice_users (id, username, name, role, password_hash, password_salt) values ($1, $1, $1, 'owner', 'x', 'x')", [id]);
    }
  });

  beforeEach(async () => {
    await db.query('delete from intake_activity');
    await db.query('delete from intake_uploads');
  });

  afterAll(async () => {
    await db?.getPool().end();
    process.env.DATABASE_URL = originalUrl;
    await withAdmin((admin) => admin.query(`drop schema ${SCHEMA} cascade`));
  });

  it('stores every part of a share and serves each back byte for byte', async () => {
    const ids = await store.saveBatch({ batchId: 'inb_1', userId: 'u_ray', source: 'share', parts: [part('one'), part('two')] });
    expect(ids).toHaveLength(2);
    expect(await store.readUpload(ids[1])).toMatchObject({ fileName: 'two.txt', contentType: 'text/plain' });
    expect((await store.readUpload(ids[1])).content.toString()).toBe('two');
    expect(await store.readUpload('inu_missing')).toBeNull();
  });

  it('recognises the same files shared again by the same person — only when every one matches', async () => {
    await store.saveBatch({ batchId: 'inb_1', userId: 'u_ray', source: 'share', parts: [part('a'), part('b')] });
    const hashes = (texts) => texts.map((t) => store.sha256(Buffer.from(t)));
    expect(await store.findDuplicateBatch('u_ray', hashes(['a', 'b']))).toBe('inb_1');
    expect(await store.findDuplicateBatch('u_ray', hashes(['b']))).toBe('inb_1');
    expect(await store.findDuplicateBatch('u_ray', hashes(['a', 'c']))).toBeNull();
    expect(await store.findDuplicateBatch('u_farhan', hashes(['a', 'b']))).toBeNull();
  });

  it('holds a shared document back until it is released or the hold runs out', async () => {
    const [up] = await store.saveBatch({ batchId: 'inb_1', userId: 'u_ray', source: 'share', parts: [part('x')] });
    const id = await store.queueDocument({ batchId: 'inb_1', source: 'share', userId: 'u_ray', uploadIds: [up], fileName: 'x.txt', sizeBytes: 2048, suggestion: suggestion(), filed: true, holdMinutes: 10 });
    expect(await store.pendingActivity()).toEqual([]);

    expect(await store.releaseBatch('inb_1', 'u_farhan')).toBe(0);
    expect(await store.releaseBatch('inb_1', 'u_ray')).toBe(1);
    const [row] = await store.pendingActivity();
    expect(row).toMatchObject({ id, batchId: 'inb_1', source: 'share', uploadIds: [up], clientId: 'cl_acme', filed: true, documentType: 'Bank statement', extractedDate: '2026-01-31', summary: 'Statement', sizeKb: 2 });

    await db.query("update intake_activity set hold_until = now() + interval '10 minutes'");
    expect(await store.pendingActivity()).toEqual([]);
    await db.query("update intake_activity set hold_until = now() - interval '1 second'");
    expect((await store.pendingActivity()).map((r) => r.id)).toEqual([id]);
  });

  it('never marks a document filed without a client', async () => {
    await store.queueDocument({ batchId: 'inb_1', source: 'share', userId: 'u_ray', uploadIds: [], fileName: 'x', sizeBytes: 1, suggestion: suggestion({ clientId: null }), filed: true });
    expect((await store.pendingActivity())[0]).toMatchObject({ clientId: null, filed: false });
  });

  it('lets only the sharer change the client, and only before the practice has it', async () => {
    const id = await store.queueDocument({ batchId: 'inb_1', source: 'share', userId: 'u_ray', uploadIds: [], fileName: 'x', sizeBytes: 1, suggestion: suggestion({ clientId: 'cl_khan', confidence: 0.4 }), filed: false });
    expect(await store.assignDocument(id, 'u_farhan', 'cl_acme')).toBe(false);
    expect(await store.assignDocument(id, 'u_ray', 'cl_acme')).toBe(true);
    expect((await store.pendingActivity())[0]).toMatchObject({ clientId: 'cl_acme', filed: true, confidence: 1, rationale: 'Picked when shared.' });

    expect(await store.assignDocument(id, 'u_ray', null)).toBe(true);
    expect((await store.pendingActivity())[0]).toMatchObject({ clientId: null, filed: false, confidence: 0 });

    expect(await store.markActivityApplied([id, 'ina_unknown'])).toBe(1);
    expect(await store.markActivityApplied([id])).toBe(0);
    expect(await store.assignDocument(id, 'u_ray', 'cl_acme')).toBe(false);
    expect(await store.pendingActivity()).toEqual([]);
  });
});
