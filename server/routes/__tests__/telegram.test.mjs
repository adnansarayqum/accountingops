import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

/**
 * The webhook over a real local HTTP server, with the link store, the
 * outbound Telegram API and requireAuth replaced by fakes — nothing here
 * opens a database connection or reaches Telegram.
 */
const fake = vi.hoisted(() => ({
  replies: [],
  links: new Map(),
  codes: new Map(),
}));

vi.mock('../auth.mjs', () => ({
  requireAuth: (req, res, next) => {
    const user = req.get('x-test-user');
    if (!user) return res.status(401).json({ error: 'not_authenticated' });
    req.user = { id: user, username: 'tester', role: 'owner' };
    next();
  },
}));

vi.mock('../../lib/telegramApi.mjs', () => ({
  sendMessage: vi.fn(async (chatId, text) => {
    fake.replies.push({ chatId, text });
  }),
}));

vi.mock('../../lib/telegramStore.mjs', () => ({
  createLinkCode: vi.fn(async (userId) => {
    const code = `CODE${fake.codes.size}`;
    fake.codes.set(code, userId);
    return { code, expiresAt: new Date('2026-09-30T12:15:00Z') };
  }),
  consumeLinkCode: vi.fn(async (code, chatId) => {
    const userId = fake.codes.get(code);
    if (!userId) return null;
    fake.codes.delete(code);
    fake.links.set(String(chatId), { userId, linkedAt: '2026-09-30T12:00:00.000Z' });
    return userId;
  }),
  findLinkByChatId: vi.fn(async (chatId) => fake.links.get(String(chatId)) ?? null),
  findLinkByUserId: vi.fn(async (userId) => [...fake.links.values()].find((l) => l.userId === userId) ?? null),
}));

const { default: router } = await import('../telegram.mjs');

const SECRET = 's'.repeat(64);
const ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'DATABASE_URL'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let server;
let baseUrl;

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${baseUrl}${path}`, { method, headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const signed = { 'X-Telegram-Bot-Api-Secret-Token': SECRET };
const update = (chatId, message) => ({ update_id: 1, message: { message_id: 1, chat: { id: chatId }, ...message } });
const webhook = (body, headers = signed) => request('POST', '/api/telegram/webhook', body, headers);
const lastReplyTo = async (chatId) => {
  await vi.waitFor(() => expect(fake.replies.some((r) => r.chatId === chatId)).toBe(true));
  return fake.replies.filter((r) => r.chatId === chatId).at(-1).text;
};

beforeAll(async () => {
  const app = express();
  app.use('/api/telegram', router);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://fake-for-route-tests/none';
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  fake.replies.length = 0;
  fake.links.clear();
  fake.codes.clear();
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /status', () => {
  it('says whether the bot is configured, and nothing more', async () => {
    expect((await request('GET', '/api/telegram/status')).body).toEqual({ configured: true });
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await request('GET', '/api/telegram/status')).body).toEqual({ configured: false });
  });
});

describe('without a database', () => {
  it('refuses everything past /status', async () => {
    delete process.env.DATABASE_URL;
    expect((await webhook(update(1, { text: '/start' }))).status).toBe(503);
    expect((await request('GET', '/api/telegram/link', undefined, { 'x-test-user': 'u_ray' })).status).toBe(503);
  });
});

describe('POST /webhook signature', () => {
  it('rejects a missing or wrong secret, and never replies', async () => {
    expect((await webhook(update(1, { text: '/start CODE0' }), {})).status).toBe(403);
    expect((await webhook(update(1, { text: '/start CODE0' }), { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' })).status).toBe(403);
    expect(fake.replies).toEqual([]);
  });

  it('rejects everything when no secret is configured, even a request that sends an empty one', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await webhook(update(1, { text: 'hi' }), { 'X-Telegram-Bot-Api-Secret-Token': '' })).status).toBe(403);
  });

  it('does not let a forged request spend a real chat’s rate limit', async () => {
    for (let i = 0; i < 40; i += 1) await webhook(update(555, { text: 'hi' }), {});
    expect((await webhook(update(555, { text: 'hi' }))).status).toBe(200);
  });
});

describe('POST /webhook linking', () => {
  it('links the chat with a live code from Settings, and says so', async () => {
    const { body } = await request('POST', '/api/telegram/link-codes', undefined, { 'x-test-user': 'u_ray' });
    expect(body.code).toBeTruthy();

    expect((await webhook(update(42, { text: `/start ${body.code}` }))).status).toBe(200);
    expect(await lastReplyTo(42)).toMatch(/You're connected/);

    const link = await request('GET', '/api/telegram/link', undefined, { 'x-test-user': 'u_ray' });
    expect(link.body).toEqual({ linked: true, linkedAt: '2026-09-30T12:00:00.000Z' });
  });

  it('explains a bare /start and an unknown code', async () => {
    await webhook(update(7, { text: '/start' }));
    expect(await lastReplyTo(7)).toMatch(/Send \/start followed by the code/);
    fake.replies.length = 0;
    await webhook(update(7, { text: '/start NOPE' }));
    expect(await lastReplyTo(7)).toMatch(/isn't valid any more/);
  });

  it('tells an unlinked chat how to connect instead of accepting its photo', async () => {
    await webhook(update(9, { photo: [{ file_id: 'f1' }] }));
    expect(await lastReplyTo(9)).toMatch(/isn't connected to an account yet/);
  });

  it('acknowledges a photo from a linked chat with the placeholder reply', async () => {
    fake.links.set('11', { userId: 'u_ray', linkedAt: '2026-09-30T12:00:00.000Z' });
    await webhook(update(11, { photo: [{ file_id: 'f1' }] }));
    expect(await lastReplyTo(11)).toMatch(/reading photos isn't wired up yet/);
  });

  it('acknowledges updates with no message (a later phase handles them) without replying', async () => {
    expect((await webhook({ update_id: 2, callback_query: { id: 'q' } })).status).toBe(200);
    expect(fake.replies).toEqual([]);
  });
});

describe('practice routes', () => {
  it('need a signed-in user', async () => {
    expect((await request('GET', '/api/telegram/link')).status).toBe(401);
    expect((await request('POST', '/api/telegram/link-codes')).status).toBe(401);
  });

  it('report an unlinked user as not linked', async () => {
    expect((await request('GET', '/api/telegram/link', undefined, { 'x-test-user': 'u_farhan' })).body).toEqual({ linked: false, linkedAt: null });
  });
});
