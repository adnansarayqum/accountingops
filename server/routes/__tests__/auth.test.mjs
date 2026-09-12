import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import authRouter, { resetLoginLimits } from '../auth.mjs';
import practiceDataRouter from '../practiceData.mjs';
import companiesHouseRouter from '../companiesHouse.mjs';
import { isDatabaseConfigured, query } from '../../lib/db.mjs';
import { hashPassword } from '../../lib/passwords.mjs';

/**
 * Requires a real local Postgres (DATABASE_URL set) — skipped otherwise.
 * Auth and practice-data tests share one file (and one test server, mounted
 * the same way production mounts both routers) so they run sequentially
 * against the same live database — running them as separate files let
 * Vitest execute them in parallel processes, racing on the same tables.
 */
const RUN = isDatabaseConfigured();
process.env.ADNAN_TEMP_PASSWORD = process.env.ADNAN_TEMP_PASSWORD ?? 'TestTemp1234';

const EVERY_COLLECTION = [
  'users', 'clients', 'contacts', 'identifiers', 'people', 'personRoles', 'subscriptions', 'obligations', 'jobs',
  'requestItems', 'documents', 'communications', 'reminderSequences', 'approvals', 'filings', 'activities',
  'auditEvents', 'inboxItems', 'notifications', 'onboardingCases', 'mtdReadiness',
];

/** A structurally valid PracticeData snapshot, the way the client sends one. */
function snapshot(overrides = {}) {
  const data = { practice: { id: 'prac_main', name: 'Test Practice' } };
  for (const key of EVERY_COLLECTION) data[key] = [];
  return { ...data, ...overrides };
}

function extractCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : null;
}

function postLogin(baseUrl, username, password) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

describe.skipIf(!RUN)('auth + practice-data routers', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    await query('delete from practice_sessions');
    await query('delete from practice_users');
    await query('delete from practice_snapshots');
    await query('delete from practice_snapshot_history').catch(() => {});
    resetLoginLimits();
    const app = express();
    app.use('/api/auth', authRouter);
    app.use('/api/practice-data', practiceDataRouter);
    app.use('/api/companies-house', companiesHouseRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  describe('auth', () => {
    it('walks the full session lifecycle: seed, wrong password, login, /me, forced change, logout', async () => {
      // Not authenticated yet.
      const meBefore = await fetch(`${baseUrl}/api/auth/me`, { redirect: 'manual' });
      expect(meBefore.status).toBe(401);

      // Wrong password is rejected without creating a session.
      const wrongLogin = await postLogin(baseUrl, 'adnan', 'nope');
      expect(wrongLogin.status).toBe(401);
      expect(extractCookie(wrongLogin)).toBeNull();

      // Correct (seeded) temporary password logs in and starts a session.
      const login = await postLogin(baseUrl, 'adnan', 'TestTemp1234');
      expect(login.status).toBe(200);
      const cookie = extractCookie(login);
      expect(cookie).toBeTruthy();
      const loginBody = await login.json();
      expect(loginBody.user).toMatchObject({ id: 'u_adnan', username: 'adnan', mustChangePassword: true });

      // The cookie authenticates subsequent requests.
      const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
      expect(me.status).toBe(200);
      expect((await me.json()).user.username).toBe('adnan');

      // Wrong current password is rejected when changing password.
      const badChange = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ currentPassword: 'nope', newPassword: 'BrandNewPass1' }),
      });
      expect(badChange.status).toBe(401);

      // A password under 8 characters is rejected outright.
      const weakChange = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ currentPassword: 'TestTemp1234', newPassword: 'short' }),
      });
      expect(weakChange.status).toBe(400);

      // Correct current password + valid new password succeeds.
      const goodChange = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ currentPassword: 'TestTemp1234', newPassword: 'BrandNewPass1' }),
      });
      expect(goodChange.status).toBe(200);

      // must_change_password is now cleared.
      const meAfterChange = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
      expect((await meAfterChange.json()).user.mustChangePassword).toBe(false);

      // Logging out invalidates the session.
      const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
      expect(logout.status).toBe(200);
      const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
      expect(meAfterLogout.status).toBe(401);

      // The old password no longer works; the new one does.
      const loginOldPassword = await postLogin(baseUrl, 'adnan', 'TestTemp1234');
      expect(loginOldPassword.status).toBe(401);
      const loginNewPassword = await postLogin(baseUrl, 'adnan', 'BrandNewPass1');
      expect(loginNewPassword.status).toBe(200);
    });

    it('also seeds farhan and rayhan accounts', async () => {
      const { rows } = await query("select username from practice_users where username in ('adnan','farhan','rayhan') order by username");
      expect(rows.map((r) => r.username)).toEqual(['adnan', 'farhan', 'rayhan']);
    });

    it('answers a login for an unknown username exactly like a wrong password', async () => {
      const res = await postLogin(baseUrl, 'nobody-here', 'whatever');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_credentials' });
      expect(extractCookie(res)).toBeNull();
    });

    it('locks a username out after ten attempts in a window, regardless of the address', async () => {
      resetLoginLimits();
      for (let i = 0; i < 10; i += 1) {
        expect((await postLogin(baseUrl, 'farhan', `wrong-${i}`)).status).toBe(401);
      }
      const eleventh = await postLogin(baseUrl, 'farhan', 'wrong-10');
      expect(eleventh.status).toBe(429);
      expect(await eleventh.json()).toEqual({ error: 'too_many_attempts' });
      expect(eleventh.headers.get('retry-after')).toMatch(/^\d+$/);
      // Case and whitespace don't buy extra attempts.
      expect((await postLogin(baseUrl, '  Farhan ', 'wrong-11')).status).toBe(429);
      // ...and other accounts are unaffected.
      expect((await postLogin(baseUrl, 'adnan', 'BrandNewPass1')).status).toBe(200);
      resetLoginLimits();
    });
  });

  describe('practice data', () => {
    let cookie;

    beforeAll(async () => {
      const { hash, salt } = await hashPassword('FixtureUserPass1');
      await query(
        'insert into practice_users (id, username, name, role, password_hash, password_salt, must_change_password) values ($1,$2,$3,$4,$5,$6,false)',
        ['u_practice_data_test', 'practice_data_test', 'Test User', 'owner', hash, salt],
      );
      const login = await postLogin(baseUrl, 'practice_data_test', 'FixtureUserPass1');
      cookie = extractCookie(login);
    });

    let version = 0;

    /** PUT with the version this test last saw, unless the body names one itself. */
    async function put(body, headers = {}) {
      const payload = typeof body === 'string' ? body : JSON.stringify({ expectedVersion: version, ...body });
      const res = await fetch(`${baseUrl}/api/practice-data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
        body: payload,
      });
      if (res.ok) version = (await res.clone().json()).version;
      return res;
    }

    const get = () => fetch(`${baseUrl}/api/practice-data`, { headers: { Cookie: cookie } });

    it('rejects an unauthenticated request', async () => {
      const res = await fetch(`${baseUrl}/api/practice-data`);
      expect(res.status).toBe(401);
    });

    it('rejects an unauthenticated PUT before reading its body', async () => {
      const res = await fetch(`${baseUrl}/api/practice-data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: snapshot() }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 404 before anything has been saved', async () => {
      const res = await fetch(`${baseUrl}/api/practice-data`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(404);
    });

    it('saves and reloads a practice data snapshot, numbering it version 1', async () => {
      const data = snapshot({ clients: [{ id: 'cl_1', name: 'Example Ltd' }] });
      const res = await put({ data });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, version: 1 });

      const loaded = await get();
      expect(loaded.status).toBe(200);
      const body = await loaded.json();
      expect(body.data).toEqual(data);
      expect(body.version).toBe(1);
    });

    it('overwrites the previous snapshot on a second save, moving the version on', async () => {
      const res = await put({ data: snapshot() });
      expect((await res.json()).version).toBe(2);
      const body = await (await get()).json();
      expect(body.data.clients).toEqual([]);
      expect(body.version).toBe(2);
    });

    it('refuses a save built on a version that has since been overwritten, and hands back what is stored', async () => {
      const stored = await (await get()).json();
      const stale = await put({ data: snapshot({ clients: [{ id: 'cl_stale', name: 'Stale Ltd' }] }), expectedVersion: stored.version - 1 });
      expect(stale.status).toBe(409);
      const body = await stale.json();
      expect(body.error).toBe('version_conflict');
      expect(body.version).toBe(stored.version);
      expect(body.data).toEqual(stored.data);
      // Nothing changed.
      expect(await (await get()).json()).toEqual(stored);
    });

    it('requires the caller to say which version it was working from', async () => {
      const res = await put({ data: snapshot(), expectedVersion: undefined });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'expected_version_required' });
      const negative = await put({ data: snapshot(), expectedVersion: -1 });
      expect(negative.status).toBe(400);
    });

    it('keeps every version in the history, newest first, and can bring one back as a new version', async () => {
      const history = await (await fetch(`${baseUrl}/api/practice-data/history`, { headers: { Cookie: cookie } })).json();
      expect(history.current).toBe(version);
      expect(history.versions.map((v) => v.version)).toEqual([2, 1]);
      expect(history.versions[0].savedBy).toBe('u_practice_data_test');

      // Version 1 had Example Ltd; the current one has no clients.
      const restore = await fetch(`${baseUrl}/api/practice-data/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ version: 1, expectedVersion: history.current }),
      });
      expect(restore.status).toBe(200);
      const restored = await restore.json();
      expect(restored.version).toBe(3);
      expect(restored.data.clients).toEqual([{ id: 'cl_1', name: 'Example Ltd' }]);
      version = restored.version;

      const now = await (await get()).json();
      expect(now.version).toBe(3);
      expect(now.data.clients).toEqual([{ id: 'cl_1', name: 'Example Ltd' }]);
      const after = await (await fetch(`${baseUrl}/api/practice-data/history`, { headers: { Cookie: cookie } })).json();
      expect(after.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    });

    it('refuses a restore over a version the caller has not seen, and an unknown version', async () => {
      const stale = await fetch(`${baseUrl}/api/practice-data/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ version: 1, expectedVersion: version - 1 }),
      });
      expect(stale.status).toBe(409);
      const missing = await fetch(`${baseUrl}/api/practice-data/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ version: 999, expectedVersion: version }),
      });
      expect(missing.status).toBe(404);
    });

    it('refuses to overwrite the snapshot with something that is not one', async () => {
      const before = await (await get()).json();
      for (const body of [{ data: ['not', 'an', 'object'] }, { data: {} }, {}, { data: null }, { data: snapshot({ clients: 'not-an-array' }) }]) {
        const res = await put(body);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('invalid_shape');
      }
      const after = await (await get()).json();
      expect(after).toEqual(before);
    });

    it('reports malformed JSON as a 400, not a server error', async () => {
      const res = await put('{"data": ');
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_json' });
    });

    it('refuses a body over the size limit with 413', async () => {
      const data = snapshot({ notifications: [{ id: 'n_1', padding: 'x'.repeat(2 * 1024 * 1024 + 1024) }] });
      const res = await put({ data });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'payload_too_large' });
    });
  });

  describe('companies house proxy with logins configured', () => {
    it('refuses lookups without a session, but still answers /status', async () => {
      const status = await fetch(`${baseUrl}/api/companies-house/status`);
      expect(status.status).toBe(200);
      for (const path of ['/search?q=harbour', '/company/14829301', '/company/14829301/people']) {
        const res = await fetch(`${baseUrl}/api/companies-house${path}`);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'not_authenticated' });
      }
    });

    it('lets a signed-in user look companies up', async () => {
      const login = await postLogin(baseUrl, 'practice_data_test', 'FixtureUserPass1');
      const cookie = extractCookie(login);
      process.env.COMPANIES_HOUSE_API_KEY = 'test-key';
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
      try {
        // The stubbed fetch must not intercept our own request to the test server.
        const http = await import('node:http');
        const status = await new Promise((resolve, reject) => {
          http.get(`${baseUrl}/api/companies-house/search?q=harbour`, { headers: { Cookie: cookie } }, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          }).on('error', reject);
        });
        expect(status).toBe(200);
      } finally {
        vi.unstubAllGlobals();
        delete process.env.COMPANIES_HOUSE_API_KEY;
      }
    });
  });
});

describe('auth + practice-data routers without a configured database', () => {
  it('both return 503 rather than attempting to connect', async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const app = express();
      app.use('/api/auth', authRouter);
      app.use('/api/practice-data', practiceDataRouter);
      const server = app.listen(0);
      await new Promise((resolve) => server.once('listening', resolve));
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      expect((await fetch(`${baseUrl}/api/auth/me`)).status).toBe(503);
      expect((await fetch(`${baseUrl}/api/practice-data`)).status).toBe(503);
      await new Promise((resolve) => server.close(resolve));
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original;
    }
  });
});
