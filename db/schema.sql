-- Accountancy Operations Command Centre — relational schema (PostgreSQL)
--
-- Every tenant-owned table carries practice_id and is expected to be queried
-- with a practice_id predicate. Row-level security policies are sketched at
-- the bottom so tenant isolation is enforced by the database, not only by
-- application code.
--
-- This schema mirrors src/domain/types.ts. It is the target end-state once
-- the app moves from whole-aggregate mutations to per-entity API calls.
-- The tables the app actually connects to today are simpler — see the
-- "Interim server persistence" section at the end of this file — and are
-- created automatically by server/lib/db.mjs, not from this file.

create extension if not exists pgcrypto;

create table practices (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  timezone      text not null default 'Europe/London',
  created_at    timestamptz not null default now()
);

create table users (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  name          text not null,
  email         text not null,
  role          text not null check (role in ('owner','manager','accountant','admin')),
  weekly_capacity_hours numeric(5,1) not null default 35,
  created_at    timestamptz not null default now(),
  unique (practice_id, email)
);

create table clients (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  name          text not null,
  type          text not null check (type in ('limited_company','sole_trader','landlord','partnership','individual')),
  lifecycle     text not null default 'onboarding' check (lifecycle in ('onboarding','active','dormant','ceased')),
  owner_user_id uuid references users(id),
  backup_owner_user_id uuid references users(id),
  preferred_channel text not null default 'email',
  year_end      text,
  sector        text,
  notes         text,
  average_response_days numeric(5,1) not null default 4,
  created_at    timestamptz not null default now()
);
create index on clients (practice_id, name);

create table contacts (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  client_id     uuid not null references clients(id) on delete cascade,
  name          text not null,
  role          text,
  email         text,
  phone         text,
  whatsapp      text,
  is_primary    boolean not null default false
);
create index on contacts (practice_id, client_id);

-- Sensitive identifiers live in their own table so they can be encrypted at
-- rest (pgcrypto / KMS envelope) and access-controlled independently.
create table client_identifiers (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  client_id     uuid not null references clients(id) on delete cascade,
  kind          text not null check (kind in ('utr','nino','company_number','vat_number','paye_reference','accounts_office_ref')),
  value_encrypted bytea not null,
  last4         text not null,          -- for masked display without decrypting
  sensitive     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (client_id, kind)
);

create table people (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  full_name     text not null,
  date_of_birth date,
  email         text
);

create table person_roles (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  person_id     uuid not null references people(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  kind          text not null check (kind in ('director','psc','partner','proprietor')),
  identity_verification text not null default 'not_started' check (identity_verification in ('verified','in_progress','not_started','expired')),
  personal_code_captured boolean not null default false,
  evidence_status text not null default 'none'
);

create table service_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  client_id     uuid not null references clients(id) on delete cascade,
  service_code  text not null,
  started_on    date not null,
  active        boolean not null default true,
  unique (client_id, service_code)
);

create table obligations (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  client_id     uuid not null references clients(id) on delete cascade,
  service_code  text not null,
  name          text not null,
  frequency     text not null check (frequency in ('annual','quarterly','monthly','none')),
  last_period_end date not null,
  due_offset_days int not null,
  period_length_months int not null
);

create table jobs (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  client_id     uuid not null references clients(id) on delete cascade,
  obligation_id uuid references obligations(id),
  service_code  text not null,
  name          text not null,
  period_key    text not null,
  period_start  date not null,
  period_end    date not null,
  due_date      date not null,
  status        text not null check (status in ('waiting_for_records','ready_to_start','in_progress','internal_review','waiting_client_approval','ready_to_file','filed')),
  waiting_on    text not null check (waiting_on in ('client','accountant','senior_review','hmrc','companies_house','approval','payment','nothing')),
  assignee_user_id uuid references users(id),
  reviewer_user_id uuid references users(id),
  estimated_hours numeric(6,1) not null default 0,
  status_changed_at timestamptz not null default now(),
  filed_at      timestamptz,
  chasing_paused boolean not null default false,
  created_at    timestamptz not null default now(),
  -- Duplicate recurring-job prevention is a database guarantee, not just app logic.
  unique (obligation_id, period_key)
);
create index on jobs (practice_id, due_date);
create index on jobs (practice_id, status);

create table information_request_items (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  job_id        uuid not null references jobs(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  label         text not null,
  document_type text not null,
  status        text not null default 'missing' check (status in ('missing','requested','received')),
  required      boolean not null default true,
  requested_at  timestamptz,
  received_at   timestamptz,
  document_id   uuid
);

-- Documents are metadata only; bytes live in object storage.
create table documents (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  client_id     uuid not null references clients(id) on delete cascade,
  job_id        uuid references jobs(id),
  file_name     text not null,
  document_type text not null,
  storage_key   text not null,
  size_kb       int not null default 0,
  source        text not null,
  received_at   timestamptz not null default now()
);

create table communications (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  client_id     uuid not null references clients(id) on delete cascade,
  job_id        uuid references jobs(id),
  direction     text not null check (direction in ('outbound','inbound')),
  channel       text not null,
  recipient     text not null,
  subject       text,
  body          text not null,
  sent_at       timestamptz not null default now(),
  sent_by_user_id uuid references users(id),
  reminder_stage text,
  documents_requested text[],
  response_status text not null default 'n/a',
  simulated     boolean not null default false,
  provider_message_id text
);
create index on communications (practice_id, client_id, sent_at desc);

create table reminder_sequences (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  name          text not null,
  steps         jsonb not null
);

create table reminder_attempts (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  job_id        uuid not null references jobs(id) on delete cascade,
  sequence_id   uuid references reminder_sequences(id),
  step_index    int not null,
  scheduled_for timestamptz not null,
  attempted_at  timestamptz,
  communication_id uuid references communications(id),
  outcome       text not null default 'scheduled' check (outcome in ('scheduled','sent','skipped_complete','skipped_paused','failed')),
  unique (job_id, step_index)
);

create table approvals (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  job_id        uuid not null references jobs(id) on delete cascade,
  kind          text not null check (kind in ('internal','client')),
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  reviewer_name text,
  note          text
);

create table filing_records (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  job_id        uuid not null references jobs(id) on delete cascade,
  filed_at      timestamptz not null default now(),
  filed_by_user_id uuid references users(id),
  submission_reference text not null,
  destination   text not null,
  evidence_status text not null default 'pending',
  simulated     boolean not null default true
);

create table activities (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  kind          text not null,
  message       text not null,
  client_id     uuid references clients(id) on delete set null,
  job_id        uuid references jobs(id) on delete set null,
  actor_user_id uuid references users(id),
  occurred_at   timestamptz not null default now()
);
create index on activities (practice_id, occurred_at desc);

-- Append-only. No UPDATE/DELETE grants for the application role.
create table audit_events (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  actor_user_id uuid references users(id),
  action        text not null,
  entity_type   text not null,
  entity_id     text not null,
  before_value  jsonb,
  after_value   jsonb,
  occurred_at   timestamptz not null default now(),
  source        text not null default 'ui',
  correlation_id text not null
);
create index on audit_events (practice_id, occurred_at desc);
create index on audit_events (practice_id, entity_type, entity_id);

create table inbox_items (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  file_name     text not null,
  storage_key   text not null,
  received_at   timestamptz not null default now(),
  source        text not null,
  sender        text,
  size_kb       int not null default 0,
  suggestion    jsonb not null,
  status        text not null default 'pending' check (status in ('pending','confirmed','dismissed')),
  resolved_at   timestamptz,
  resolved_by_user_id uuid references users(id)
);

create table risk_evaluations (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  job_id        uuid not null references jobs(id) on delete cascade,
  evaluated_at  timestamptz not null default now(),
  severity      text not null,
  rule_code     text not null,
  reasons       text[] not null,
  recommended_action jsonb not null
);

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  user_id       uuid references users(id),
  title         text not null,
  body          text not null,
  kind          text not null,
  client_id     uuid references clients(id) on delete set null,
  job_id        uuid references jobs(id) on delete set null,
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);

create table onboarding_cases (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  client_id     uuid not null references clients(id) on delete cascade,
  stage         text not null,
  started_at    timestamptz not null default now(),
  checklist     jsonb not null
);

create table mtd_readiness (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references practices(id),
  client_id     uuid not null references clients(id) on delete cascade,
  income_band   text not null,
  start_year    text,
  signed_up     boolean not null default false,
  software_ready boolean not null default false,
  agent_authorised boolean not null default false,
  accounting_basis text not null default 'cash',
  next_quarterly_due date
);

-- ---------------------------------------------------------------------------
-- Tenant isolation: row-level security on every tenant table.
-- The API sets `set local app.practice_id = '<uuid>'` per request/transaction.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array['users','clients','contacts','client_identifiers','people','person_roles','service_subscriptions','obligations','jobs','information_request_items','documents','communications','reminder_sequences','reminder_attempts','approvals','filing_records','activities','audit_events','inbox_items','risk_evaluations','notifications','onboarding_cases','mtd_readiness'])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (practice_id = current_setting(''app.practice_id'', true)::uuid) with check (practice_id = current_setting(''app.practice_id'', true)::uuid)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Interim server persistence (what the app actually uses today)
--
-- Rewriting the store's whole-aggregate mutate() into per-entity API calls
-- against the schema above is real future work. Until then, the server
-- stores the entire PracticeData object as one JSONB snapshot — this is
-- what let real, shared, multi-user login and persistence ship without
-- rewriting the client's domain/application layers. Created automatically
-- by server/lib/db.mjs (create table if not exists) on first use, so this
-- block is documentation, not something you need to run by hand.
-- ---------------------------------------------------------------------------

create table if not exists practice_snapshots (
  practice_id text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists practice_users (
  id                    text primary key,
  username              text not null unique,
  name                  text not null,
  role                  text not null,
  password_hash         text not null,
  password_salt         text not null,
  must_change_password  boolean not null default true,
  created_at            timestamptz not null default now()
);

create table if not exists practice_sessions (
  token       text primary key,
  user_id     text not null references practice_users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists practice_sessions_expires_idx on practice_sessions (expires_at);

-- Outbound email idempotency (server/lib/emailClaims.mjs). The INSERT that
-- creates a row is the claim, so of any number of concurrent requests with
-- one key exactly one may call the provider. Keys are scoped per signed-in
-- user ('user:<id>') and bound to the message they were first used for.
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
);
create index if not exists email_send_claims_expires_idx on email_send_claims (expires_at);

-- Server-generated security audit trail (server/lib/securityAudit.mjs) — the
-- authoritative record; PracticeData.auditEvents inside the snapshot is
-- written by the browser and is not. Append-only for EVERY role via triggers.
-- In production also grant the application role INSERT and SELECT only.
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
);
create index if not exists security_audit_log_time_idx on security_audit_log (occurred_at desc);
create index if not exists security_audit_log_action_idx on security_audit_log (action, occurred_at desc);
create or replace function security_audit_log_append_only() returns trigger as $$
begin
  raise exception 'security_audit_log is append-only (% not permitted)', tg_op using errcode = '42501';
end;
$$ language plpgsql;
create trigger security_audit_log_no_update_delete before update or delete on security_audit_log
  for each row execute function security_audit_log_append_only();
create trigger security_audit_log_no_truncate before truncate on security_audit_log
  for each statement execute function security_audit_log_append_only();
