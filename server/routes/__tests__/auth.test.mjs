import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import authRouter from '../auth.mjs';
import practiceDataRouter from '../practiceData.mjs';
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

function extractCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : null;
}

describe.skipIf(!RUN)('auth + practice-data routers', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    await query('delete from practice_sessions');
    await query('delete from practice_users');
    await query('delete from practice_snapshots');
    const app = express();
    app.use('/api/auth', authRouter);
    app.use('/api/practice-data', practiceDataRouter);
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
      const wrongLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'adnan', password: 'nope' }),
      });
      expect(wrongLogin.status).toBe(401);
      expect(extractCookie(wrongLogin)).toBeNull();

      // Correct (seeded) temporary password logs in and starts a session.
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'adnan', password: 'TestTemp1234' }),
      });
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
      const loginOldPassword = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'adnan', password: 'TestTemp1234' }),
      });
      expect(loginOldPassword.status).toBe(401);
      const loginNewPassword = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'adnan', password: 'BrandNewPass1' }),
      });
      expect(loginNewPassword.status).toBe(200);
    });

    it('also seeds farhan and rayhan accounts', async () => {
      const { rows } = await query("select username from practice_users where username in ('adnan','farhan','rayhan') order by username");
      expect(rows.map((r) => r.username)).toEqual(['adnan', 'farhan', 'rayhan']);
    });
  });

  describe('practice data', () => {
    let cookie;

    beforeAll(async () => {
      const { hash, salt } = hashPassword('FixtureUserPass1');
      await query(
        'insert into practice_users (id, username, name, role, password_hash, password_salt, must_change_password) values ($1,$2,$3,$4,$5,$6,false)',
        ['u_practice_data_test', 'practice_data_test', 'Test User', 'owner', hash, salt],
      );
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'practice_data_test', password: 'FixtureUserPass1' }),
      });
      cookie = extractCookie(login);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await fetch(`${baseUrl}/api/practice-data`);
      expect(res.status).toBe(401);
    });

    it('returns 404 before anything has been saved', async () => {
      const res = await fetch(`${baseUrl}/api/practice-data`, { headers: { Cookie: cookie } });
      expect(res.status).toBe(404);
    });

    it('saves and reloads a practice data snapshot', async () => {
      const data = { practice: { id: 'prac_main', name: 'Test Practice' }, clients: [{ id: 'cl_1', name: 'Example Ltd' }] };
      const put = await fetch(`${baseUrl}/api/practice-data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ data }),
      });
      expect(put.status).toBe(200);

      const get = await fetch(`${baseUrl}/api/practice-data`, { headers: { Cookie: cookie } });
      expect(get.status).toBe(200);
      expect((await get.json()).data).toEqual(data);
    });

    it('overwrites the previous snapshot on a second save', async () => {
      const updated = { practice: { id: 'prac_main', name: 'Test Practice' }, clients: [] };
      await fetch(`${baseUrl}/api/practice-data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ data: updated }),
      });
      const get = await fetch(`${baseUrl}/api/practice-data`, { headers: { Cookie: cookie } });
      expect((await get.json()).data.clients).toEqual([]);
    });

    it('rejects a body that is not a plain object', async () => {
      const res = await fetch(`${baseUrl}/api/practice-data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ data: ['not', 'an', 'object'] }),
      });
      expect(res.status).toBe(400);
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
