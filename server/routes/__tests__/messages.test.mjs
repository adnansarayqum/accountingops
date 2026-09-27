import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

/**
 * The route logic, exercised over a real local HTTP server (like the
 * Companies House proxy suite) so the tests prove no provider token ever
 * appears in a response. Requests use node:http so that stubbing global fetch
 * (to intercept the route's OWN call to Postmark) never intercepts the
 * test's request to its own server.
 *
 * Nothing here needs PostgreSQL: the two things the route gets from the
 * database in authenticated mode — who is signed in (requireAuth) and the
 * idempotency claim store — are replaced by small fakes with the same
 * contract. The real claim store, and the real thing under concurrency, are
 * exercised against PostgreSQL in productionBlockers.db.test.mjs.
 */
const fake = vi.hoisted(() => ({
  claims: new Map(),
  audits: [],
}));

vi.mock('../auth.mjs', () => ({
  requireAuth: (req, res, next) => {
    const role = req.get('x-test-role');
    if (!role) return res.status(401).json({ error: 'not_authenticated' });
    req.user = { id: req.get('x-test-user') ?? 'u_test', username: 'tester', role };
    next();
  },
}));

vi.mock('../../lib/securityAudit.mjs', () => ({
  recordSecurityEvent: vi.fn(async (event) => {
    fake.audits.push(event);
  }),
}));

vi.mock('../../lib/emailClaims.mjs', async () => {
  const actual = await vi.importActual('../../lib/emailClaims.mjs');
  const id = (scope, key) => `${scope}|${key}`;
  return {
    ...actual,
    claimSend: vi.fn(async ({ scope, key, requestHash }) => {
      const row = fake.claims.get(id(scope, key));
      if (!row) {
        fake.claims.set(id(scope, key), { requestHash, status: 'pending' });
        return { state: 'claimed' };
      }
      if (row.requestHash !== requestHash) return { state: 'mismatch' };
      if (row.status === 'sent') return { state: 'replay', result: row.result };
      if (row.status === 'unknown') return { state: 'unknown' };
      return { state: 'in_progress' };
    }),
    completeSend: vi.fn(async ({ scope, key, result }) => {
      Object.assign(fake.claims.get(id(scope, key)), { status: 'sent', result });
    }),
    releaseSend: vi.fn(async ({ scope, key }) => {
      fake.claims.delete(id(scope, key));
    }),
    markUnknown: vi.fn(async ({ scope, key }) => {
      const row = fake.claims.get(id(scope, key));
      if (row) row.status = 'unknown';
    }),
  };
});

const { default: router, resetIdempotency, sendLimiter } = await import('../messages.mjs');
const { postmarkProvider } = await import('../../lib/messaging/postmark.mjs');
const { emailProvider } = await import('../../lib/messaging/index.mjs');

let server;
let baseUrl;
const ENV_KEYS = ['MESSAGING_EMAIL_PROVIDER', 'POSTMARK_SERVER_TOKEN', 'MESSAGING_FROM_EMAIL', 'MESSAGING_FROM_NAME', 'DATABASE_URL'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${baseUrl}${path}`, { method, headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : {} }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const validSend = (overrides = {}) => ({ channel: 'email', to: 'client@example.com', subject: 'Documents still needed', body: 'Hi Dave, …', idempotencyKey: 'send_test_0001', ...overrides });
const asRole = (role, user = 'u_test') => ({ 'x-test-role': role, 'x-test-user': user });

/** Postmark configured and reachable — and a fetch spy that says what it was called with. */
function configurePostmark(fetchImpl) {
  process.env.MESSAGING_EMAIL_PROVIDER = 'postmark';
  process.env.POSTMARK_SERVER_TOKEN = 'pm-secret-token';
  process.env.MESSAGING_FROM_EMAIL = 'reminders@practice.example';
  const spy = vi.fn(fetchImpl ?? (async () => new Response(JSON.stringify({ MessageID: 'pm-msg-123' }), { status: 200 })));
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Puts the process in authenticated, server-backed mode. requireAuth and the claim store are faked above, so no connection is ever opened. */
function serverBackedMode() {
  process.env.DATABASE_URL = 'postgres://fake-for-route-tests/none';
}
function browserOnlyMode() {
  delete process.env.DATABASE_URL;
}

beforeAll(async () => {
  const app = express();
  app.use('/api/messages', router);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  browserOnlyMode();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetIdempotency();
  sendLimiter.reset();
  fake.claims.clear();
  fake.audits.length = 0;
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /status', () => {
  it('reports simulated email by default, WhatsApp as click-to-chat, SMS simulated', async () => {
    delete process.env.MESSAGING_EMAIL_PROVIDER;
    const { body } = await request('GET', '/api/messages/status');
    expect(body).toEqual({ email: { provider: 'simulated', configured: true, from: null }, whatsapp: { mode: 'click_to_chat' }, sms: { provider: 'simulated', configured: false } });
  });

  it('reports Postmark as not configured until token and from-address are both set, and never echoes the token', async () => {
    serverBackedMode();
    process.env.MESSAGING_EMAIL_PROVIDER = 'postmark';
    process.env.POSTMARK_SERVER_TOKEN = 'pm-secret-token';
    delete process.env.MESSAGING_FROM_EMAIL;
    let res = await request('GET', '/api/messages/status');
    expect(res.body.email).toEqual({ provider: 'postmark', configured: false, from: null });

    process.env.MESSAGING_FROM_EMAIL = 'reminders@practice.example';
    process.env.MESSAGING_FROM_NAME = 'Farhan & Raihan';
    res = await request('GET', '/api/messages/status');
    expect(res.body.email).toEqual({ provider: 'postmark', configured: true, from: 'Farhan & Raihan <reminders@practice.example>' });
    expect(JSON.stringify(res.body)).not.toContain('pm-secret-token');
  });

  it('flags an unknown provider name instead of silently simulating', async () => {
    process.env.MESSAGING_EMAIL_PROVIDER = 'sendgrid';
    const { body } = await request('GET', '/api/messages/status');
    expect(body.email.provider).toBe('unknown');
    expect(body.email.configured).toBe(false);
  });

  it('reports a real provider as NOT usable without authenticated server-backed mode', async () => {
    browserOnlyMode();
    process.env.MESSAGING_EMAIL_PROVIDER = 'postmark';
    process.env.POSTMARK_SERVER_TOKEN = 'pm-secret-token';
    process.env.MESSAGING_FROM_EMAIL = 'reminders@practice.example';
    const { body } = await request('GET', '/api/messages/status');
    expect(body.email).toEqual({ provider: 'postmark', configured: false, from: null, error: 'authenticated_mode_required' });
    expect(JSON.stringify(body)).not.toContain('pm-secret-token');
  });
});

describe('POST /send — browser-only mode (no database, no sign-in)', () => {
  it('in simulated mode records a send without touching the network', async () => {
    delete process.env.MESSAGING_EMAIL_PROVIDER;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { status, body } = await request('POST', '/api/messages/send', validSend());
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.providerName).toBe('simulated');
    expect(body.status).toBe('simulated');
    expect(body.providerMessageId).toMatch(/^sim_/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers a repeated simulated send from memory, unchanged', async () => {
    const first = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_local_dbl_1' }));
    const second = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_local_dbl_1' }));
    expect(second.body).toEqual({ ...first.body, deduplicated: true });
  });

  it('FAILS CLOSED: a configured Postmark is refused — nothing is sent, nothing is simulated, no token is echoed', async () => {
    const fetchSpy = configurePostmark();
    const { status, body } = await request('POST', '/api/messages/send', validSend());
    expect(status).toBe(503);
    expect(body).toEqual({ error: 'authenticated_mode_required' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('pm-secret-token');
    expect(fake.claims.size).toBe(0);
  });

  it('stays closed however the request is phrased — a forged auth header or an unauthenticated retry does not open it', async () => {
    const fetchSpy = configurePostmark();
    for (const headers of [{}, asRole('owner'), { Cookie: 'session=anything', Authorization: 'Bearer nope' }]) {
      const { status, body } = await request('POST', '/api/messages/send', validSend({ idempotencyKey: `send_closed_${Math.random().toString(36).slice(2)}` }), headers);
      expect(status).toBe(503);
      expect(body.error).toBe('authenticated_mode_required');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('closes the provider itself, not only the route: the adapter and the selector both refuse without a database', async () => {
    const fetchSpy = configurePostmark();
    expect(() => emailProvider()).toThrow(expect.objectContaining({ status: 503, code: 'authenticated_mode_required' }));
    await expect(postmarkProvider.send({ to: 'a@b.co', subject: 'S', body: 'B' })).rejects.toMatchObject({ status: 503, code: 'authenticated_mode_required' });
    expect(fetchSpy).not.toHaveBeenCalled();
    // ...and the simulated provider is still available.
    process.env.MESSAGING_EMAIL_PROVIDER = 'simulated';
    expect(emailProvider().name).toBe('simulated');
  });

  it('validates the recipient, subject, body, channel and idempotency key before sending anything', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const [overrides, error] of [
      [{ to: 'not-an-email' }, 'invalid_recipient'],
      [{ subject: '' }, 'invalid_subject'],
      [{ subject: 'x'.repeat(301) }, 'invalid_subject'],
      [{ body: '   ' }, 'invalid_body'],
      [{ channel: 'whatsapp' }, 'channel_not_supported'],
      [{ channel: 'sms' }, 'channel_not_supported'],
      [{ idempotencyKey: 'short' }, 'idempotency_key_required'],
    ]) {
      const { status, body } = await request('POST', '/api/messages/send', validSend(overrides));
      expect(status, JSON.stringify(overrides)).toBe(400);
      expect(body.error).toBe(error);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('POST /send — authenticated, server-backed mode', () => {
  beforeEach(() => serverBackedMode());

  it('requires a signed-in user', async () => {
    const fetchSpy = configurePostmark();
    const { status, body } = await request('POST', '/api/messages/send', validSend());
    expect(status).toBe(401);
    expect(body.error).toBe('not_authenticated');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends through Postmark with the token in a header, and never in the response', async () => {
    let captured;
    configurePostmark(async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ To: 'client@example.com', MessageID: 'pm-msg-123', ErrorCode: 0, Message: 'OK' }), { status: 200 });
    });
    const { status, body } = await request('POST', '/api/messages/send', validSend(), asRole('owner'));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, providerName: 'postmark', providerMessageId: 'pm-msg-123', status: 'sent' });
    expect(captured.url).toBe('https://api.postmarkapp.com/email');
    expect(captured.init.headers['X-Postmark-Server-Token']).toBe('pm-secret-token');
    const sent = JSON.parse(captured.init.body);
    expect(sent).toMatchObject({ From: 'reminders@practice.example', To: 'client@example.com', Subject: 'Documents still needed', TextBody: 'Hi Dave, …', MessageStream: 'outbound' });
    expect(JSON.stringify(body)).not.toContain('pm-secret-token');
  });

  it('records a real send in the security audit trail — recipient domain only, never the address or the body', async () => {
    configurePostmark();
    await request('POST', '/api/messages/send', validSend(), asRole('accountant', 'u_farhan'));
    const sent = fake.audits.find((a) => a.action === 'message.email_sent');
    expect(sent).toBeDefined();
    expect(sent.req.user).toMatchObject({ id: 'u_farhan', role: 'accountant' });
    expect(sent.details).toEqual({ provider: 'postmark', recipientDomain: 'example.com' });
    expect(JSON.stringify(sent.details)).not.toContain('client@');
    expect(JSON.stringify(sent.details)).not.toContain('Dave');
  });

  it('answers the same result for a repeated idempotency key without sending twice', async () => {
    const fetchSpy = configurePostmark(async () => new Response(JSON.stringify({ MessageID: 'pm-once' }), { status: 200 }));
    const first = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_double_click_1' }), asRole('owner'));
    const second = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_double_click_1' }), asRole('owner'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(second.body).toEqual({ ...first.body, deduplicated: true });
  });

  it('scopes a key to the signed-in user: someone else using the same key sends their own message', async () => {
    const fetchSpy = configurePostmark();
    const mine = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_shared_key_1' }), asRole('owner', 'u_adnan'));
    const theirs = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_shared_key_1', to: 'other@example.com' }), asRole('owner', 'u_farhan'));
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);
    expect(theirs.body.deduplicated).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('refuses a key reused for a different message rather than replaying the wrong result', async () => {
    const fetchSpy = configurePostmark();
    await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_reused_key_1' }), asRole('owner'));
    const changed = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_reused_key_1', body: 'A different message entirely' }), asRole('owner'));
    expect(changed.status).toBe(422);
    expect(changed.body.error).toBe('idempotency_key_reused');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a second request arriving while the first is still with the provider is turned away, not sent again', async () => {
    let releaseProvider;
    const providerBusy = new Promise((resolve) => (releaseProvider = resolve));
    const fetchSpy = configurePostmark(async () => {
      await providerBusy;
      return new Response(JSON.stringify({ MessageID: 'pm-slow' }), { status: 200 });
    });
    const first = request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_concurrent_1' }), asRole('owner'));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const second = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_concurrent_1' }), asRole('owner'));
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('send_in_progress');
    expect(second.headers['retry-after']).toBe('2');

    releaseProvider();
    expect((await first).status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Once it has finished, the retry is a replay.
    const third = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_concurrent_1' }), asRole('owner'));
    expect(third.body).toMatchObject({ providerMessageId: 'pm-slow', deduplicated: true });
  });

  it('maps Postmark failures to the app\'s own codes', async () => {
    const cases = [
      [new Response(JSON.stringify({ Message: 'Bad token' }), { status: 401 }), 502, 'invalid_credentials'],
      [new Response(JSON.stringify({ ErrorCode: 300, Message: "Invalid 'To' address." }), { status: 422 }), 400, 'rejected_by_provider'],
      [new Response('', { status: 429 }), 429, 'rate_limited'],
      [new Response('', { status: 503 }), 502, 'upstream_503'],
    ];
    let n = 0;
    for (const [response, status, code] of cases) {
      configurePostmark(async () => response);
      const res = await request('POST', '/api/messages/send', validSend({ idempotencyKey: `send_failure_${n++}` }), asRole('owner'));
      expect(res.status, code).toBe(status);
      expect(res.body.error).toBe(code);
    }
    configurePostmark(async () => {
      throw new Error('ECONNRESET');
    });
    const down = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_failure_down' }), asRole('owner'));
    expect(down.status).toBe(502);
    expect(down.body.error).toBe('upstream_unreachable');
  });

  it('lets the same key try again after the provider definitively refused it (nothing was sent)', async () => {
    let calls = 0;
    configurePostmark(async () => (++calls === 1 ? new Response(JSON.stringify({ Message: 'Try later' }), { status: 429 }) : new Response(JSON.stringify({ MessageID: 'pm-second-try' }), { status: 200 })));
    const first = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_retry_ok_1' }), asRole('owner'));
    expect(first.status).toBe(429);
    const retry = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_retry_ok_1' }), asRole('owner'));
    expect(retry.status).toBe(200);
    expect(retry.body.providerMessageId).toBe('pm-second-try');
    expect(retry.body.deduplicated).toBeUndefined();
  });

  it('never re-sends a key whose outcome is unknowable (connection lost mid-send) — it says so instead', async () => {
    const fetchSpy = configurePostmark(async () => {
      throw new Error('socket hang up');
    });
    const first = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_unknown_01' }), asRole('owner'));
    expect(first.status).toBe(502);
    const retry = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_unknown_01' }), asRole('owner'));
    expect(retry.status).toBe(409);
    expect(retry.body.error).toBe('send_outcome_unknown');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses to send when Postmark is chosen but not configured, without consuming the key', async () => {
    process.env.MESSAGING_EMAIL_PROVIDER = 'postmark';
    delete process.env.POSTMARK_SERVER_TOKEN;
    const { status, body } = await request('POST', '/api/messages/send', validSend(), asRole('owner'));
    expect(status).toBe(503);
    expect(body.error).toBe('not_configured');
    expect(fake.claims.size).toBe(0);
  });

  it('only roles that hold messages.send may send; an unknown role holds nothing', async () => {
    const fetchSpy = configurePostmark();
    for (const role of ['owner', 'manager', 'accountant', 'admin']) {
      const res = await request('POST', '/api/messages/send', validSend({ idempotencyKey: `send_role_${role}_1` }), asRole(role));
      expect(res.status, role).toBe(200);
    }
    const denied = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_role_intern_1' }), asRole('intern'));
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: 'forbidden', permission: 'messages.send' });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
