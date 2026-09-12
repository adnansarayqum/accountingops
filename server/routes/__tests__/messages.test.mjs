import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import router, { resetIdempotency, sendLimiter } from '../messages.mjs';

/**
 * Exercised over a real local HTTP server, like the Companies House proxy
 * suite, and for the same reason: the tests must prove no provider token
 * ever appears in a response. Requests use node:http so that stubbing
 * global fetch (to intercept the route's OWN call to Postmark) never
 * intercepts the test's request to its own server.
 */
let server;
let baseUrl;
const ENV_KEYS = ['MESSAGING_EMAIL_PROVIDER', 'POSTMARK_SERVER_TOKEN', 'MESSAGING_FROM_EMAIL', 'MESSAGING_FROM_NAME', 'DATABASE_URL'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${baseUrl}${path}`, { method, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const validSend = (overrides = {}) => ({ channel: 'email', to: 'client@example.com', subject: 'Documents still needed', body: 'Hi Dave, …', idempotencyKey: 'send_test_0001', ...overrides });

beforeAll(async () => {
  delete process.env.DATABASE_URL; // browser-only mode: no login gate
  const app = express();
  app.use('/api/messages', router);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetIdempotency();
  sendLimiter.reset();
  for (const k of ENV_KEYS) {
    if (k === 'DATABASE_URL') continue;
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

afterAll(async () => {
  if (originalEnv.DATABASE_URL !== undefined) process.env.DATABASE_URL = originalEnv.DATABASE_URL;
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /status', () => {
  it('reports simulated email by default, WhatsApp as click-to-chat, SMS simulated', async () => {
    delete process.env.MESSAGING_EMAIL_PROVIDER;
    const { body } = await request('GET', '/api/messages/status');
    expect(body).toEqual({ email: { provider: 'simulated', configured: true, from: null }, whatsapp: { mode: 'click_to_chat' }, sms: { provider: 'simulated', configured: false } });
  });

  it('reports Postmark as not configured until token and from-address are both set, and never echoes the token', async () => {
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
});

describe('POST /send', () => {
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

  it('sends through Postmark with the token in a header, and never in the response', async () => {
    process.env.MESSAGING_EMAIL_PROVIDER = 'postmark';
    process.env.POSTMARK_SERVER_TOKEN = 'pm-secret-token';
    process.env.MESSAGING_FROM_EMAIL = 'reminders@practice.example';
    let captured;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        captured = { url, init };
        return new Response(JSON.stringify({ To: 'client@example.com', MessageID: 'pm-msg-123', ErrorCode: 0, Message: 'OK' }), { status: 200 });
      }),
    );
    const { status, body } = await request('POST', '/api/messages/send', validSend());
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, providerName: 'postmark', providerMessageId: 'pm-msg-123', status: 'sent' });
    expect(captured.url).toBe('https://api.postmarkapp.com/email');
    expect(captured.init.headers['X-Postmark-Server-Token']).toBe('pm-secret-token');
    const sent = JSON.parse(captured.init.body);
    expect(sent).toMatchObject({ From: 'reminders@practice.example', To: 'client@example.com', Subject: 'Documents still needed', TextBody: 'Hi Dave, …', MessageStream: 'outbound' });
    expect(JSON.stringify(body)).not.toContain('pm-secret-token');
  });

  it('answers the same result for a repeated idempotency key without sending twice', async () => {
    process.env.MESSAGING_EMAIL_PROVIDER = 'postmark';
    process.env.POSTMARK_SERVER_TOKEN = 'pm-secret-token';
    process.env.MESSAGING_FROM_EMAIL = 'reminders@practice.example';
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ MessageID: 'pm-once' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const first = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_double_click_1' }));
    const second = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_double_click_1' }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(second.body).toEqual({ ...first.body, deduplicated: true });
  });

  it('maps Postmark failures to the app\'s own codes', async () => {
    process.env.MESSAGING_EMAIL_PROVIDER = 'postmark';
    process.env.POSTMARK_SERVER_TOKEN = 'pm-secret-token';
    process.env.MESSAGING_FROM_EMAIL = 'reminders@practice.example';
    const cases = [
      [new Response(JSON.stringify({ Message: 'Bad token' }), { status: 401 }), 502, 'invalid_credentials'],
      [new Response(JSON.stringify({ ErrorCode: 300, Message: "Invalid 'To' address." }), { status: 422 }), 400, 'rejected_by_provider'],
      [new Response('', { status: 429 }), 429, 'rate_limited'],
      [new Response('', { status: 503 }), 502, 'upstream_503'],
    ];
    let n = 0;
    for (const [response, status, code] of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => response));
      const res = await request('POST', '/api/messages/send', validSend({ idempotencyKey: `send_failure_${n++}` }));
      expect(res.status, code).toBe(status);
      expect(res.body.error).toBe(code);
    }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const down = await request('POST', '/api/messages/send', validSend({ idempotencyKey: 'send_failure_down' }));
    expect(down.status).toBe(502);
    expect(down.body.error).toBe('upstream_unreachable');
  });

  it('refuses to send when Postmark is chosen but not configured', async () => {
    process.env.MESSAGING_EMAIL_PROVIDER = 'postmark';
    delete process.env.POSTMARK_SERVER_TOKEN;
    const { status, body } = await request('POST', '/api/messages/send', validSend());
    expect(status).toBe(503);
    expect(body.error).toBe('not_configured');
  });
});
