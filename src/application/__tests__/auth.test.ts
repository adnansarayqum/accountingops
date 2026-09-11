import { afterEach, describe, expect, it, vi } from 'vitest';
import { changePassword, fetchCurrentUser, login, logout } from '../auth';

describe('fetchCurrentUser', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports not_configured on a 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect(await fetchCurrentUser()).toEqual({ status: 'not_configured' });
  });

  it('short-circuits on /health reporting database:false, without ever calling /api/auth/me', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url === '/health') return new Response(JSON.stringify({ status: 'ok', database: false }), { status: 200 });
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchCurrentUser()).toEqual({ status: 'not_configured' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('checks /api/auth/me once /health reports database:true', async () => {
    const user = { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: 'owner', mustChangePassword: false };
    const fetchSpy = vi.fn(async (url: string) => {
      if (url === '/health') return new Response(JSON.stringify({ status: 'ok', database: true }), { status: 200 });
      if (url === '/api/auth/me') return new Response(JSON.stringify({ user }), { status: 200 });
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchCurrentUser()).toEqual({ status: 'ok', user });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('reports not_configured when fetch itself throws (e.g. network unavailable)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await fetchCurrentUser()).toEqual({ status: 'not_configured' });
  });

  it('reports unavailable — not "no database" — when /health says the database is configured but unreachable', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url === '/health') return new Response(JSON.stringify({ status: 'degraded', database: true, databaseReachable: false }), { status: 200 });
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchCurrentUser()).toEqual({ status: 'unavailable' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable when /api/auth/me fails with a server error after /health reported a database', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/health') return new Response(JSON.stringify({ status: 'ok', database: true, databaseReachable: true }), { status: 200 });
        return new Response('', { status: 500 });
      }),
    );
    expect(await fetchCurrentUser()).toEqual({ status: 'unavailable' });
  });

  it('reports unavailable when /api/auth/me cannot be reached after /health reported a database', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/health') return new Response(JSON.stringify({ status: 'ok', database: true, databaseReachable: true }), { status: 200 });
        throw new Error('connection reset');
      }),
    );
    expect(await fetchCurrentUser()).toEqual({ status: 'unavailable' });
  });

  it('reports unauthenticated on a 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    expect(await fetchCurrentUser()).toEqual({ status: 'unauthenticated' });
  });

  it('reports the signed-in user on 200', async () => {
    const user = { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: 'owner', mustChangePassword: false };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user }), { status: 200 })));
    expect(await fetchCurrentUser()).toEqual({ status: 'ok', user });
  });
});

describe('login', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the user on success', async () => {
    const user = { id: 'u_farhan', username: 'farhan', name: 'Farhan', role: 'owner', mustChangePassword: true };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user }), { status: 200 })));
    expect(await login('farhan', 'temp-pass')).toEqual(user);
  });

  it('throws a friendly message on invalid credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 401 })));
    await expect(login('farhan', 'wrong')).rejects.toThrow('Incorrect username or password.');
  });

  it('explains a lockout rather than calling it a wrong password', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'too_many_attempts' }), { status: 429 })));
    await expect(login('farhan', 'wrong')).rejects.toThrow('Too many sign-in attempts. Wait 15 minutes and try again.');
  });
});

describe('changePassword', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(changePassword('old', 'new-password')).resolves.toBeUndefined();
  });

  it('throws a friendly message for a weak password', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'weak_password' }), { status: 400 })));
    await expect(changePassword('old', 'short')).rejects.toThrow('New password must be at least 8 characters.');
  });

  it('throws a friendly message for an incorrect current password', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_current_password' }), { status: 401 })));
    await expect(changePassword('wrong', 'new-password')).rejects.toThrow('Current password is incorrect.');
  });
});

describe('logout', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls the logout endpoint', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await logout();
    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
  });
});
