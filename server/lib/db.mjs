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
}
