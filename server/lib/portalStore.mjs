/**
 * Client portal persistence. See portal.mjs for the rules; this is only
 * where the rows live. Three tables, none of them the practice snapshot:
 *
 *  - portal_links: one row per link, token stored as a hash;
 *  - portal_uploads: file bytes, both directions (a client's records in, an
 *    accountant's accounts out for approval);
 *  - portal_activity: what a client did, for the app to pull into the
 *    practice's own data through its normal store actions.
 *
 * The public route reads the practice snapshot to build the client's view,
 * but never writes it. The app applies activity itself, so every domain
 * rule (completeness, auto-transitions, approvals moving a job on) runs
 * exactly once, in the one place it is defined.
 */
import { randomUUID } from 'node:crypto';
import { ensureSchema, query } from './db.mjs';
import { expiryFor, generateToken, hashToken } from './portal.mjs';

const PRACTICE_ID = 'prac_main';

function rowToLink(row) {
  if (!row) return null;
  return {
    id: row.id,
    practiceId: row.practice_id,
    clientId: row.client_id,
    jobId: row.job_id,
    purpose: row.purpose,
    message: row.message ?? null,
    attachmentId: row.attachment_id ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at ?? null,
    revokedAt: row.revoked_at ?? null,
    lastOpenedAt: row.last_opened_at ?? null,
  };
}

/** Creates a link and returns the token exactly once — it is not stored and cannot be shown again. */
export async function createLink({ clientId, jobId, purpose, message, expiresInDays, createdBy, attachment }) {
  await ensureSchema();
  const id = `pl_${randomUUID()}`;
  const token = generateToken();
  let attachmentId = null;
  if (attachment) {
    attachmentId = `up_${randomUUID()}`;
    await query(
      `insert into portal_uploads (id, link_id, practice_id, client_id, job_id, direction, file_name, content_type, size_bytes, content)
       values ($1, null, $2, $3, $4, 'to_client', $5, $6, $7, $8)`,
      [attachmentId, PRACTICE_ID, clientId, jobId, attachment.fileName, attachment.contentType, attachment.content.length, attachment.content],
    );
  }
  await query(
    `insert into portal_links (id, token_hash, practice_id, client_id, job_id, purpose, message, attachment_id, created_by, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, hashToken(token), PRACTICE_ID, clientId, jobId, purpose, message ?? null, attachmentId, createdBy ?? null, expiryFor(expiresInDays)],
  );
  if (attachmentId) await query('update portal_uploads set link_id = $2 where id = $1', [attachmentId, id]);
  return { id, token };
}

export async function findLinkByToken(token) {
  await ensureSchema();
  const { rows } = await query('select * from portal_links where token_hash = $1', [hashToken(token)]);
  return rowToLink(rows[0]);
}

export async function findLinkById(id) {
  await ensureSchema();
  const { rows } = await query('select * from portal_links where id = $1', [id]);
  return rowToLink(rows[0]);
}

/** The practice's own view of a job's links — never the tokens, which no longer exist anywhere. */
export async function linksForJob(jobId) {
  await ensureSchema();
  const { rows } = await query('select * from portal_links where job_id = $1 order by created_at desc', [jobId]);
  return rows.map(rowToLink);
}

export async function markOpened(linkId) {
  await query('update portal_links set last_opened_at = now() where id = $1', [linkId]);
}

export async function markUsed(linkId) {
  const { rowCount } = await query('update portal_links set used_at = now() where id = $1 and used_at is null', [linkId]);
  return rowCount > 0;
}

export async function revokeLink(linkId) {
  await ensureSchema();
  const { rowCount } = await query('update portal_links set revoked_at = now() where id = $1 and revoked_at is null', [linkId]);
  return rowCount > 0;
}

export async function uploadCountForLink(linkId) {
  const { rows } = await query("select count(*)::int as n from portal_uploads where link_id = $1 and direction = 'from_client'", [linkId]);
  return rows[0]?.n ?? 0;
}

/** Stores a client's file and queues the fact for the app. Returns the activity row id. */
export async function storeClientUpload({ link, requestItemId, fileName, contentType, content }) {
  const uploadId = `up_${randomUUID()}`;
  const activityId = `pa_${randomUUID()}`;
  await query(
    `insert into portal_uploads (id, link_id, practice_id, client_id, job_id, direction, request_item_id, file_name, content_type, size_bytes, content)
     values ($1, $2, $3, $4, $5, 'from_client', $6, $7, $8, $9, $10)`,
    [uploadId, link.id, link.practiceId, link.clientId, link.jobId, requestItemId ?? null, fileName, contentType, content.length, content],
  );
  await query(
    `insert into portal_activity (id, link_id, practice_id, client_id, job_id, kind, request_item_id, upload_id, file_name, size_kb)
     values ($1, $2, $3, $4, $5, 'upload', $6, $7, $8, $9)`,
    [activityId, link.id, link.practiceId, link.clientId, link.jobId, requestItemId ?? null, uploadId, fileName, Math.max(1, Math.round(content.length / 1024))],
  );
  return { uploadId, activityId };
}

export async function recordApprovalDecision({ link, decision, actorName, note }) {
  const activityId = `pa_${randomUUID()}`;
  await query(
    `insert into portal_activity (id, link_id, practice_id, client_id, job_id, kind, decision, actor_name, note)
     values ($1, $2, $3, $4, $5, 'approval', $6, $7, $8)`,
    [activityId, link.id, link.practiceId, link.clientId, link.jobId, decision, actorName, note ?? null],
  );
  return activityId;
}

/** Bytes for a stored file. The caller decides who may have them. */
export async function readUpload(uploadId) {
  await ensureSchema();
  const { rows } = await query('select id, link_id, client_id, job_id, direction, file_name, content_type, size_bytes, content from portal_uploads where id = $1', [uploadId]);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, linkId: row.link_id, clientId: row.client_id, jobId: row.job_id, direction: row.direction, fileName: row.file_name, contentType: row.content_type, sizeBytes: row.size_bytes, content: row.content };
}

/** What clients have done that the app has not yet pulled in, oldest first so it applies in order. */
export async function pendingActivity(limit = 100) {
  await ensureSchema();
  const { rows } = await query(
    `select id, link_id, client_id, job_id, kind, request_item_id, upload_id, file_name, size_kb, decision, actor_name, note, created_at
     from portal_activity where applied_at is null order by created_at asc limit $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500)],
  );
  return rows.map((r) => ({
    id: r.id,
    linkId: r.link_id,
    clientId: r.client_id,
    jobId: r.job_id,
    kind: r.kind,
    requestItemId: r.request_item_id ?? null,
    uploadId: r.upload_id ?? null,
    fileName: r.file_name ?? null,
    sizeKb: r.size_kb ?? null,
    decision: r.decision ?? null,
    actorName: r.actor_name ?? null,
    note: r.note ?? null,
    createdAt: r.created_at,
  }));
}

export async function markActivityApplied(ids) {
  await ensureSchema();
  const list = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
  if (list.length === 0) return 0;
  const { rowCount } = await query('update portal_activity set applied_at = now() where applied_at is null and id = any($1)', [list]);
  return rowCount;
}

/** The stored practice snapshot, for building the client's view. Read-only here. */
export async function readSnapshot() {
  await ensureSchema();
  const { rows } = await query('select data from practice_snapshots where practice_id = $1', [PRACTICE_ID]);
  return rows[0]?.data ?? null;
}
