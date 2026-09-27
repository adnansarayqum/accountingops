import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import pg from 'pg';
import { randomBytes } from 'node:crypto';

/**
 * PostgreSQL-backed tests for the production-blocker fixes: durable email
 * idempotency, server-side authorisation, snapshot validation and the
 * server-generated audit trail. Skipped unless DATABASE_URL is set (like
 * auth.test.mjs).
 *
 * Runs in its OWN schema (search_path on the connection), created here and
 * dropped afterwards, so it can run in parallel with auth.test.mjs — which
 * empties practice_users and practice_snapshots in the default schema —
 * without either file disturbing the other.
 *
 * Everything goes over real HTTP to real routers with real session cookies;
 * only the outbound call to Postmark is stubbed. Requests use node:http so
 * that stubbing global fetch never intercepts the test's own requests.
 */
const RAW_URL = process.env.DATABASE_URL;
const RUN = Boolean(RAW_URL);
const SCHEMA = `t_blockers_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

const sslOption = () => (process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false });
const urlForSchema = (schema) => {
  const url = new URL(RAW_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
};

async function withAdmin(fn) {
  const admin = new pg.Client({ connectionString: RAW_URL, ssl: sslOption() });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

describe.skipIf(!RUN)('production blockers (PostgreSQL)', () => {
  let server;
  let baseUrl;
  let db; // the app's own db module, bound to SCHEMA
  let audit; // securityAudit module
  let claims; // emailClaims module
  let messages; // messages router module
  let tokenStore; // resolved up front: later tests reset the module registry
  let sessions;
  const originalEnv = { ...process.env };

  const cookieFor = (label) => sessions[label];

  function call(method, path, { as, body, headers = {}, base = baseUrl } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const req = http.request(
        `${base}${path}`,
        {
          method,
          headers: {
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
            ...(as ? { Cookie: cookieFor(as) } : {}),
            ...headers,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            let parsed = {};
            try {
              parsed = data ? JSON.parse(data) : {};
            } catch {
              parsed = { raw: data };
            }
            resolve({ status: res.statusCode, headers: res.headers, body: parsed });
          });
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  /** The users the tests sign in as. `stranger` holds a role the matrix has never heard of. */
  const USERS = [
    { label: 'owner', id: 'u_owner', role: 'owner' },
    { label: 'manager', id: 'u_manager', role: 'manager' },
    { label: 'accountant', id: 'u_accountant', role: 'accountant' },
    { label: 'admin', id: 'u_admin', role: 'admin' },
    { label: 'stranger', id: 'u_stranger', role: 'intern' },
  ];

  const EVERY_COLLECTION = ['users', 'clients', 'contacts', 'identifiers', 'people', 'personRoles', 'subscriptions', 'obligations', 'jobs', 'requestItems', 'documents', 'communications', 'reminderSequences', 'approvals', 'filings', 'activities', 'auditEvents', 'inboxItems', 'notifications', 'onboardingCases', 'mtdReadiness'];

  const teamRows = () => USERS.filter((u) => u.role !== 'intern').map((u) => ({ id: u.id, practiceId: 'prac_main', name: `Person ${u.label}`, initials: u.label[0].toUpperCase(), role: u.role, weeklyCapacityHours: 40, colour: 'blue' }));

  function snapshot(overrides = {}) {
    const data = { practice: { id: 'prac_main', name: 'Test Practice', timezone: 'Europe/London' } };
    for (const key of EVERY_COLLECTION) data[key] = [];
    data.users = teamRows();
    return { ...data, ...overrides };
  }

  const auditEvent = (over = {}) => ({ id: `aud_${randomBytes(4).toString('hex')}`, practiceId: 'prac_main', actorUserId: 'u_owner', action: 'job.transition', entityType: 'job', entityId: 'j1', occurredAt: '2026-09-11T10:00:00.000Z', source: 'ui', correlationId: 'c1', ...over });

  const put = (as, data, expectedVersion) => call('PUT', '/api/practice-data', { as, body: { data, expectedVersion } });
  const storedVersion = async () => Number((await db.query('select version from practice_snapshots')).rows[0]?.version ?? 0);
  const storedData = async () => (await db.query('select data from practice_snapshots')).rows[0]?.data;
  const maxAuditId = async () => Number((await db.query('select coalesce(max(id), 0) as m from security_audit_log')).rows[0].m);
  const auditSince = async (mark, action) => (await db.query('select * from security_audit_log where id > $1 and ($2::text is null or action = $2) order by id', [mark, action ?? null])).rows;

  /** A fresh, empty practice — versions restart at 0. */
  async function resetPractice() {
    await db.query('delete from practice_snapshots');
    await db.query('delete from practice_snapshot_history');
  }

  beforeAll(async () => {
    await withAdmin((admin) => admin.query(`create schema ${SCHEMA}`));
    process.env.DATABASE_URL = urlForSchema(SCHEMA);
    process.env.HMRC_CLIENT_ID = 'test-client';
    process.env.HMRC_CLIENT_SECRET = 'test-secret';
    delete process.env.HMRC_TOKEN_ENCRYPTION_KEY;

    db = await import('../../lib/db.mjs');
    audit = await import('../../lib/securityAudit.mjs');
    claims = await import('../../lib/emailClaims.mjs');
    tokenStore = await import('../../lib/hmrc/tokenStore.mjs');
    await db.ensureSchema();

    const { hashSessionToken } = await import('../../lib/sessionTokens.mjs');
    const { SESSION_COOKIE } = await import('../../lib/cookies.mjs');
    const { hashPassword } = await import('../../lib/passwords.mjs');
    const known = await hashPassword('CorrectHorse-9');
    sessions = {};
    for (const user of USERS) {
      await db.query('insert into practice_users (id, username, name, role, password_hash, password_salt, must_change_password) values ($1,$2,$3,$4,$5,$6,false)', [user.id, user.label, `Person ${user.label}`, user.role, known.hash, known.salt]);
      const token = randomBytes(32).toString('hex');
      await db.query('insert into practice_sessions (token, user_id, expires_at) values ($1,$2, now() + interval \'1 day\')', [hashSessionToken(token), user.id]);
      sessions[user.label] = `${SESSION_COOKIE}=${token}`;
    }

    const { default: authRouter } = await import('../auth.mjs');
    const { default: practiceDataRouter } = await import('../practiceData.mjs');
    const { default: hmrcRouter } = await import('../hmrc.mjs');
    messages = await import('../messages.mjs');
    const app = express();
    app.set('trust proxy', 1);
    app.use('/api/auth', authRouter);
    app.use('/api/practice-data', practiceDataRouter);
    app.use('/api/hmrc', hmrcRouter);
    app.use('/api/messages', messages.default);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.getPool().end();
    await withAdmin((admin) => admin.query(`drop schema if exists ${SCHEMA} cascade`));
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  beforeEach(async () => {
    await resetPractice();
    messages.sendLimiter.reset();
    messages.resetIdempotency();
  });

  afterEach(() => vi.unstubAllGlobals());

  // ---------------------------------------------------------------------------
  describe('schema bootstrap', () => {
    it('creates the new tables with their keys and constraints', async () => {
      const { rows } = await db.query("select table_name from information_schema.tables where table_schema = $1 and table_name in ('email_send_claims','security_audit_log') order by 1", [SCHEMA]);
      expect(rows.map((r) => r.table_name)).toEqual(['email_send_claims', 'security_audit_log']);
      const pk = await db.query("select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = 'email_send_claims'::regclass and i.indisprimary order by a.attname");
      expect(pk.rows.map((r) => r.attname)).toEqual(['idempotency_key', 'scope']);
    });

    it('is idempotent, and safe when several processes bootstrap one fresh database at once', async () => {
      const fresh = `${SCHEMA}_fresh`;
      await withAdmin((admin) => admin.query(`create schema ${fresh}`));
      const previous = process.env.DATABASE_URL;
      process.env.DATABASE_URL = urlForSchema(fresh);
      const instances = [];
      try {
        // Separate module instances = separate pools and no shared in-process
        // promise, i.e. what separate server processes look like.
        for (let i = 0; i < 4; i += 1) {
          vi.resetModules();
          instances.push(await import('../../lib/db.mjs'));
        }
        await Promise.all(instances.map((m) => m.ensureSchema()));
        await Promise.all(instances.map((m) => m.ensureSchema()));
        const { rows } = await instances[0].query("select count(*)::int as n from information_schema.tables where table_schema = $1 and table_name in ('email_send_claims','security_audit_log','practice_users','practice_snapshots')", [fresh]);
        expect(rows[0].n).toBe(4);
        const triggers = await instances[0].query("select count(*)::int as n from pg_trigger where tgrelid = 'security_audit_log'::regclass and not tgisinternal");
        expect(triggers.rows[0].n).toBe(2); // created once, never duplicated by re-running
      } finally {
        await Promise.all(instances.map((m) => m.getPool().end()));
        process.env.DATABASE_URL = previous;
        await withAdmin((admin) => admin.query(`drop schema if exists ${fresh} cascade`));
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('durable email idempotency', () => {
    const configurePostmark = (fetchImpl) => {
      process.env.MESSAGING_EMAIL_PROVIDER = 'postmark';
      process.env.POSTMARK_SERVER_TOKEN = 'pm-secret-token';
      process.env.MESSAGING_FROM_EMAIL = 'reminders@practice.example';
      const spy = vi.fn(fetchImpl ?? (async () => new Response(JSON.stringify({ MessageID: 'pm-1' }), { status: 200 })));
      vi.stubGlobal('fetch', spy);
      return spy;
    };
    const send = (as, overrides = {}) => call('POST', '/api/messages/send', { as, body: { channel: 'email', to: 'client@example.com', subject: 'Documents', body: 'Hello Dave', idempotencyKey: 'send_db_key_0001', ...overrides } });
    afterEach(async () => {
      delete process.env.MESSAGING_EMAIL_PROVIDER;
      await db.query('delete from email_send_claims');
    });

    it('twenty simultaneous claims for one key: exactly one wins', async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () => claims.claimSend({ scope: 'user:u_owner', key: 'race_key_0001', requestHash: 'h1' })));
      expect(results.filter((r) => r.state === 'claimed')).toHaveLength(1);
      expect(results.filter((r) => r.state === 'in_progress')).toHaveLength(19);
      await claims.completeSend({ scope: 'user:u_owner', key: 'race_key_0001', result: { ok: true, providerMessageId: 'pm-x' } });
      const later = await claims.claimSend({ scope: 'user:u_owner', key: 'race_key_0001', requestHash: 'h1' });
      expect(later).toEqual({ state: 'replay', result: { ok: true, providerMessageId: 'pm-x' } });
    });

    it('ten simultaneous HTTP sends of one draft reach the provider once, and every answer agrees', async () => {
      const spy = configurePostmark(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150)); // keep the first one in flight while the others arrive
        return new Response(JSON.stringify({ MessageID: 'pm-only-one' }), { status: 200 });
      });
      const responses = await Promise.all(Array.from({ length: 10 }, () => send('owner', { idempotencyKey: 'send_race_http_1' })));
      expect(spy).toHaveBeenCalledTimes(1);
      for (const r of responses) expect([200, 409]).toContain(r.status);
      const ok = responses.filter((r) => r.status === 200);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      expect(new Set(ok.map((r) => r.body.providerMessageId))).toEqual(new Set(['pm-only-one']));
      expect(responses.filter((r) => r.status === 409).every((r) => r.body.error === 'send_in_progress')).toBe(true);
      expect(ok.filter((r) => !r.body.deduplicated)).toHaveLength(1);
      // And from here on the answer is a replay.
      const again = await send('owner', { idempotencyKey: 'send_race_http_1' });
      expect(again.body).toMatchObject({ providerMessageId: 'pm-only-one', deduplicated: true });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('survives a restart: a fresh server process with empty memory still replays instead of sending again', async () => {
      const spy = configurePostmark();
      const first = await send('owner', { idempotencyKey: 'send_restart_001' });
      expect(first.status).toBe(200);

      // A "new process": fresh module instances (their own pool, their own
      // empty in-memory state), serving the same database.
      vi.resetModules();
      const { default: freshRouter } = await import('../messages.mjs');
      const freshDb = await import('../../lib/db.mjs');
      const app = express();
      app.use('/api/messages', freshRouter);
      const restarted = app.listen(0);
      await new Promise((resolve) => restarted.once('listening', resolve));
      try {
        const res = await call('POST', '/api/messages/send', {
          as: 'owner',
          base: `http://127.0.0.1:${restarted.address().port}`,
          body: { channel: 'email', to: 'client@example.com', subject: 'Documents', body: 'Hello Dave', idempotencyKey: 'send_restart_001' },
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ providerMessageId: 'pm-1', deduplicated: true });
      } finally {
        await new Promise((resolve) => restarted.close(resolve));
        await freshDb.getPool().end();
      }
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('scopes keys to the user: two people using the same key both send', async () => {
      const spy = configurePostmark();
      const [a, b] = await Promise.all([send('owner', { idempotencyKey: 'send_same_key_01' }), send('accountant', { idempotencyKey: 'send_same_key_01' })]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(2);
      const { rows } = await db.query("select scope from email_send_claims where idempotency_key = 'send_same_key_01' order by scope");
      expect(rows.map((r) => r.scope)).toEqual(['user:u_accountant', 'user:u_owner']);
    });

    it('binds a key to its message: the same key with different content is refused, not answered with the wrong result', async () => {
      const spy = configurePostmark();
      await send('owner', { idempotencyKey: 'send_bound_key_1' });
      const changed = await send('owner', { idempotencyKey: 'send_bound_key_1', to: 'someone.else@example.com' });
      expect(changed.status).toBe(422);
      expect(changed.body.error).toBe('idempotency_key_reused');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('releases the claim when the provider definitively refused, and keeps it as unknown when the outcome is unknowable', async () => {
      let n = 0;
      configurePostmark(async () => {
        n += 1;
        if (n === 1) return new Response(JSON.stringify({ Message: 'nope' }), { status: 422 });
        if (n === 2) throw new Error('socket hang up');
        return new Response(JSON.stringify({ MessageID: 'pm-later' }), { status: 200 });
      });
      expect((await send('owner', { idempotencyKey: 'send_refused_001' })).status).toBe(400);
      expect((await db.query("select 1 from email_send_claims where idempotency_key = 'send_refused_001'")).rowCount).toBe(0);
      expect((await send('owner', { idempotencyKey: 'send_refused_001' })).status).toBe(502); // 2nd call: connection lost
      expect((await db.query("select status from email_send_claims where idempotency_key = 'send_refused_001'")).rows[0].status).toBe('unknown');
      const third = await send('owner', { idempotencyKey: 'send_refused_001' });
      expect(third.status).toBe(409);
      expect(third.body.error).toBe('send_outcome_unknown');
      expect(n).toBe(2);
    });

    it('treats a claim whose owner never reported back as unknown once its lease runs out — never as an invitation to send again', async () => {
      expect(await claims.claimSend({ scope: 'user:u_owner', key: 'lease_key_0001', requestHash: 'h' })).toEqual({ state: 'claimed' });
      expect(await claims.claimSend({ scope: 'user:u_owner', key: 'lease_key_0001', requestHash: 'h' })).toEqual({ state: 'in_progress' });
      await db.query("update email_send_claims set lease_expires_at = now() - interval '1 second' where idempotency_key = 'lease_key_0001'");
      expect(await claims.claimSend({ scope: 'user:u_owner', key: 'lease_key_0001', requestHash: 'h' })).toEqual({ state: 'unknown' });
      expect((await db.query("select status from email_send_claims where idempotency_key = 'lease_key_0001'")).rows[0].status).toBe('unknown');
    });

    it('lets an expired claim be reused, atomically, as a brand-new one', async () => {
      await claims.claimSend({ scope: 'user:u_owner', key: 'expiry_key_001', requestHash: 'old' });
      await claims.completeSend({ scope: 'user:u_owner', key: 'expiry_key_001', result: { ok: true } });
      await db.query("update email_send_claims set expires_at = now() - interval '1 minute' where idempotency_key = 'expiry_key_001'");
      const taken = await Promise.all(Array.from({ length: 8 }, () => claims.claimSend({ scope: 'user:u_owner', key: 'expiry_key_001', requestHash: 'new' })));
      expect(taken.filter((r) => r.state === 'claimed')).toHaveLength(1);
      const row = (await db.query("select request_hash, status, result from email_send_claims where idempotency_key = 'expiry_key_001'")).rows[0];
      expect(row).toEqual({ request_hash: 'new', status: 'pending', result: null });
    });

    it('also serves authenticated simulated sends durably (no provider call, but the same claim)', async () => {
      delete process.env.MESSAGING_EMAIL_PROVIDER;
      const first = await send('owner', { idempotencyKey: 'send_sim_dur_001' });
      const second = await send('owner', { idempotencyKey: 'send_sim_dur_001' });
      expect(first.body.providerName).toBe('simulated');
      expect(second.body).toEqual({ ...first.body, deduplicated: true });
      expect((await db.query("select status from email_send_claims where idempotency_key = 'send_sim_dur_001'")).rows[0].status).toBe('sent');
    });

    it('refuses a role the matrix does not know and never touches the claim table or the provider', async () => {
      const spy = configurePostmark();
      const res = await send('stranger', { idempotencyKey: 'send_stranger_01' });
      expect(res.status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
      expect((await db.query('select count(*)::int as n from email_send_claims')).rows[0].n).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('authorisation: practice-wide destructive operations', () => {
    async function twoVersions() {
      expect((await put('owner', snapshot({ clients: [] }), 0)).status).toBe(200);
      expect((await put('owner', snapshot({ clients: [{ id: 'c1', name: 'Acme Ltd' }] }), 1)).status).toBe(200);
    }

    it('snapshot restore: only an owner may; every other role is refused, nothing changes, and the refusal is on the record', async () => {
      await twoVersions();
      for (const role of ['manager', 'accountant', 'admin', 'stranger']) {
        const mark = await maxAuditId();
        const res = await call('POST', '/api/practice-data/restore', { as: role, body: { version: 1, expectedVersion: 2 } });
        expect(res.status, role).toBe(403);
        expect(res.body).toEqual({ error: 'forbidden', permission: 'snapshot.restore' });
        expect(await storedVersion()).toBe(2);
        const denials = await auditSince(mark, 'authorization.denied');
        expect(denials).toHaveLength(1);
        expect(denials[0]).toMatchObject({ actor_user_id: USERS.find((u) => u.label === role).id, actor_role: USERS.find((u) => u.label === role).role, outcome: 'denied', target_id: 'snapshot.restore' });
      }
      expect((await storedData()).clients).toHaveLength(1);
    });

    it('snapshot restore by an owner succeeds as a new version, and is audited in the same transaction', async () => {
      await twoVersions();
      const mark = await maxAuditId();
      const res = await call('POST', '/api/practice-data/restore', { as: 'owner', body: { version: 1, expectedVersion: 2 } });
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(3);
      expect((await storedData()).clients).toEqual([]);
      const [event] = await auditSince(mark, 'snapshot.restore');
      expect(event).toMatchObject({ actor_user_id: 'u_owner', outcome: 'success', target_id: '1' });
      expect(event.details).toEqual({ restoredVersion: 1, previousVersion: 2, newVersion: 3 });
    });

    it('a restore that fails its version check leaves no audit record claiming it happened', async () => {
      await twoVersions();
      const mark = await maxAuditId();
      const res = await call('POST', '/api/practice-data/restore', { as: 'owner', body: { version: 1, expectedVersion: 1 } });
      expect(res.status).toBe(409);
      expect(await auditSince(mark, 'snapshot.restore')).toHaveLength(0);
    });

    it('unauthenticated callers get 401, never a permission answer', async () => {
      for (const [method, path] of [['POST', '/api/practice-data/restore'], ['GET', '/api/practice-data/security-audit'], ['GET', '/api/hmrc/connect'], ['POST', '/api/hmrc/disconnect']]) {
        expect((await call(method, path, { body: method === 'POST' ? {} : undefined })).status, `${method} ${path}`).toBe(401);
      }
    });

    it('HMRC connect / callback / disconnect: owner only', async () => {
      for (const role of ['manager', 'accountant', 'admin', 'stranger']) {
        const mark = await maxAuditId();
        const connect = await call('GET', '/api/hmrc/connect', { as: role });
        const callback = await call('GET', '/api/hmrc/callback?code=abc&state=nope', { as: role });
        const disconnect = await call('POST', '/api/hmrc/disconnect', { as: role, body: {} });
        for (const res of [connect, callback, disconnect]) {
          expect(res.status, role).toBe(403);
          expect(res.body).toEqual({ error: 'forbidden', permission: 'hmrc.connect' });
        }
        expect(await auditSince(mark, 'authorization.denied')).toHaveLength(3);
      }
    });

    it('HMRC disconnect actually removes the tokens for an owner — and only for an owner — and is recorded first', async () => {
      const { writeTokens, readTokens } = tokenStore;
      await writeTokens({ accessToken: 'at', refreshToken: 'rt', scope: 'read:vat', expiresInSeconds: 3600, connectedBy: 'u_owner' });
      expect((await call('POST', '/api/hmrc/disconnect', { as: 'accountant', body: {} })).status).toBe(403);
      expect(await readTokens()).not.toBeNull();

      const mark = await maxAuditId();
      const res = await call('POST', '/api/hmrc/disconnect', { as: 'owner', body: {} });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ disconnected: true });
      expect(await readTokens()).toBeNull();
      const [event] = await auditSince(mark, 'hmrc.disconnected');
      expect(event).toMatchObject({ actor_user_id: 'u_owner', outcome: 'success', target_type: 'hmrc' });
    });

    it('HMRC connect by an owner returns the consent URL and is recorded; the URL carries no secret', async () => {
      const mark = await maxAuditId();
      const res = await call('GET', '/api/hmrc/connect', { as: 'owner' });
      expect(res.status).toBe(200);
      expect(res.body.url).toContain('/oauth/authorize');
      expect(res.body.url).not.toContain('test-secret');
      expect(await auditSince(mark, 'hmrc.connect_started')).toHaveLength(1);
    });

    it('everyday HMRC lookups stay open to accountants: authorisation is not what stops them', async () => {
      const res = await call('POST', '/api/hmrc/vat/123456789/obligations', { as: 'accountant', body: {} });
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  describe('authorisation: practice, team and the snapshot', () => {
    beforeEach(async () => {
      expect((await put('owner', snapshot(), 0)).status).toBe(200);
    });

    it('an accountant can do ordinary work: clients, jobs, communications all save, and nothing needs an audit entry', async () => {
      const mark = await maxAuditId();
      const data = snapshot({
        clients: [{ id: 'c1', name: 'Acme Ltd', lifecycle: 'active', type: 'limited_company' }],
        jobs: [{ id: 'j1', clientId: 'c1', status: 'in_progress', waitingOn: 'accountant', dueDate: '2026-10-01' }],
        communications: [{ id: 'm1', clientId: 'c1', direction: 'outbound', channel: 'email', recipient: 'a@b.co', body: 'hi', sentAt: '2026-09-11T10:00:00.000Z', simulated: true }],
      });
      const res = await put('accountant', data, 1);
      expect(res.status).toBe(200);
      expect((await storedData()).jobs).toHaveLength(1);
      expect(await auditSince(mark)).toEqual([]);
      expect((await call('GET', '/api/practice-data', { as: 'accountant' })).status).toBe(200);
      expect((await call('GET', '/api/practice-data/history', { as: 'accountant' })).status).toBe(200);
    });

    it('practice settings (thresholds, name, timezone): an accountant or admin is refused and nothing is stored', async () => {
      for (const role of ['accountant', 'admin']) {
        const version = await storedVersion();
        const mark = await maxAuditId();
        const res = await put(role, snapshot({ practice: { id: 'prac_main', name: 'Test Practice', timezone: 'Europe/London', thresholds: { dueSoonDays: 90 } } }), version);
        expect(res.status, role).toBe(403);
        expect(res.body).toEqual({ error: 'forbidden', permission: 'practice.configure' });
        expect(await storedVersion()).toBe(version);
        expect((await storedData()).practice.thresholds).toBeUndefined();
        const [denial] = await auditSince(mark, 'authorization.denied');
        expect(denial.details).toMatchObject({ reason: 'practice_settings_changed', fields: ['thresholds'] });
      }
    });

    it('practice settings: a manager and an owner may, and it is recorded with the fields that changed', async () => {
      let mark = await maxAuditId();
      let res = await put('manager', snapshot({ practice: { id: 'prac_main', name: 'Test Practice', timezone: 'Europe/London', thresholds: { dueSoonDays: 21 } } }), 1);
      expect(res.status).toBe(200);
      let [event] = await auditSince(mark, 'practice.settings_changed');
      expect(event).toMatchObject({ actor_user_id: 'u_manager', actor_role: 'manager', outcome: 'success' });
      expect(event.details).toEqual({ fields: ['thresholds'] });

      mark = await maxAuditId();
      res = await put('owner', snapshot({ practice: { id: 'prac_main', name: 'Renamed Practice', timezone: 'Europe/London', thresholds: { dueSoonDays: 21 } } }), 2);
      expect(res.status).toBe(200);
      [event] = await auditSince(mark, 'practice.settings_changed');
      expect(event.details).toEqual({ fields: ['name'] });
    });

    it('team roster: only an owner may add, remove or re-role a member; a manager is refused', async () => {
      const promote = teamRows().map((u) => (u.id === 'u_accountant' ? { ...u, role: 'owner' } : u));
      for (const role of ['manager', 'accountant', 'admin']) {
        const mark = await maxAuditId();
        const res = await put(role, snapshot({ users: promote }), 1);
        expect(res.status, role).toBe(403);
        expect(res.body.permission).toBe('team.manage');
        expect((await storedData()).users.find((u) => u.id === 'u_accountant').role).toBe('accountant');
        const [denial] = await auditSince(mark, 'authorization.denied');
        expect(denial.details.roleChanges).toEqual([{ userId: 'u_accountant', from: 'accountant', to: 'owner' }]);
      }
      const removed = await put('manager', snapshot({ users: teamRows().filter((u) => u.id !== 'u_admin') }), 1);
      expect(removed.status).toBe(403);
      expect((await storedData()).users.map((u) => u.id)).toContain('u_admin');

      const mark = await maxAuditId();
      const ok = await put('owner', snapshot({ users: promote }), 1);
      expect(ok.status).toBe(200);
      const [event] = await auditSince(mark, 'practice.team_changed');
      expect(event.details.roleChanges).toEqual([{ userId: 'u_accountant', from: 'accountant', to: 'owner' }]);
      expect(event.actor_user_id).toBe('u_owner');
    });

    it("anyone may correct their own display name; nobody but an owner may rename someone else", async () => {
      const own = teamRows().map((u) => (u.id === 'u_accountant' ? { ...u, name: 'Alex Accountant', initials: 'AA' } : u));
      expect((await put('accountant', snapshot({ users: own }), 1)).status).toBe(200);

      const others = teamRows().map((u) => (u.id === 'u_owner' ? { ...u, name: 'Not The Owner' } : u.id === 'u_accountant' ? { ...u, name: 'Alex Accountant', initials: 'AA' } : u));
      const refused = await put('accountant', snapshot({ users: others }), 2);
      expect(refused.status).toBe(403);
      expect(refused.body.permission).toBe('team.manage');
    });

    it('a stale write is a 409 before it is anything else: authorisation is judged against the stored snapshot, not a stale one', async () => {
      const res = await put('accountant', snapshot({ practice: { id: 'prac_main', name: 'Changed', timezone: 'Europe/London' } }), 0);
      expect(res.status).toBe(409);
    });

    it('an unknown role holds nothing: it cannot even read the practice', async () => {
      expect((await call('GET', '/api/practice-data', { as: 'stranger' })).status).toBe(403);
      expect((await put('stranger', snapshot(), 1)).status).toBe(403);
      expect((await call('GET', '/api/practice-data/history', { as: 'stranger' })).status).toBe(403);
    });

    it('the very first save of a practice may come from any role, and is recorded', async () => {
      await resetPractice();
      const mark = await maxAuditId();
      expect((await put('accountant', snapshot(), 0)).status).toBe(200);
      const [event] = await auditSince(mark, 'snapshot.created');
      expect(event).toMatchObject({ actor_user_id: 'u_accountant', outcome: 'success' });
    });

    it('the audit trail itself is owner-only to read, and there is no way to write to it over HTTP', async () => {
      for (const role of ['manager', 'accountant', 'admin', 'stranger']) expect((await call('GET', '/api/practice-data/security-audit', { as: role })).status, role).toBe(403);
      const res = await call('GET', '/api/practice-data/security-audit?limit=5', { as: 'owner' });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.events)).toBe(true);
      expect(res.body.events.length).toBeLessThanOrEqual(5);
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const attempt = await call(method, '/api/practice-data/security-audit', { as: 'owner', body: { action: 'forged' } });
        expect([404, 405], method).toContain(attempt.status);
      }
      expect((await db.query("select count(*)::int as n from security_audit_log where action = 'forged'")).rows[0].n).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('snapshot validation over HTTP', () => {
    it('refuses a structurally plausible snapshot whose critical rows are wrong, and stores nothing', async () => {
      const bad = snapshot({ jobs: [{ id: 'j1', clientId: 'c1', status: 'not_a_status', waitingOn: 'client' }] });
      const res = await put('owner', bad, 0);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_shape', reason: 'jobs[0].status_invalid' });
      expect(await storedVersion()).toBe(0);
    });

    it('refuses a team member with an unknown role', async () => {
      const res = await put('owner', snapshot({ users: [{ id: 'u_x', name: 'X', role: 'root' }] }), 0);
      expect(res.body.reason).toBe('users[0].role_invalid');
    });
  });

  // ---------------------------------------------------------------------------
  describe('audit records: server-generated, append-only, and not forgeable through the snapshot', () => {
    it('refuses a snapshot whose new audit events pose as the server (source system / api), and records the attempt', async () => {
      expect((await put('owner', snapshot(), 0)).status).toBe(200);
      const mark = await maxAuditId();
      const forged = snapshot({ auditEvents: [auditEvent({ source: 'system', action: 'hmrc.disconnected' })] });
      const res = await put('accountant', forged, 1);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'audit_event_source_forbidden' });
      expect(await storedVersion()).toBe(1);
      const [event] = await auditSince(mark, 'snapshot.write_rejected');
      expect(event).toMatchObject({ actor_user_id: 'u_accountant', outcome: 'failure' });
      expect(event.details).toEqual({ reason: 'audit_event_source_forbidden' });
    });

    it('stores honest client audit events as-is — but they never appear in, or alter, the security audit log', async () => {
      expect((await put('owner', snapshot(), 0)).status).toBe(200);
      const mark = await maxAuditId();
      const claimed = auditEvent({ action: 'snapshot.restore', actorUserId: 'u_owner', entityId: 'v1' });
      const res = await put('owner', snapshot({ auditEvents: [claimed] }), 1);
      expect(res.status).toBe(200);
      expect((await storedData()).auditEvents).toEqual([claimed]);
      // A browser-written event named like a server one is just data in the snapshot.
      expect(await auditSince(mark, 'snapshot.restore')).toHaveLength(0);
      expect(await auditSince(mark)).toEqual([]);
    });

    it('does not let the snapshot erase evidence: wiping its audit events leaves the server trail untouched', async () => {
      expect((await put('owner', snapshot({ auditEvents: [auditEvent()] }), 0)).status).toBe(200);
      expect((await put('owner', snapshot({ auditEvents: [auditEvent()] }), 1)).status).toBe(200);
      expect((await call('POST', '/api/practice-data/restore', { as: 'owner', body: { version: 1, expectedVersion: 2 } })).status).toBe(200);
      const before = await db.query('select id, action from security_audit_log order by id');
      expect(before.rows.map((r) => r.action)).toContain('snapshot.restore');

      expect((await put('owner', snapshot({ auditEvents: [] }), await storedVersion())).status).toBe(200);
      expect((await storedData()).auditEvents).toEqual([]); // the client's own trail can be wiped...
      const after = await db.query('select id, action from security_audit_log order by id');
      expect(after.rows.slice(0, before.rows.length)).toEqual(before.rows); // ...the server's cannot
    });

    it('reports client audit events attributed to a different user in the authoritative trail, without refusing the save', async () => {
      expect((await put('owner', snapshot(), 0)).status).toBe(200);
      const mark = await maxAuditId();
      const res = await put('accountant', snapshot({ auditEvents: [auditEvent({ actorUserId: 'u_owner' })] }), 1);
      expect(res.status).toBe(200);
      const [event] = await auditSince(mark, 'snapshot.client_audit_actor_mismatch');
      expect(event).toMatchObject({ actor_user_id: 'u_accountant', outcome: 'failure' });
      expect(event.details).toEqual({ events: 1 });
    });

    it('is append-only at the database: UPDATE, DELETE and TRUNCATE are refused, for the application role too', async () => {
      await audit.recordSecurityEvent({ actor: { id: 'u_owner', username: 'owner', role: 'owner' }, action: 'test.append_only' });
      await expect(db.query("update security_audit_log set action = 'edited' where action = 'test.append_only'")).rejects.toMatchObject({ code: '42501' });
      await expect(db.query("delete from security_audit_log where action = 'test.append_only'")).rejects.toMatchObject({ code: '42501' });
      await expect(db.query('truncate security_audit_log')).rejects.toMatchObject({ code: '42501' });
      expect((await db.query("select count(*)::int as n from security_audit_log where action = 'test.append_only'")).rows[0].n).toBe(1);
    });

    it('takes the actor from the session, never from the request, and never stores secrets', async () => {
      await audit.recordSecurityEvent({
        req: { user: { id: 'u_owner', username: 'owner', role: 'owner' }, ip: '203.0.113.9', get: () => 'test-agent' },
        action: 'test.scrub',
        details: { keep: 'yes', password: 'hunter2', sessionToken: 'abc', body: 'Dear client…', nested: 'ok' },
      });
      const [row] = (await db.query("select * from security_audit_log where action = 'test.scrub'")).rows;
      expect(row).toMatchObject({ actor_user_id: 'u_owner', actor_role: 'owner', ip: '203.0.113.9', user_agent: 'test-agent' });
      expect(row.details).toEqual({ keep: 'yes', nested: 'ok' });
    });

    it('records sign-in successes and failures (username only), and reports the role\'s permissions to the browser', async () => {
      const mark = await maxAuditId();
      const bad = await call('POST', '/api/auth/login', { body: { username: 'accountant', password: 'wrong-password-123' } });
      expect(bad.status).toBe(401);
      const unknown = await call('POST', '/api/auth/login', { body: { username: 'nobody', password: 'x-password-123' } });
      expect(unknown.status).toBe(401);
      const good = await call('POST', '/api/auth/login', { body: { username: 'accountant', password: 'CorrectHorse-9' } });
      expect(good.status).toBe(200);
      expect(good.body.user.permissions).toEqual(expect.arrayContaining(['data.read', 'data.write', 'messages.send']));
      expect(good.body.user.permissions).not.toContain('snapshot.restore');

      const events = await auditSince(mark, 'auth.login');
      expect(events.map((e) => [e.outcome, e.actor_username])).toEqual([['failure', 'accountant'], ['failure', 'nobody'], ['success', 'accountant']]);
      expect(JSON.stringify(events)).not.toContain('wrong-password');
      expect(JSON.stringify(events)).not.toContain('CorrectHorse');

      const me = await call('GET', '/api/auth/me', { as: 'owner' });
      expect(me.body.user.permissions).toContain('snapshot.restore');
    });
  });
});
