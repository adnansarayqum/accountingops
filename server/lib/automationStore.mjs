/**
 * The ledger of reminders the server sent on its own (see the auto_reminders
 * table in db.mjs). The unique key (job, step) is what makes "never send a
 * step twice" a database guarantee rather than a hope.
 */
import { randomUUID } from 'node:crypto';
import { ensureSchema, query } from './db.mjs';

/**
 * Takes the right to send step `stepNo` of a job. Returns the ledger id, or
 * null when that step has already been taken (sent, in flight, or of unknown
 * outcome) — in which case nothing may be sent.
 */
export async function claimReminder({ jobId, stepNo, clientId, recipient, subject, body, stage, documentsRequested }) {
  await ensureSchema();
  const id = `arm_${randomUUID()}`;
  const { rows } = await query(
    `insert into auto_reminders (id, job_id, step_no, client_id, status, recipient, subject, body, stage, documents_requested)
     values ($1, $2, $3, $4, 'sending', $5, $6, $7, $8, $9)
     on conflict (job_id, step_no) do nothing
     returning id`,
    [id, jobId, stepNo, clientId, recipient, subject, body, stage, JSON.stringify(documentsRequested ?? [])],
  );
  return rows[0]?.id ?? null;
}

export async function completeReminder(id, { providerName, providerMessageId }) {
  await ensureSchema();
  await query("update auto_reminders set status = 'sent', sent_at = now(), provider_name = $2, provider_message_id = $3 where id = $1", [id, providerName, providerMessageId ?? null]);
}

/** The provider definitively refused it: nothing went, so the step is free to be tried again. */
export async function releaseReminder(id) {
  await ensureSchema();
  await query("delete from auto_reminders where id = $1 and status = 'sending'", [id]);
}

/** Whether it went is unknowable (connection lost mid-send). Never retried; a person is told. */
export async function markReminderUnknown(id) {
  await ensureSchema();
  await query("update auto_reminders set status = 'unknown' where id = $1 and status = 'sending'", [id]);
}

/**
 * Per job: how many automatic reminders have not yet been recorded in the
 * practice's data, and when the latest went. In-flight and unknown ones
 * count too — they may have gone, so the step must not be taken again.
 */
export async function pendingByJob() {
  await ensureSchema();
  const { rows } = await query('select job_id, count(*)::int as n, max(coalesce(sent_at, created_at)) as last from auto_reminders where applied_at is null group by job_id');
  return new Map(rows.map((r) => [r.job_id, { count: r.n, lastSentAt: new Date(r.last).toISOString() }]));
}

/** Sends of unknown outcome, for a person to check in the provider's activity log. */
export async function unknownReminders() {
  await ensureSchema();
  const { rows } = await query("select id, job_id, client_id, stage, recipient, created_at from auto_reminders where status in ('unknown', 'sending') and created_at < now() - interval '5 minutes' order by created_at");
  return rows.map((r) => ({ id: r.id, jobId: r.job_id, clientId: r.client_id, stage: r.stage, recipient: r.recipient, at: new Date(r.created_at).toISOString() }));
}

/** Sent reminders waiting to be recorded in the practice's data, oldest first. */
export async function pendingActivity(limit = 100) {
  await ensureSchema();
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  const { rows } = await query(
    `select id, job_id, client_id, recipient, subject, body, stage, documents_requested, provider_name, provider_message_id, sent_at
       from auto_reminders where applied_at is null and status = 'sent' order by sent_at asc limit $1`,
    [n],
  );
  return rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    clientId: r.client_id,
    recipient: r.recipient,
    subject: r.subject,
    body: r.body,
    stage: r.stage,
    documentsRequested: r.documents_requested ?? [],
    providerName: r.provider_name,
    providerMessageId: r.provider_message_id,
    sentAt: new Date(r.sent_at).toISOString(),
  }));
}

export async function markActivityApplied(ids) {
  await ensureSchema();
  const list = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
  if (list.length === 0) return 0;
  const { rowCount } = await query('update auto_reminders set applied_at = now() where applied_at is null and status = \'sent\' and id = any($1)', [list]);
  return rowCount;
}
