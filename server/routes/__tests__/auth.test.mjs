import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import authRouter, { resetLoginLimits } from '../auth.mjs';
import practiceDataRouter from '../practiceData.mjs';
import companiesHouseRouter from '../companiesHouse.mjs';
import messagesRouter from '../messages.mjs';
import { isDatabaseConfigured, query } from '../../lib/db.mjs';
import { hashPassword, needsRehash } from '../../lib/passwords.mjs';
import { ensureSeedUsers } from '../../lib/bootstrapUsers.mjs';

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
    // Accounts are seeded once at boot in production now, not per request
    // (see lib/bootstrapUsers.mjs), so this suite seeds explicitly rather
    // than relying on the router to do it on the next request.
    await ensureSeedUsers();
    const app = express();
    app.use('/api/auth', authRouter);
    app.use('/api/practice-data', practiceDataRouter);
    app.use('/api/companies-house', companiesHouseRouter);
    app.use('/api/messages', messagesRouter);
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

  describe('messaging with logins configured', () => {
    it('refuses to send without a session, but still answers /status', async () => {
      const status = await fetch(`${baseUrl}/api/messages/status`);
      expect(status.status).toBe(200);
      const send = await fetch(`${baseUrl}/api/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'email', to: 'a@b.c', subject: 'S', body: 'B', idempotencyKey: 'send_unauth_0001' }),
      });
      expect(send.status).toBe(401);
    });

    it('lets a signed-in user send (simulated here)', async () => {
      const login = await postLogin(baseUrl, 'practice_data_test', 'FixtureUserPass1');
      const cookie = extractCookie(login);
      const send = await fetch(`${baseUrl}/api/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ channel: 'email', to: 'a@b.c', subject: 'S', body: 'B', idempotencyKey: 'send_signed_in_01' }),
      });
      expect(send.status).toBe(200);
      expect((await send.json()).status).toBe('simulated');
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

  describe('must-change-password gate', () => {
    let cookie;

    beforeAll(async () => {
      const { hash, salt } = await hashPassword('MustChangeTemp1');
      await query(
        'insert into practice_users (id, username, name, role, password_hash, password_salt, must_change_password) values ($1,$2,$3,$4,$5,$6,true)',
        ['u_must_change_test', 'must_change_test', 'Must Change Test', 'owner', hash, salt],
      );
      const login = await postLogin(baseUrl, 'must_change_test', 'MustChangeTemp1');
      cookie = extractCookie(login);
    });

    it('lets /me through, but blocks every data route until the password is changed', async () => {
      const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
      expect(me.status).toBe(200);
      expect((await me.json()).user.mustChangePassword).toBe(true);

      const practiceData = await fetch(`${baseUrl}/api/practice-data`, { headers: { Cookie: cookie } });
      expect(practiceData.status).toBe(403);
      expect(await practiceData.json()).toEqual({ error: 'password_change_required' });

      const send = await fetch(`${baseUrl}/api/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ channel: 'email', to: 'a@b.c', subject: 'S', body: 'B', idempotencyKey: 'send_must_change_0001' }),
      });
      expect(send.status).toBe(403);
      expect(await send.json()).toEqual({ error: 'password_change_required' });

      const chSearch = await fetch(`${baseUrl}/api/companies-house/search?q=harbour`, { headers: { Cookie: cookie } });
      expect(chSearch.status).toBe(403);
    });

    it('unblocks every data route the moment the password is changed', async () => {
      const change = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ currentPassword: 'MustChangeTemp1', newPassword: 'MustChangeNew1' }),
      });
      expect(change.status).toBe(200);

      const practiceData = await fetch(`${baseUrl}/api/practice-data`, { headers: { Cookie: cookie } });
      expect(practiceData.status).not.toBe(403);
    });
  });

  describe('session revocation', () => {
    it('changing the password signs out every other session for the account, but keeps the one making the change', async () => {
      const { hash, salt } = await hashPassword('RevokeMePass1');
      await query(
        'insert into practice_users (id, username, name, role, password_hash, password_salt, must_change_password) values ($1,$2,$3,$4,$5,$6,false)',
        ['u_revoke_test', 'revoke_test', 'Revoke Test', 'owner', hash, salt],
      );
      const loginA = await postLogin(baseUrl, 'revoke_test', 'RevokeMePass1');
      const cookieA = extractCookie(loginA);
      const loginB = await postLogin(baseUrl, 'revoke_test', 'RevokeMePass1');
      const cookieB = extractCookie(loginB);
      expect(cookieA).not.toBe(cookieB);

      // Both sessions work before the change.
      expect((await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieA } })).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieB } })).status).toBe(200);

      const change = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({ currentPassword: 'RevokeMePass1', newPassword: 'RevokeMePass2' }),
      });
      expect(change.status).toBe(200);

      // The session that made the change is still signed in; the other one is not.
      expect((await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieA } })).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieB } })).status).toBe(401);
    });

    it('sign out everywhere revokes every session for the account, including the one making the request', async () => {
      const { hash, salt } = await hashPassword('EverywherePass1');
      await query(
        'insert into practice_users (id, username, name, role, password_hash, password_salt, must_change_password) values ($1,$2,$3,$4,$5,$6,false)',
        ['u_everywhere_test', 'everywhere_test', 'Everywhere Test', 'owner', hash, salt],
      );
      const loginA = await postLogin(baseUrl, 'everywhere_test', 'EverywherePass1');
      const cookieA = extractCookie(loginA);
      const loginB = await postLogin(baseUrl, 'everywhere_test', 'EverywherePass1');
      const cookieB = extractCookie(loginB);

      const everywhere = await fetch(`${baseUrl}/api/auth/logout-everywhere`, { method: 'POST', headers: { Cookie: cookieA } });
      expect(everywhere.status).toBe(200);

      expect((await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieA } })).status).toBe(401);
      expect((await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieB } })).status).toBe(401);
    });

    it('refuses sign out everywhere without a session', async () => {
      const res = await fetch(`${baseUrl}/api/auth/logout-everywhere`, { method: 'POST' });
      expect(res.status).toBe(401);
    });
  });

  describe('password hash upgrade on sign-in', () => {
    it('signs in against a legacy plain-hex hash and re-stores it at the current cost', async () => {
      // Exactly how every account was stored before hashes carried their
      // own parameters: scryptSync(password, salt, 64) with Node's defaults.
      const { scryptSync } = await import('node:crypto');
      const salt = 'fedcba9876543210fedcba9876543210';
      const legacyHash = scryptSync('LegacyPass1', salt, 64).toString('hex');
      await query(
        'insert into practice_users (id, username, name, role, password_hash, password_salt, must_change_password) values ($1,$2,$3,$4,$5,$6,false)',
        ['u_legacy_test', 'legacy_test', 'Legacy Test', 'owner', legacyHash, salt],
      );

      // A wrong password neither signs in nor touches the stored hash.
      expect((await postLogin(baseUrl, 'legacy_test', 'LegacyPass2')).status).toBe(401);
      const { rows: untouched } = await query('select password_hash, password_salt from practice_users where id = $1', ['u_legacy_test']);
      expect(untouched[0]).toEqual({ password_hash: legacyHash, password_salt: salt });

      const login = await postLogin(baseUrl, 'legacy_test', 'LegacyPass1');
      expect(login.status).toBe(200);
      const { rows: upgraded } = await query('select password_hash, password_salt from practice_users where id = $1', ['u_legacy_test']);
      expect(upgraded[0].password_hash).toMatch(/^scrypt\$32768\$8\$3\$/);
      expect(upgraded[0].password_hash).not.toBe(legacyHash);
      expect(upgraded[0].password_salt).not.toBe(salt);
      expect(needsRehash(upgraded[0].password_hash, upgraded[0].password_salt)).toBe(false);

      // The same password still signs in against the upgraded hash, and a
      // second sign-in leaves it alone.
      expect((await postLogin(baseUrl, 'legacy_test', 'LegacyPass1')).status).toBe(200);
      const { rows: stable } = await query('select password_hash from practice_users where id = $1', ['u_legacy_test']);
      expect(stable[0].password_hash).toBe(upgraded[0].password_hash);
      expect((await postLogin(baseUrl, 'legacy_test', 'LegacyPass2')).status).toBe(401);
    });

    it('re-stores a hash made with weaker parameters, and changing the password uses the current ones', async () => {
      const weaker = await hashPassword('WeakerPass1', { N: 1024, r: 8, p: 1 });
      await query(
        'insert into practice_users (id, username, name, role, password_hash, password_salt, must_change_password) values ($1,$2,$3,$4,$5,$6,false)',
        ['u_weaker_test', 'weaker_test', 'Weaker Test', 'owner', weaker.hash, weaker.salt],
      );
      const login = await postLogin(baseUrl, 'weaker_test', 'WeakerPass1');
      expect(login.status).toBe(200);
      const { rows: upgraded } = await query('select password_hash from practice_users where id = $1', ['u_weaker_test']);
      expect(upgraded[0].password_hash).toMatch(/^scrypt\$32768\$8\$3\$/);

      const change = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: extractCookie(login) },
        body: JSON.stringify({ currentPassword: 'WeakerPass1', newPassword: 'WeakerPass2' }),
      });
      expect(change.status).toBe(200);
      const { rows: changed } = await query('select password_hash from practice_users where id = $1', ['u_weaker_test']);
      expect(changed[0].password_hash).toMatch(/^scrypt\$32768\$8\$3\$/);
      expect(changed[0].password_hash).not.toBe(upgraded[0].password_hash);
      expect((await postLogin(baseUrl, 'weaker_test', 'WeakerPass2')).status).toBe(200);
      expect((await postLogin(baseUrl, 'weaker_test', 'WeakerPass1')).status).toBe(401);
    });
  });
});

/**
 * ensureSeedUsers() wipes and re-seeds practice_users/practice_sessions
 * wholesale, so this runs as its own top-level describe — in this same
 * file, not a separate one — for the same reason the file header gives for
 * combining auth and practice-data: a separate file races on the same
 * tables against whichever other test file Vitest happens to run
 * concurrently. Sequential within one file avoids that.
 */
describe.skipIf(!RUN)('ensureSeedUsers logging', () => {
  const ENV_KEYS = ['ADNAN_TEMP_PASSWORD', 'FARHAN_TEMP_PASSWORD', 'RAYHAN_TEMP_PASSWORD', 'LOG_GENERATED_PASSWORDS'];
  const original = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

  beforeEach(async () => {
    await query('delete from practice_sessions');
    await query('delete from practice_users');
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it('does not log the generated password by default, and says where to look instead', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await ensureSeedUsers();
    const lines = logSpy.mock.calls.map((c) => JSON.parse(c[0]));
    const adnanLine = lines.find((l) => l.message.includes('"adnan"'));
    expect(adnanLine.source).toBe('generated');
    expect(adnanLine.temporaryPassword).toBeUndefined();
    expect(adnanLine.message).toContain('ADNAN_TEMP_PASSWORD');
    expect(adnanLine.message).toContain('LOG_GENERATED_PASSWORDS');
    logSpy.mockRestore();
  });

  it('logs the actual temporary password only when LOG_GENERATED_PASSWORDS=1', async () => {
    process.env.LOG_GENERATED_PASSWORDS = '1';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await ensureSeedUsers();
    const lines = logSpy.mock.calls.map((c) => JSON.parse(c[0]));
    const adnanLine = lines.find((l) => l.message.includes('"adnan"'));
    expect(typeof adnanLine.temporaryPassword).toBe('string');
    expect(adnanLine.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    logSpy.mockRestore();
  });

  it('uses the env var password when set, and never logs it', async () => {
    process.env.ADNAN_TEMP_PASSWORD = 'FromEnvTemp123';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await ensureSeedUsers();
    const lines = logSpy.mock.calls.map((c) => JSON.parse(c[0]));
    const adnanLine = lines.find((l) => l.message.includes('"adnan"'));
    expect(adnanLine.source).toBe('env');
    expect(adnanLine.temporaryPassword).toBeUndefined();
    expect(JSON.stringify(lines)).not.toContain('FromEnvTemp123');
    logSpy.mockRestore();
  });

  it('is idempotent: an already-seeded account is left untouched and not logged again', async () => {
    await ensureSeedUsers();
    const { rows: before } = await query('select password_hash from practice_users where username = $1', ['adnan']);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await ensureSeedUsers();
    expect(logSpy).not.toHaveBeenCalled();
    const { rows: after } = await query('select password_hash from practice_users where username = $1', ['adnan']);
    expect(after[0].password_hash).toBe(before[0].password_hash);
    logSpy.mockRestore();
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
