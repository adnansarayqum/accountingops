/**
 * Postgres connection + minimal schema bootstrap for the interim
 * whole-aggregate persistence adapter (see db/schema.sql for the target
 * fully-relational schema this replaces once the app moves to per-entity
 * API calls). Nothing here runs unless DATABASE_URL is configured — every
 * route that depends on it must check isDatabaseConfigured() first and
 * degrade gracefully (503) rather than throw.
 */
import pg from 'pg';

const { Pool } = pg;

let pool;
let schemaReady;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

/** Idempotent — safe to call on every cold start and every request path that needs it. */
export function ensureSchema() {
  if (!schemaReady) schemaReady = runMigrations();
  return schemaReady;
}

async function runMigrations() {
  await query(`
    create table if not exists practice_snapshots (
      practice_id text primary key,
      data        jsonb not null,
      updated_at  timestamptz not null default now()
    )
  `);
  await query(`
    create table if not exists practice_users (
      id                    text primary key,
      username              text not null unique,
      name                  text not null,
      role                  text not null,
      password_hash         text not null,
      password_salt         text not null,
      must_change_password  boolean not null default true,
      created_at            timestamptz not null default now()
    )
  `);
  await query(`
    create table if not exists practice_sessions (
      token       text primary key,
      user_id     text not null references practice_users(id) on delete cascade,
      expires_at  timestamptz not null,
      created_at  timestamptz not null default now()
    )
  `);
  await query('create index if not exists practice_sessions_expires_idx on practice_sessions (expires_at)');
  // A one-shot password reset from a *_RESET_PASSWORD variable remembers
  // (as a hash) which value it already applied, so a restart with the
  // variable still set doesn't reset the password again (see
  // lib/bootstrapUsers.mjs).
  await query('alter table practice_users add column if not exists password_reset_applied text');
  // Versioned writes: every save names the version it was based on and is
  // refused if the stored one has moved on (see routes/practiceData.mjs).
  // Existing rows pick up version 1 and keep loading unchanged.
  await query('alter table practice_snapshots add column if not exists version bigint not null default 1');
  await query('alter table practice_snapshots add column if not exists saved_by text');
  // Companies House streaming API: where the stream got to, and the changes
  // it has seen for this practice's own clients (see companiesHouseStream.mjs).
  // Separate tables, deliberately not the practice snapshot — the listener
  // runs unattended and must never race the versioned whole-snapshot save.
  await query(`
    create table if not exists companies_house_stream_state (
      id            text primary key,
      timepoint     bigint,
      connected_at  timestamptz,
      last_event_at timestamptz,
      last_error    text,
      updated_at    timestamptz not null default now()
    )
  `);
  await query(`
    create table if not exists companies_house_changes (
      id              bigserial primary key,
      company_number  text not null,
      event_type      text not null,
      fields_changed  text[] not null default '{}',
      published_at    timestamptz,
      timepoint       bigint not null,
      seen_at         timestamptz not null default now(),
      acknowledged_at timestamptz
    )
  `);
  // Reconnecting replays from the last processed timepoint, so the same
  // event can arrive twice; the unique key makes recording it idempotent.
  await query('create unique index if not exists companies_house_changes_event_idx on companies_house_changes (company_number, timepoint)');
  await query('create index if not exists companies_house_changes_pending_idx on companies_house_changes (seen_at) where acknowledged_at is null');
  // HMRC Making Tax Digital: the agent's OAuth tokens. One row per agent
  // services account, not per client — HMRC authorise the agent, and the
  // agent's authority over each client is checked by them on every call.
  // Tokens are credentials: nothing here is ever sent to the browser.
  await query(`
    create table if not exists hmrc_agent_tokens (
      id             text primary key,
      access_token   text not null,
      refresh_token  text,
      scope          text,
      expires_at     timestamptz not null,
      connected_by   text,
      connected_at   timestamptz not null default now(),
      updated_at     timestamptz not null default now()
    )
  `);
  await query(`
    create table if not exists practice_snapshot_history (
      id          bigserial primary key,
      practice_id text not null,
      version     bigint not null,
      data        jsonb not null,
      saved_by    text,
      saved_at    timestamptz not null default now(),
      unique (practice_id, version)
    )
  `);
}
