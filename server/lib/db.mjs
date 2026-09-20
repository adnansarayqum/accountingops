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

/**
 * Idempotent — safe to call on every cold start and every request path that
 * needs it. A failed bootstrap is not cached: the next caller tries again
 * instead of every later request inheriting the same rejection until restart.
 */
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = migrateUnderLock().catch((err) => {
      schemaReady = undefined;
      throw err;
    });
  }
  return schemaReady;
}

/** Arbitrary constant naming this app's schema bootstrap to pg_advisory_lock. */
const MIGRATION_LOCK_ID = 720_114_301;

/**
 * Two processes starting together (a rolling deploy, a dev server beside a
 * test run) both run `create table if not exists`, and Postgres can let both
 * past the existence check and fail one on the catalog's unique index. A
 * session-level advisory lock serialises the bootstrap across processes; the
 * statements themselves stay idempotent, so the second one simply finds
 * everything already there.
 */
async function migrateUnderLock() {
  const lockClient = await getPool().connect();
  try {
    await lockClient.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    try {
      await runMigrations();
    } finally {
      await lockClient.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    }
  } finally {
    lockClient.release();
  }
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
  // Morning briefing by email, per user (see lib/briefing*.mjs). Accounts
  // have a username, not an email, so this is the first place one is kept.
  await query('alter table practice_users add column if not exists briefing_email text');
  await query('alter table practice_users add column if not exists briefing_enabled boolean not null default false');
  await query('alter table practice_users add column if not exists briefing_last_sent_on date');
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
  // Client portal: single-purpose links a client can act on with no account,
  // the files they send, and a queue of what they did for the app to pull in.
  // Files live here for now — the documented target is object storage
  // (.env.example), and this table is the interim the way practice_snapshots
  // is. Never the practice snapshot: a public route must not race a save.
  await query(`
    create table if not exists portal_links (
      id             text primary key,
      token_hash     text not null unique,
      practice_id    text not null,
      client_id      text not null,
      job_id         text not null,
      purpose        text not null,
      message        text,
      attachment_id  text,
      created_by     text,
      created_at     timestamptz not null default now(),
      expires_at     timestamptz not null,
      used_at        timestamptz,
      revoked_at     timestamptz,
      last_opened_at timestamptz
    )
  `);
  await query('create index if not exists portal_links_job_idx on portal_links (job_id)');
  await query(`
    create table if not exists portal_uploads (
      id              text primary key,
      link_id         text references portal_links(id) on delete cascade,
      practice_id     text not null,
      client_id       text not null,
      job_id          text not null,
      direction       text not null,
      request_item_id text,
      file_name       text not null,
      content_type    text not null,
      size_bytes      integer not null,
      content         bytea not null,
      created_at      timestamptz not null default now()
    )
  `);
  await query('create index if not exists portal_uploads_link_idx on portal_uploads (link_id)');
  await query(`
    create table if not exists portal_activity (
      id              text primary key,
      link_id         text references portal_links(id) on delete cascade,
      practice_id     text not null,
      client_id       text not null,
      job_id          text not null,
      kind            text not null,
      request_item_id text,
      upload_id       text,
      file_name       text,
      size_kb         integer,
      decision        text,
      actor_name      text,
      note            text,
      created_at      timestamptz not null default now(),
      applied_at      timestamptz
    )
  `);
  await query('create index if not exists portal_activity_pending_idx on portal_activity (created_at) where applied_at is null');
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

  // Outbound email idempotency (see lib/emailClaims.mjs). One row per
  // (scope, key): the INSERT that creates it IS the claim, so two concurrent
  // requests with the same key cannot both reach the provider. `scope` is the
  // signed-in user, so one person's key can never replay or block another's.
  // `request_hash` binds the key to the message it was first used for.
  await query(`
    create table if not exists email_send_claims (
      scope            text not null,
      idempotency_key  text not null,
      request_hash     text not null,
      status           text not null check (status in ('pending','sent','unknown')),
      result           jsonb,
      created_at       timestamptz not null default now(),
      updated_at       timestamptz not null default now(),
      lease_expires_at timestamptz not null,
      expires_at       timestamptz not null,
      primary key (scope, idempotency_key)
    )
  `);
  await query('create index if not exists email_send_claims_expires_idx on email_send_claims (expires_at)');

  // Server-generated security audit trail (see lib/securityAudit.mjs).
  // Distinct from PracticeData.auditEvents, which is written by the browser
  // and so proves nothing. Rows here are only ever produced by server code
  // acting on an authenticated session, and the triggers below make the table
  // append-only for every role, including the application's own.
  await query(`
    create table if not exists security_audit_log (
      id             bigserial primary key,
      occurred_at    timestamptz not null default now(),
      actor_user_id  text,
      actor_username text,
      actor_role     text,
      action         text not null,
      outcome        text not null check (outcome in ('success','denied','failure')),
      target_type    text,
      target_id      text,
      details        jsonb not null default '{}'::jsonb,
      ip             text,
      user_agent     text
    )
  `);
  await query('create index if not exists security_audit_log_time_idx on security_audit_log (occurred_at desc)');
  await query('create index if not exists security_audit_log_action_idx on security_audit_log (action, occurred_at desc)');
  await query(`
    create or replace function security_audit_log_append_only() returns trigger as $$
    begin
      raise exception 'security_audit_log is append-only (% not permitted)', tg_op using errcode = '42501';
    end;
    $$ language plpgsql
  `);
  // Created only when missing — never dropped and recreated, which would
  // leave a window on every cold start with the table unprotected.
  await query(`
    do $$
    begin
      if not exists (select 1 from pg_trigger where tgrelid = 'security_audit_log'::regclass and tgname = 'security_audit_log_no_update_delete') then
        create trigger security_audit_log_no_update_delete before update or delete on security_audit_log
          for each row execute function security_audit_log_append_only();
      end if;
      if not exists (select 1 from pg_trigger where tgrelid = 'security_audit_log'::regclass and tgname = 'security_audit_log_no_truncate') then
        create trigger security_audit_log_no_truncate before truncate on security_audit_log
          for each statement execute function security_audit_log_append_only();
      end if;
    end
    $$
  `);
}
