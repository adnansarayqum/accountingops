import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

/** The bank routes over a real local HTTP server, with sign-in, the stores and the model faked. */
const fake = vi.hoisted(() => ({ statements: [], existing: new Set(['inu_a', 'inu_b']), reads: [], category: new Map() }));

vi.mock('../auth.mjs', () => ({
  requireAuth: (req, res, next) => {
    const user = req.get('x-test-user');
    if (!user) return res.status(401).json({ error: 'not_authenticated' });
    req.user = { id: user, username: user, role: 'owner' };
    next();
  },
}));
vi.mock('../../lib/intakeStore.mjs', () => ({ readUpload: vi.fn(async () => null) }));
vi.mock('../../lib/bankStatement.mjs', async () => ({ ...(await vi.importActual('../../lib/bankStatement.mjs')), extractStatement: vi.fn() }));
vi.mock('../../lib/bankStore.mjs', () => ({
  MAX_QUERY_UPLOADS: 100,
  uploadsExist: vi.fn(async (ids) => ids.every((id) => fake.existing.has(id))),
  claimStatement: vi.fn(),
  failStatement: vi.fn(),
  saveStatement: vi.fn(),
  queryStatements: vi.fn(async (ids) => fake.statements.filter((s) => ids.includes(s.sourceUploadId))),
  setCategory: vi.fn(async (id, category) => (id === 'btx_1' ? { id, category, categorySource: 'user' } : null)),
}));
vi.mock('../../lib/bankExtraction.mjs', () => ({
  startRead: vi.fn(async (ids) => {
    fake.reads.push(ids);
    return process.env.ANTHROPIC_API_KEY ? { id: 'bst_1', status: ids[0] === 'inu_b' ? 'extracted' : 'reading' } : { status: 'not_configured' };
  }),
}));

const { default: router } = await import('../bank.mjs');
const { BANK_CATEGORIES } = await import('../../lib/bankStatement.mjs');

let server;
let baseUrl;
const ENV_KEYS = ['DATABASE_URL', 'ANTHROPIC_API_KEY'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const asRay = { 'x-test-user': 'u_ray' };

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${baseUrl}${path}`, { method, headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  const app = express();
  app.use('/api/bank', router);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://fake-for-route-tests/none';
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  fake.statements = [{ id: 'bst_1', sourceUploadId: 'inu_a', status: 'extracted', transactions: [] }];
});
afterEach(() => {
  fake.reads.length = 0;
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('availability', () => {
  it('needs a signed-in user and a database', async () => {
    expect((await request('POST', '/api/bank/statements/query', { uploadIds: ['inu_a'] })).status).toBe(401);
    delete process.env.DATABASE_URL;
    expect((await request('POST', '/api/bank/statements/query', { uploadIds: ['inu_a'] }, asRay)).status).toBe(503);
  });
});

describe('POST /statements/query', () => {
  it('returns what was read from the documents asked about, whether reading is possible, and the categories', async () => {
    const res = await request('POST', '/api/bank/statements/query', { uploadIds: ['inu_a', 'inu_zzz'] }, asRay);
    expect(res.status).toBe(200);
    expect(res.body.statements.map((s) => s.id)).toEqual(['bst_1']);
    expect(res.body.canRead).toBe(true);
    expect(res.body.categories).toEqual(BANK_CATEGORIES);
    delete process.env.ANTHROPIC_API_KEY;
    expect((await request('POST', '/api/bank/statements/query', { uploadIds: ['inu_a'] }, asRay)).body.canRead).toBe(false);
  });

  it('refuses anything that is not a list of upload ids', async () => {
    for (const body of [{}, { uploadIds: [] }, { uploadIds: 'inu_a' }, { uploadIds: [1] }, { uploadIds: ['../etc'] }, { uploadIds: Array.from({ length: 101 }, (_, i) => `inu_${i}`) }]) {
      expect((await request('POST', '/api/bank/statements/query', body, asRay)).status).toBe(400);
    }
  });
});

describe('POST /statements/read', () => {
  it('starts a read for the document — 202 when it was just queued, 200 when it was already read or being read', async () => {
    const queued = await request('POST', '/api/bank/statements/read', { uploadIds: ['inu_a'] }, asRay);
    expect(queued).toMatchObject({ status: 202, body: { status: 'reading' } });
    const done = await request('POST', '/api/bank/statements/read', { uploadIds: ['inu_b'] }, asRay);
    expect(done).toMatchObject({ status: 200, body: { status: 'extracted' } });
    expect(fake.reads).toEqual([['inu_a'], ['inu_b']]);
  });

  it('is refused for an unknown upload, bad input, or without an API key', async () => {
    expect((await request('POST', '/api/bank/statements/read', { uploadIds: ['inu_a', 'inu_nope'] }, asRay)).status).toBe(404);
    expect((await request('POST', '/api/bank/statements/read', { uploadIds: [] }, asRay)).status).toBe(400);
    expect(fake.reads).toEqual([]);
    delete process.env.ANTHROPIC_API_KEY;
    expect((await request('POST', '/api/bank/statements/read', { uploadIds: ['inu_a'] }, asRay)).status).toBe(503);
  });

  it('caps how many reads one person can ask for a minute', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await request('POST', '/api/bank/statements/read', { uploadIds: ['inu_a'] }, { 'x-test-user': 'u_limit' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 202)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('PATCH /transactions/:id', () => {
  it('records a category from the list, 404s an unknown line, and refuses a category outside it', async () => {
    expect((await request('PATCH', '/api/bank/transactions/btx_1', { category: 'Travel & motor' }, asRay)).body).toEqual({ id: 'btx_1', category: 'Travel & motor', categorySource: 'user' });
    expect((await request('PATCH', '/api/bank/transactions/btx_9', { category: 'VAT' }, asRay)).status).toBe(404);
    for (const category of ['Crypto gains', '', 7, undefined]) expect((await request('PATCH', '/api/bank/transactions/btx_1', { category }, asRay)).status).toBe(400);
    expect((await request('PATCH', '/api/bank/transactions/btx_1', { category: 'VAT' })).status).toBe(401);
  });
});
