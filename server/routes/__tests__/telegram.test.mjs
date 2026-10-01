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
  uploads: [],
  activity: [],
  pending: [],
  downloadError: null,
  extraction: null,
  readCalls: [],
  snapshot: {
    clients: [
      { id: 'cl_acme', name: 'Acme Ltd' },
      { id: 'cl_khan', name: 'Khan Consulting' },
    ],
    identifiers: [{ id: 'i1', clientId: 'cl_acme', kind: 'company_number', value: '08654123', sensitive: false }],
  },
}));

vi.mock('../../lib/briefingStore.mjs', () => ({ readPracticeSnapshot: vi.fn(async () => fake.snapshot) }));

vi.mock('../../lib/telegramVision.mjs', () => ({
  readLetter: vi.fn(async (input) => {
    fake.readCalls.push(input);
    return fake.extraction;
  }),
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
    return 900 + fake.replies.length;
  }),
  downloadFile: vi.fn(async () => {
    if (fake.downloadError) throw new Error(fake.downloadError);
    return { bytes: Buffer.alloc(2048, 1), filePath: 'photos/file_1.jpg' };
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
  findUploadByFileId: vi.fn(async (chatId, fileId) => fake.uploads.find((u) => u.chatId === chatId && u.fileId === fileId)?.id ?? null),
  saveUpload: vi.fn(async (upload) => {
    const id = `tgu_${fake.uploads.length + 1}`;
    fake.uploads.push({ id, ...upload });
    return id;
  }),
  queueActivity: vi.fn(async (row) => {
    fake.activity.push(row);
    return `tga_${fake.activity.length}`;
  }),
  savePendingMatch: vi.fn(async (row) => {
    fake.pending.push(row);
    return `tgp_${fake.pending.length}`;
  }),
}));

const { default: router } = await import('../telegram.mjs');

const SECRET = 's'.repeat(64);
const ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'DATABASE_URL', 'ANTHROPIC_API_KEY'];
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
  process.env.ANTHROPIC_API_KEY = 'sk-test';
});

afterEach(() => {
  fake.replies.length = 0;
  fake.links.clear();
  fake.codes.clear();
  fake.uploads.length = 0;
  fake.activity.length = 0;
  fake.pending.length = 0;
  fake.readCalls.length = 0;
  fake.downloadError = null;
  fake.extraction = null;
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

  it('tells an unlinked chat how to connect, and never reads or stores its photo', async () => {
    await webhook(update(9, { photo: [{ file_id: 'f1' }] }));
    expect(await lastReplyTo(9)).toMatch(/isn't connected to an account yet/);
    expect(fake.uploads).toEqual([]);
    expect(fake.readCalls).toEqual([]);
  });

  it('acknowledges updates with no message (a later phase handles them) without replying', async () => {
    expect((await webhook({ update_id: 2, callback_query: { id: 'q' } })).status).toBe(200);
    expect(fake.replies).toEqual([]);
  });
});

describe('POST /webhook photos', () => {
  const CHAT = 11;
  const replyMatching = async (pattern) => {
    await vi.waitFor(() => expect(fake.replies.some((r) => r.chatId === CHAT && pattern.test(r.text))).toBe(true));
    return fake.replies.filter((r) => r.chatId === CHAT).map((r) => r.text);
  };
  const photo = (fileId = 'f1') => update(CHAT, { photo: [{ file_id: `${fileId}_small` }, { file_id: fileId }] });
  const extraction = (overrides = {}) => ({
    documentType: 'Corporation Tax notice to deliver',
    reference: 'REF1',
    letterDate: '2026-09-20',
    period: null,
    identifiers: { companyNumber: null, utr: null, vatNumber: null, payeReference: null },
    clientId: null,
    confidence: 0,
    rationale: 'From the name.',
    ...overrides,
  });

  beforeEach(() => {
    fake.links.set(String(CHAT), { userId: 'u_ray', linkedAt: '2026-09-30T12:00:00.000Z' });
  });

  it('stores the largest size, reads it, and files a confident match for Smart Inbox', async () => {
    fake.extraction = extraction({ identifiers: { companyNumber: '8654123' } });
    await webhook(photo());
    const replies = await replyMatching(/Filed under Acme Ltd: Corporation Tax notice to deliver/);
    expect(replies[0]).toMatch(/reading it now/);

    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]).toMatchObject({ fileId: 'f1', contentType: 'image/jpeg' });
    expect(fake.readCalls[0].roster.map((c) => c.id)).toEqual(['cl_acme', 'cl_khan']);
    expect(fake.activity).toHaveLength(1);
    expect(fake.activity[0]).toMatchObject({ uploadId: 'tgu_1', sizeBytes: 2048, suggestion: { clientId: 'cl_acme', extractedReference: 'REF1' } });
    expect(fake.pending).toEqual([]);
  });

  it('holds an uncertain match and says who it might be', async () => {
    fake.extraction = extraction({ clientId: 'cl_khan', confidence: 0.5 });
    await webhook(photo());
    await replyMatching(/best guess: Khan Consulting/);
    expect(fake.activity).toEqual([]);
    expect(fake.pending).toHaveLength(1);
    expect(fake.pending[0]).toMatchObject({ chatId: CHAT, uploadId: 'tgu_1', candidates: ['cl_khan'] });
    expect(fake.pending[0].messageId).toBeGreaterThan(900);
  });

  it('keeps the photo and says so when it cannot be read', async () => {
    fake.extraction = null;
    await webhook(photo());
    await replyMatching(/couldn't read that one — it's saved/);
    expect(fake.uploads).toHaveLength(1);
    expect(fake.activity).toEqual([]);
  });

  it('keeps the photo without calling the model when no API key is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await webhook(photo());
    await replyMatching(/reading letters isn't set up/);
    expect(fake.uploads).toHaveLength(1);
    expect(fake.readCalls).toEqual([]);
  });

  it('reports a failed download without storing anything', async () => {
    fake.downloadError = 'getFile failed: 400';
    await webhook(photo());
    await replyMatching(/couldn't download that/);
    expect(fake.uploads).toEqual([]);
  });

  it('does not read (or pay for) a redelivered photo twice', async () => {
    fake.extraction = extraction({ identifiers: { companyNumber: '08654123' } });
    await webhook(photo());
    await replyMatching(/Filed under/);
    const repliesBefore = fake.replies.length;
    await webhook(photo());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.readCalls).toHaveLength(1);
    expect(fake.uploads).toHaveLength(1);
    expect(fake.replies).toHaveLength(repliesBefore);
  });

  it('reads an image sent as a file, and explains that other files are not readable yet', async () => {
    fake.extraction = extraction({ identifiers: { companyNumber: '08654123' } });
    await webhook(update(CHAT, { document: { file_id: 'd1', mime_type: 'image/png' } }));
    await replyMatching(/Filed under Acme Ltd/);
    expect(fake.uploads[0]).toMatchObject({ contentType: 'image/png' });
    expect(fake.uploads[0].fileName).toMatch(/\.png$/);

    await webhook(update(CHAT, { document: { file_id: 'd2', mime_type: 'application/pdf' } }));
    await replyMatching(/only read photos for now/);
    expect(fake.uploads).toHaveLength(1);
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
