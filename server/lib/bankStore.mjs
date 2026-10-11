/**
 * Bank statements and their transactions (see lib/bankStatement.mjs). A
 * statement is keyed by the first upload id of the document it was read
 * from, so one document is read once however many times it is asked for.
 */
import { randomUUID } from 'node:crypto';
import { ensureSchema, getPool, query } from './db.mjs';

/** A read that has not finished in this long is treated as lost (the server restarted mid-read). */
export const STALE_READ_MINUTES = 15;
export const MAX_QUERY_UPLOADS = 100;

const STATUS_SQL = `case when status = 'reading' and updated_at < now() - make_interval(mins => ${STALE_READ_MINUTES}) then 'failed' else status end`;
const ERROR_SQL = `case when status = 'reading' and updated_at < now() - make_interval(mins => ${STALE_READ_MINUTES}) then 'The read did not finish. Try again.' else error end`;

/** Whether every one of these upload ids exists — so a statement can't be claimed for nothing. */
export async function uploadsExist(uploadIds) {
  await ensureSchema();
  if (uploadIds.length === 0) return false;
  const { rows } = await query('select count(*)::int as n from intake_uploads where id = any($1)', [uploadIds]);
  return rows[0].n === new Set(uploadIds).size;
}

/**
 * Starts a read for a document, once. Returns { id, claimed: true } when this
 * call took it (new, or retrying a failed or lost read), or
 * { id, claimed: false, status } when one is already reading or done.
 */
export async function claimStatement(uploadIds) {
  await ensureSchema();
  const id = `bst_${randomUUID()}`;
  const { rows } = await query(
    `insert into bank_statements (id, source_upload_id, upload_ids, status)
     values ($1, $2, $3, 'reading')
     on conflict (source_upload_id) do update
        set status = 'reading', error = null, updated_at = now(), upload_ids = excluded.upload_ids
      where bank_statements.status = 'failed'
         or (bank_statements.status = 'reading' and bank_statements.updated_at < now() - make_interval(mins => ${STALE_READ_MINUTES}))
     returning id`,
    [id, uploadIds[0], JSON.stringify(uploadIds)],
  );
  if (rows[0]) return { id: rows[0].id, claimed: true };
  const existing = await query('select id, status from bank_statements where source_upload_id = $1', [uploadIds[0]]);
  return { id: existing.rows[0].id, claimed: false, status: existing.rows[0].status };
}

/** Stores a read statement with every one of its lines, replacing any earlier lines, in one transaction. */
export async function saveStatement(id, { statement, transactions, dropped }, model) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query(
      `update bank_statements
          set status = 'extracted', error = null, bank_name = $2, account_name = $3, account_last4 = $4, period_start = $5, period_end = $6,
              opening_balance = $7, closing_balance = $8, dropped_lines = $9, model = $10, updated_at = now()
        where id = $1`,
      [id, statement.bankName, statement.accountName, statement.accountLast4, statement.periodStart, statement.periodEnd, statement.openingBalance, statement.closingBalance, dropped, model],
    );
    await client.query('delete from bank_transactions where statement_id = $1', [id]);
    // One insert per few hundred lines rather than per line.
    for (let i = 0; i < transactions.length; i += 500) {
      const chunk = transactions.slice(i, i + 500);
      await client.query(
        `insert into bank_transactions (id, statement_id, line_no, tx_date, description, amount, balance, category)
         select * from unnest($1::text[], $2::text[], $3::int[], $4::date[], $5::text[], $6::numeric[], $7::numeric[], $8::text[])`,
        [
          chunk.map(() => `btx_${randomUUID()}`),
          chunk.map(() => id),
          chunk.map((t) => t.lineNo),
          chunk.map((t) => t.date),
          chunk.map((t) => t.description),
          chunk.map((t) => t.amount),
          chunk.map((t) => t.balance),
          chunk.map((t) => t.category),
        ],
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function failStatement(id, message) {
  await ensureSchema();
  await query("update bank_statements set status = 'failed', error = $2, updated_at = now() where id = $1", [id, String(message).slice(0, 300)]);
}

const num = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * The statements read from these documents (by first upload id), each with
 * its transactions in date order. Dates come back as text: a pg `date`
 * becomes local midnight, which can shift a day when serialised.
 */
export async function queryStatements(sourceUploadIds) {
  await ensureSchema();
  const ids = [...new Set(sourceUploadIds)].slice(0, MAX_QUERY_UPLOADS);
  if (ids.length === 0) return [];
  const { rows } = await query(
    `select id, source_upload_id, upload_ids, ${STATUS_SQL} as status, ${ERROR_SQL} as error, bank_name, account_name, account_last4,
            period_start::text as period_start, period_end::text as period_end, opening_balance, closing_balance, dropped_lines
       from bank_statements where source_upload_id = any($1) order by period_start nulls last, created_at`,
    [ids],
  );
  const read = rows.filter((r) => r.status === 'extracted').map((r) => r.id);
  const lines = read.length === 0 ? [] : (await query('select id, statement_id, line_no, tx_date::text as tx_date, description, amount, balance, category, category_source from bank_transactions where statement_id = any($1) order by tx_date, statement_id, line_no', [read])).rows;
  return rows.map((r) => ({
    id: r.id,
    sourceUploadId: r.source_upload_id,
    uploadIds: r.upload_ids,
    status: r.status,
    error: r.error ?? null,
    bankName: r.bank_name ?? null,
    accountName: r.account_name ?? null,
    accountLast4: r.account_last4 ?? null,
    periodStart: r.period_start ?? null,
    periodEnd: r.period_end ?? null,
    openingBalance: num(r.opening_balance),
    closingBalance: num(r.closing_balance),
    droppedLines: r.dropped_lines,
    transactions: lines
      .filter((t) => t.statement_id === r.id)
      .map((t) => ({ id: t.id, lineNo: t.line_no, date: t.tx_date, description: t.description, amount: Number(t.amount), balance: num(t.balance), category: t.category, categorySource: t.category_source })),
  }));
}

/** A person's correction of one line's category. Returns the updated line, or null when there is no such line. */
export async function setCategory(transactionId, category) {
  await ensureSchema();
  const { rows } = await query(
    "update bank_transactions set category = $2, category_source = 'user', updated_at = now() where id = $1 returning id, category, category_source",
    [transactionId, category],
  );
  return rows[0] ? { id: rows[0].id, category: rows[0].category, categorySource: rows[0].category_source } : null;
}
