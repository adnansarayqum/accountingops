/**
 * Where the Companies House stream listener keeps its state: the timepoint
 * it has processed up to, and the changes it has seen for this practice's
 * own clients.
 *
 * These live in their own tables rather than in the practice snapshot on
 * purpose. The listener runs unattended, and the snapshot is saved whole
 * with an optimistic version check (see routes/practiceData.mjs) — a
 * background writer poking at it would race every edit anyone makes. So the
 * stream only ever *records* that something changed; pulling the change
 * into the practice's data stays the existing, explicit "Refresh from
 * Companies House" action a person triggers.
 */
import { ensureSchema, query } from './db.mjs';

const STATE_ID = 'company-profile-stream';

/** There is exactly one practice per deployment today; see server/routes/practiceData.mjs. */
const PRACTICE_ID = 'prac_main';

export async function readStreamState() {
  await ensureSchema();
  const { rows } = await query('select timepoint, connected_at, last_event_at, last_error from companies_house_stream_state where id = $1', [STATE_ID]);
  const row = rows[0];
  if (!row) return { timepoint: null, connectedAt: null, lastEventAt: null, lastError: null };
  return {
    // bigint comes back as a string from pg; the stream wants a number.
    timepoint: row.timepoint === null ? null : Number(row.timepoint),
    connectedAt: row.connected_at ?? null,
    lastEventAt: row.last_event_at ?? null,
    lastError: row.last_error ?? null,
  };
}

/** Merges a partial update; `undefined` fields are left as they were. */
export async function writeStreamState(patch) {
  await ensureSchema();
  await query(
    `insert into companies_house_stream_state (id, timepoint, connected_at, last_event_at, last_error, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (id) do update set
       timepoint     = coalesce(excluded.timepoint, companies_house_stream_state.timepoint),
       connected_at  = coalesce(excluded.connected_at, companies_house_stream_state.connected_at),
       last_event_at = coalesce(excluded.last_event_at, companies_house_stream_state.last_event_at),
       -- last_error is cleared by passing an empty string, since coalesce
       -- can't tell "no change" from "no longer failing".
       last_error    = case when excluded.last_error = '' then null else coalesce(excluded.last_error, companies_house_stream_state.last_error) end,
       updated_at    = now()`,
    [STATE_ID, patch.timepoint ?? null, patch.connectedAt ?? null, patch.lastEventAt ?? null, patch.lastError ?? null],
  );
}

/**
 * Records one change. Idempotent on (company number, timepoint): a
 * reconnect replays from the last processed event, so the same record
 * arriving twice must not show up as two changes.
 */
export async function recordChange(event) {
  await ensureSchema();
  const { rowCount } = await query(
    `insert into companies_house_changes (company_number, event_type, fields_changed, published_at, timepoint)
     values ($1, $2, $3, $4, $5)
     on conflict (company_number, timepoint) do nothing`,
    [event.companyNumber, event.type, event.fieldsChanged, event.publishedAt, event.timepoint],
  );
  return rowCount > 0;
}

/** Changes nobody has dealt with yet, newest first. */
export async function pendingChanges(limit = 50) {
  await ensureSchema();
  const { rows } = await query(
    `select company_number, event_type, fields_changed, published_at, seen_at
     from companies_house_changes
     where acknowledged_at is null
     order by seen_at desc
     limit $1`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return rows.map((r) => ({
    companyNumber: r.company_number,
    type: r.event_type,
    fieldsChanged: r.fields_changed ?? [],
    publishedAt: r.published_at ?? null,
    seenAt: r.seen_at,
  }));
}

export async function countPendingChanges() {
  await ensureSchema();
  const { rows } = await query('select count(*)::int as n from companies_house_changes where acknowledged_at is null');
  return rows[0]?.n ?? 0;
}

/**
 * Marks changes handled. With no company numbers it clears everything
 * pending — what "I've refreshed them all" means.
 */
export async function acknowledgeChanges(companyNumbers) {
  await ensureSchema();
  const list = Array.isArray(companyNumbers) ? companyNumbers.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().toUpperCase()) : null;
  const { rowCount } =
    list && list.length > 0
      ? await query('update companies_house_changes set acknowledged_at = now() where acknowledged_at is null and company_number = any($1)', [list])
      : await query('update companies_house_changes set acknowledged_at = now() where acknowledged_at is null');
  return rowCount;
}

/**
 * The company numbers to watch, read from the stored practice snapshot.
 * The stream carries the whole UK register, so this set is the filter; it
 * is re-read periodically so a client added today starts being watched
 * without a restart.
 */
export async function watchedCompanyNumbers() {
  await ensureSchema();
  const { rows } = await query('select data from practice_snapshots where practice_id = $1', [PRACTICE_ID]);
  const watched = new Set();
  for (const row of rows) {
    for (const identifier of row.data?.identifiers ?? []) {
      if (identifier?.kind !== 'company_number') continue;
      const value = typeof identifier.value === 'string' ? identifier.value.trim().toUpperCase() : '';
      if (value) watched.add(value);
    }
  }
  return watched;
}

/** Housekeeping so the table can't grow without bound on a long-lived deployment. */
export async function pruneAcknowledgedChanges(olderThanDays = 30) {
  await ensureSchema();
  const { rowCount } = await query('delete from companies_house_changes where acknowledged_at is not null and acknowledged_at < now() - ($1 || \' days\')::interval', [String(Math.max(1, Number(olderThanDays) || 30))]);
  return rowCount;
}
