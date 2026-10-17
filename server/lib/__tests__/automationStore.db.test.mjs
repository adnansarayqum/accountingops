import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

/** The automatic-reminder ledger against real PostgreSQL, in its own schema. Skipped unless DATABASE_URL is set. */
const RAW_URL = process.env.DATABASE_URL;
const RUN = Boolean(RAW_URL);
const SCHEMA = `t_automation_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
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

const reminder = (over = {}) => ({ jobId: 'job_1', stepNo: 0, clientId: 'cl_1', recipient: 'a@example.com', subject: 'Subject', body: 'Body', stage: 'Email (30 days)', documentsRequested: ['Bank statements'], ...over });

describe.skipIf(!RUN)('automatic reminder ledger (PostgreSQL)', () => {
  let db;
  let store;
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await withAdmin((admin) => admin.query(`create schema ${SCHEMA}`));
    const url = new URL(RAW_URL);
    url.searchParams.set('options', `-c search_path=${SCHEMA}`);
    process.env.DATABASE_URL = url.toString();
    db = await import('../db.mjs');
    store = await import('../automationStore.mjs');
    await db.ensureSchema();
  });

  beforeEach(async () => {
    await db.query('delete from auto_reminders');
  });

  afterAll(async () => {
    await db?.getPool().end();
    process.env.DATABASE_URL = originalUrl;
    await withAdmin((admin) => admin.query(`drop schema ${SCHEMA} cascade`));
  });

  it('lets exactly one claim win for a step of a job', async () => {
    const claims = await Promise.all([store.claimReminder(reminder()), store.claimReminder(reminder()), store.claimReminder(reminder())]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await store.claimReminder(reminder())).toBeNull();
    expect(await store.claimReminder(reminder({ stepNo: 1 }))).toMatch(/^arm_/);
    expect(await store.claimReminder(reminder({ jobId: 'job_2' }))).toMatch(/^arm_/);
  });

  it('keeps a step taken once it is sent, and frees it when the provider refused', async () => {
    const sent = await store.claimReminder(reminder());
    await store.completeReminder(sent, { providerName: 'postmark', providerMessageId: 'm-1' });
    expect(await store.claimReminder(reminder())).toBeNull();

    const refused = await store.claimReminder(reminder({ jobId: 'job_2' }));
    await store.releaseReminder(refused);
    expect(await store.claimReminder(reminder({ jobId: 'job_2' }))).toMatch(/^arm_/);

    // A sent one cannot be released by mistake.
    await store.releaseReminder(sent);
    expect(await store.claimReminder(reminder())).toBeNull();
  });

  it('never frees a step whose outcome is unknown, and reports it once it has been stuck a while', async () => {
    const id = await store.claimReminder(reminder());
    await store.markReminderUnknown(id);
    await store.releaseReminder(id);
    expect(await store.claimReminder(reminder())).toBeNull();
    expect(await store.unknownReminders()).toEqual([]);
    await db.query("update auto_reminders set created_at = now() - interval '10 minutes'");
    expect(await store.unknownReminders()).toEqual([expect.objectContaining({ id, jobId: 'job_1', clientId: 'cl_1', recipient: 'a@example.com' })]);
  });

  it('counts, per job, everything not yet recorded in the practice data — in flight and unknown included', async () => {
    const a = await store.claimReminder(reminder());
    await store.completeReminder(a, { providerName: 'postmark', providerMessageId: 'm-1' });
    await store.claimReminder(reminder({ stepNo: 1 }));
    await store.claimReminder(reminder({ jobId: 'job_2' }));
    const pending = await store.pendingByJob();
    expect(pending.get('job_1').count).toBe(2);
    expect(pending.get('job_2').count).toBe(1);
    expect(Number.isNaN(Date.parse(pending.get('job_1').lastSentAt))).toBe(false);

    await store.markActivityApplied([a]);
    expect((await store.pendingByJob()).get('job_1').count).toBe(1);
  });

  it('hands over only what was sent, oldest first, until it is acknowledged', async () => {
    const first = await store.claimReminder(reminder());
    await store.completeReminder(first, { providerName: 'postmark', providerMessageId: 'm-1' });
    const second = await store.claimReminder(reminder({ jobId: 'job_2' }));
    await store.completeReminder(second, { providerName: 'postmark', providerMessageId: 'm-2' });
    await store.claimReminder(reminder({ jobId: 'job_3' })); // still sending

    const activity = await store.pendingActivity();
    expect(activity.map((a) => a.id)).toEqual([first, second]);
    expect(activity[0]).toMatchObject({ jobId: 'job_1', clientId: 'cl_1', recipient: 'a@example.com', stage: 'Email (30 days)', documentsRequested: ['Bank statements'], providerName: 'postmark', providerMessageId: 'm-1' });

    expect(await store.markActivityApplied([first, 'arm_nope', 7])).toBe(1);
    expect(await store.markActivityApplied([first])).toBe(0);
    expect((await store.pendingActivity()).map((a) => a.id)).toEqual([second]);
    expect(await store.markActivityApplied([])).toBe(0);
  });
});
