import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

/** Upload keys against real PostgreSQL, in their own schema. Skipped unless DATABASE_URL is set. */
const RAW_URL = process.env.DATABASE_URL;
const RUN = Boolean(RAW_URL);
const SCHEMA = `t_tokens_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
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

describe('parseBearer', () => {
  it('reads the key out of an Authorization header, and nothing else', async () => {
    const { parseBearer } = await import('../intakeTokens.mjs');
    expect(parseBearer('Bearer frk_abc')).toBe('frk_abc');
    expect(parseBearer('bearer   frk_abc  ')).toBe('frk_abc');
    for (const bad of [undefined, '', 'Basic abc', 'Bearer', 'Bearer a b', 'frk_abc']) expect(parseBearer(bad)).toBeNull();
  });
});

describe.skipIf(!RUN)('upload keys (PostgreSQL)', () => {
  let db;
  let tokens;
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await withAdmin((admin) => admin.query(`create schema ${SCHEMA}`));
    const url = new URL(RAW_URL);
    url.searchParams.set('options', `-c search_path=${SCHEMA}`);
    process.env.DATABASE_URL = url.toString();
    db = await import('../db.mjs');
    tokens = await import('../intakeTokens.mjs');
    await db.ensureSchema();
    for (const id of ['u_ray', 'u_farhan']) {
      await db.query("insert into practice_users (id, username, name, role, password_hash, password_salt) values ($1, $1, $1, 'owner', 'x', 'x')", [id]);
    }
  });

  beforeEach(async () => {
    await db.query('delete from intake_tokens');
    await db.query('update practice_users set must_change_password = false');
  });

  afterAll(async () => {
    await db?.getPool().end();
    process.env.DATABASE_URL = originalUrl;
    await withAdmin((admin) => admin.query(`drop schema ${SCHEMA} cascade`));
  });

  it('makes a key that resolves to its user, and stores only a hash of it', async () => {
    const made = await tokens.createToken('u_ray', '  Ray’s   iPhone ');
    expect(made).toMatchObject({ label: 'Ray’s iPhone', token: expect.stringMatching(/^frk_[\w-]{43}$/) });
    const { rows } = await db.query('select * from intake_tokens');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(made.token);
    expect(rows[0].token_hash).toBe(tokens.hashToken(made.token));
    expect(await tokens.userForToken(made.token)).toEqual({ id: 'u_ray', username: 'u_ray', name: 'u_ray', role: 'owner' });
  });

  it('refuses unknown, malformed, revoked and temporary-password keys', async () => {
    const { id, token } = await tokens.createToken('u_ray');
    expect(await tokens.userForToken('frk_unknown')).toBeNull();
    expect(await tokens.userForToken('not-a-key')).toBeNull();
    expect(await tokens.userForToken('frk_' + 'x'.repeat(300))).toBeNull();

    await db.query("update practice_users set must_change_password = true where id = 'u_ray'");
    expect(await tokens.userForToken(token)).toBeNull();
    await db.query("update practice_users set must_change_password = false where id = 'u_ray'");
    expect(await tokens.userForToken(token)).not.toBeNull();

    expect(await tokens.revokeToken(id, 'u_farhan')).toBe(false);
    expect(await tokens.revokeToken(id, 'u_ray')).toBe(true);
    expect(await tokens.revokeToken(id, 'u_ray')).toBe(false);
    expect(await tokens.userForToken(token)).toBeNull();
  });

  it('lists a user’s live keys without the key itself, newest first, and notes when one was last used', async () => {
    const first = await tokens.createToken('u_ray', 'Old phone');
    await db.query("update intake_tokens set created_at = now() - interval '1 day' where id = $1", [first.id]);
    await tokens.createToken('u_ray', 'New phone');
    await tokens.createToken('u_farhan', 'Someone else');
    expect((await tokens.listTokens('u_ray')).map((t) => [t.label, t.lastUsedAt])).toEqual([['New phone', null], ['Old phone', null]]);

    await tokens.userForToken(first.token);
    expect((await tokens.listTokens('u_ray')).find((t) => t.label === 'Old phone').lastUsedAt).toEqual(expect.any(String));
  });

  it('allows five live keys at a time, and revoking one frees a place', async () => {
    const made = [];
    for (let i = 0; i < 5; i += 1) made.push(await tokens.createToken('u_ray', `k${i}`));
    expect(await tokens.createToken('u_ray')).toEqual({ error: 'too_many' });
    expect(await tokens.createToken('u_farhan')).toMatchObject({ token: expect.any(String) });
    await tokens.revokeToken(made[0].id, 'u_ray');
    expect(await tokens.createToken('u_ray')).toMatchObject({ token: expect.any(String) });
  });

  it('revokes every key for a user at once, and leaves everyone else’s alone', async () => {
    const ray = [await tokens.createToken('u_ray'), await tokens.createToken('u_ray')];
    const farhan = await tokens.createToken('u_farhan');
    expect(await tokens.revokeAllTokens('u_ray')).toBe(2);
    for (const k of ray) expect(await tokens.userForToken(k.token)).toBeNull();
    expect(await tokens.userForToken(farhan.token)).not.toBeNull();
  });
});
