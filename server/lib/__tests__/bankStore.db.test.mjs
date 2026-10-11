import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

/** Bank statements and transactions against real PostgreSQL, in their own schema. Skipped unless DATABASE_URL is set. */
const RAW_URL = process.env.DATABASE_URL;
const RUN = Boolean(RAW_URL);
const SCHEMA = `t_bank_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
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

describe.skipIf(!RUN)('bank statements (PostgreSQL)', () => {
  let db;
  let bank;
  const originalUrl = process.env.DATABASE_URL;

  const read = (overrides = {}) => ({
    statement: { bankName: 'Barclays', accountName: 'ABC LTD', accountLast4: '5678', periodStart: '2026-01-01', periodEnd: '2026-01-31', openingBalance: 100, closingBalance: 1234.56, ...overrides },
    transactions: [
      { lineNo: 0, date: '2026-01-09', description: 'Staples', amount: -45.68, balance: 54.32, category: 'Office costs' },
      { lineNo: 1, date: '2026-01-05', description: 'ACME LTD', amount: 1250, balance: null, category: 'Sales / income' },
      { lineNo: 2, date: '2026-01-09', description: 'Second same-day line', amount: -10, balance: null, category: 'Other / unsure' },
    ],
    dropped: 2,
  });

  beforeAll(async () => {
    await withAdmin((admin) => admin.query(`create schema ${SCHEMA}`));
    const url = new URL(RAW_URL);
    url.searchParams.set('options', `-c search_path=${SCHEMA}`);
    process.env.DATABASE_URL = url.toString();
    db = await import('../db.mjs');
    bank = await import('../bankStore.mjs');
    await db.ensureSchema();
    await db.query("insert into practice_users (id, username, name, role, password_hash, password_salt) values ('u_ray', 'u_ray', 'u_ray', 'owner', 'x', 'x')");
    for (const id of ['inu_a', 'inu_b', 'inu_c']) {
      await db.query("insert into intake_uploads (id, batch_id, user_id, source, file_name, content_type, size_bytes, sha256, content) values ($1, 'inb_1', 'u_ray', 'share', 'x.jpg', 'image/jpeg', 1, $1, $2)", [id, Buffer.from('x')]);
    }
  });

  beforeEach(async () => {
    await db.query('delete from bank_statements');
  });

  afterAll(async () => {
    await db?.getPool().end();
    process.env.DATABASE_URL = originalUrl;
    await withAdmin((admin) => admin.query(`drop schema ${SCHEMA} cascade`));
  });

  it('knows whether every upload it is asked about exists', async () => {
    expect(await bank.uploadsExist(['inu_a', 'inu_b'])).toBe(true);
    expect(await bank.uploadsExist(['inu_a', 'inu_a'])).toBe(true);
    expect(await bank.uploadsExist(['inu_a', 'inu_nope'])).toBe(false);
    expect(await bank.uploadsExist([])).toBe(false);
  });

  it('claims a document once: a second claim sees it reading, and a finished one stays finished', async () => {
    const first = await bank.claimStatement(['inu_a', 'inu_b']);
    expect(first.claimed).toBe(true);
    expect(await bank.claimStatement(['inu_a', 'inu_b'])).toEqual({ id: first.id, claimed: false, status: 'reading' });
    // Racing claims: exactly one wins.
    await db.query('delete from bank_statements');
    const racing = await Promise.all([bank.claimStatement(['inu_c']), bank.claimStatement(['inu_c']), bank.claimStatement(['inu_c'])]);
    expect(racing.filter((r) => r.claimed)).toHaveLength(1);

    await bank.saveStatement(racing.find((r) => r.claimed).id, read(), 'claude-sonnet-5-5');
    expect(await bank.claimStatement(['inu_c'])).toMatchObject({ claimed: false, status: 'extracted' });
  });

  it('lets a failed or lost read be claimed again, keeping the same statement', async () => {
    const first = await bank.claimStatement(['inu_a']);
    await bank.failStatement(first.id, 'The statement could not be read.');
    const retry = await bank.claimStatement(['inu_a']);
    expect(retry).toEqual({ id: first.id, claimed: true });
    expect((await bank.queryStatements(['inu_a']))[0]).toMatchObject({ status: 'reading', error: null });

    await db.query("update bank_statements set updated_at = now() - interval '16 minutes'");
    expect((await bank.queryStatements(['inu_a']))[0]).toMatchObject({ status: 'failed', error: 'The read did not finish. Try again.' });
    expect(await bank.claimStatement(['inu_a'])).toEqual({ id: first.id, claimed: true });
  });

  it('stores a read statement and serves it back, lines in date order, dates as plain text', async () => {
    const { id } = await bank.claimStatement(['inu_a', 'inu_b']);
    await bank.saveStatement(id, read(), 'claude-sonnet-5-5');
    const [statement] = await bank.queryStatements(['inu_a']);
    expect(statement).toMatchObject({
      id,
      sourceUploadId: 'inu_a',
      uploadIds: ['inu_a', 'inu_b'],
      status: 'extracted',
      error: null,
      bankName: 'Barclays',
      accountLast4: '5678',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      openingBalance: 100,
      closingBalance: 1234.56,
      droppedLines: 2,
    });
    expect(statement.transactions.map((t) => [t.date, t.description, t.amount, t.balance, t.category, t.categorySource])).toEqual([
      ['2026-01-05', 'ACME LTD', 1250, null, 'Sales / income', 'ai'],
      ['2026-01-09', 'Staples', -45.68, 54.32, 'Office costs', 'ai'],
      ['2026-01-09', 'Second same-day line', -10, null, 'Other / unsure', 'ai'],
    ]);
  });

  it('replaces the lines when a statement is saved again, and removes them with the statement', async () => {
    const { id } = await bank.claimStatement(['inu_a']);
    await bank.saveStatement(id, read(), 'm');
    await bank.saveStatement(id, { ...read(), transactions: [read().transactions[0]] }, 'm');
    expect((await bank.queryStatements(['inu_a']))[0].transactions).toHaveLength(1);
    await db.query('delete from bank_statements');
    expect((await db.query('select count(*)::int as n from bank_transactions')).rows[0].n).toBe(0);
  });

  it('saves a statement with many lines in more than one batch', async () => {
    const { id } = await bank.claimStatement(['inu_a']);
    const lines = Array.from({ length: 1203 }, (_, i) => ({ lineNo: i, date: '2026-01-15', description: `Line ${i}`, amount: -1, balance: null, category: 'Other / unsure' }));
    await bank.saveStatement(id, { ...read(), transactions: lines }, 'm');
    const [statement] = await bank.queryStatements(['inu_a']);
    expect(statement.transactions).toHaveLength(1203);
    expect(statement.transactions[1202].description).toBe('Line 1202');
  });

  it('returns a statement still being read, or failed, without lines, and ignores uploads it has no statement for', async () => {
    const a = await bank.claimStatement(['inu_a']);
    const b = await bank.claimStatement(['inu_b']);
    await bank.failStatement(b.id, 'Too long.');
    const result = await bank.queryStatements(['inu_a', 'inu_b', 'inu_c', 'inu_a']);
    expect(result.map((s) => [s.id, s.status, s.error, s.transactions.length])).toEqual([[a.id, 'reading', null, 0], [b.id, 'failed', 'Too long.', 0]]);
    expect(await bank.queryStatements([])).toEqual([]);
  });

  it('records a person’s correction, and marks it as theirs', async () => {
    const { id } = await bank.claimStatement(['inu_a']);
    await bank.saveStatement(id, read(), 'm');
    const [{ transactions }] = await bank.queryStatements(['inu_a']);
    expect(await bank.setCategory(transactions[1].id, 'Travel & motor')).toEqual({ id: transactions[1].id, category: 'Travel & motor', categorySource: 'user' });
    expect((await bank.queryStatements(['inu_a']))[0].transactions[1]).toMatchObject({ category: 'Travel & motor', categorySource: 'user' });
    expect(await bank.setCategory('btx_missing', 'VAT')).toBeNull();
  });
});
