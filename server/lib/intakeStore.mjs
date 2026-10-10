/**
 * Shared intake persistence: the files and text shared into the app, and
 * the documents they turned out to be, queued for the practice's open tab
 * to pull into Smart Inbox. Never the practice snapshot — see db.mjs.
 */
import { createHash, randomUUID } from 'node:crypto';
import { ensureSchema, getPool, query } from './db.mjs';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * A share whose every part this user already shared recently — sharing the
 * same statement twice should not read (and pay for) it twice. Returns the
 * earlier batch id, or null.
 */
export async function findDuplicateBatch(userId, hashes, days = 7) {
  await ensureSchema();
  if (!userId || hashes.length === 0) return null;
  const { rows } = await query(
    `select batch_id, array_agg(distinct sha256) as hashes from intake_uploads
      where user_id = $1 and sha256 = any($2) and created_at > now() - make_interval(days => $3)
      group by batch_id`,
    [userId, hashes, days],
  );
  const wanted = new Set(hashes);
  const match = rows.find((r) => [...wanted].every((h) => r.hashes.includes(h)));
  return match?.batch_id ?? null;
}

/** Stores every part of one share in a single transaction; returns the upload ids in part order. */
export async function saveBatch({ batchId, userId, source, parts }) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const ids = [];
    for (const part of parts) {
      const id = `inu_${randomUUID()}`;
      await client.query(
        `insert into intake_uploads (id, batch_id, user_id, source, file_name, content_type, size_bytes, sha256, content)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, batchId, userId ?? null, source, part.fileName, part.contentType, part.bytes.length, sha256(part.bytes), part.bytes],
      );
      ids.push(id);
    }
    await client.query('commit');
    return ids;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Queues one document for Smart Inbox. `holdMinutes` keeps it back while the share screen is open. */
export async function queueDocument({ batchId, source, userId, uploadIds, fileName, sizeBytes, suggestion, filed, facts = null, holdMinutes = 0 }) {
  await ensureSchema();
  const id = `ina_${randomUUID()}`;
  await query(
    `insert into intake_activity (id, batch_id, source, user_id, upload_ids, client_id, document_type, period, extracted_reference, extracted_date, summary, confidence, rationale, file_name, size_kb, hold_until, filed, facts)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, case when $16::int > 0 then now() + make_interval(mins => $16::int) end, $17, $18)`,
    [
      id,
      batchId,
      source,
      userId ?? null,
      JSON.stringify(uploadIds),
      suggestion.clientId ?? null,
      suggestion.documentType,
      suggestion.period ?? null,
      suggestion.extractedReference ?? null,
      suggestion.extractedDate ?? null,
      suggestion.summary || null,
      suggestion.confidence,
      suggestion.rationale,
      fileName,
      Math.max(1, Math.round(sizeBytes / 1024)),
      holdMinutes,
      Boolean(filed && suggestion.clientId),
      facts ? JSON.stringify(facts) : null,
    ],
  );
  return id;
}

/**
 * The share screen's correction: a different client (or none) for one
 * document, only while it hasn't been pulled into the practice's data, and
 * only by whoever shared it. Returns whether anything changed.
 */
export async function assignDocument(id, userId, clientId) {
  await ensureSchema();
  const { rowCount } = await query(
    `update intake_activity set client_id = $3, filed = $3::text is not null, confidence = case when $3::text is null then 0 else 1 end,
            rationale = case when $3::text is null then 'Left to sort in Smart Inbox.' else 'Picked when shared.' end
      where id = $1 and user_id = $2 and applied_at is null`,
    [id, userId, clientId ?? null],
  );
  return rowCount > 0;
}

/** "Done" on the share screen: let the practice's tabs pick the batch up now. */
export async function releaseBatch(batchId, userId) {
  await ensureSchema();
  const { rowCount } = await query('update intake_activity set hold_until = null where batch_id = $1 and user_id = $2 and applied_at is null', [batchId, userId]);
  return rowCount;
}

/** Documents ready to pull into Smart Inbox, oldest first: not applied, and not held (or the hold has run out). */
export async function pendingActivity(limit = 100) {
  await ensureSchema();
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  const { rows } = await query(
    // extracted_date as text: a pg `date` comes back as local midnight,
    // which toISOString() can shift a day east of UTC.
    `select id, batch_id, source, upload_ids, client_id, filed, document_type, period, extracted_reference, extracted_date::text as extracted_date,
            summary, confidence, rationale, file_name, size_kb, facts, created_at
       from intake_activity
      where applied_at is null and (hold_until is null or hold_until <= now())
      order by created_at asc limit $1`,
    [n],
  );
  return rows.map((r) => ({
    id: r.id,
    batchId: r.batch_id,
    source: r.source,
    uploadIds: r.upload_ids,
    clientId: r.client_id ?? null,
    filed: r.filed,
    documentType: r.document_type,
    period: r.period ?? null,
    extractedReference: r.extracted_reference ?? null,
    extractedDate: r.extracted_date ?? null,
    summary: r.summary ?? null,
    confidence: Number(r.confidence),
    rationale: r.rationale,
    fileName: r.file_name,
    sizeKb: r.size_kb,
    facts: r.facts ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function markActivityApplied(ids) {
  await ensureSchema();
  const list = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
  if (list.length === 0) return 0;
  const { rowCount } = await query('update intake_activity set applied_at = now() where applied_at is null and id = any($1)', [list]);
  return rowCount;
}

export async function readUpload(id) {
  await ensureSchema();
  const { rows } = await query('select file_name, content_type, content from intake_uploads where id = $1', [id]);
  const row = rows[0];
  return row ? { fileName: row.file_name, contentType: row.content_type, content: row.content } : null;
}
