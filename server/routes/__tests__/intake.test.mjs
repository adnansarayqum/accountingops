import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

/**
 * The intake routes over a real local HTTP server, with sign-in, the store,
 * the snapshot and the model faked — the pipeline in between is the real
 * one, so a request here exercises validation, storing, reading, matching
 * and queueing together.
 */
const fake = vi.hoisted(() => ({
  uploads: [],
  activity: [],
  duplicate: null,
  read: null,
  reads: 0,
}));

vi.mock('../auth.mjs', () => ({
  requireAuth: (req, res, next) => {
    const user = req.get('x-test-user');
    if (!user) return res.status(401).json({ error: 'not_authenticated' });
    req.user = { id: user, username: user, role: 'owner' };
    next();
  },
}));

vi.mock('../../lib/briefingStore.mjs', () => ({
  readPracticeSnapshot: vi.fn(async () => ({ clients: [{ id: 'cl_acme', name: 'Acme Ltd' }], identifiers: [{ id: 'i1', clientId: 'cl_acme', kind: 'company_number', value: '08654123', sensitive: false }] })),
}));

vi.mock('../../lib/intakeReader.mjs', async () => {
  const actual = await vi.importActual('../../lib/intakeReader.mjs');
  return {
    ...actual,
    readBatch: vi.fn(async ({ parts }) => {
      fake.reads += 1;
      return fake.read ?? parts.map((_, i) => actual.unreadDocument([i]));
    }),
  };
});

vi.mock('../../lib/intakeStore.mjs', async () => {
  const actual = await vi.importActual('../../lib/intakeStore.mjs');
  return {
    sha256: actual.sha256,
    findDuplicateBatch: vi.fn(async () => fake.duplicate),
    saveBatch: vi.fn(async ({ batchId, userId, parts }) =>
      parts.map((p, i) => {
        const id = `inu_${fake.uploads.length + 1}_${i}`;
        fake.uploads.push({ id, batchId, userId, ...p });
        return id;
      }),
    ),
    queueDocument: vi.fn(async (row) => {
      const id = `ina_${fake.activity.length + 1}`;
      fake.activity.push({ id, ...row, held: row.holdMinutes > 0, applied: false });
      return id;
    }),
    assignDocument: vi.fn(async (id, userId, clientId) => {
      const row = fake.activity.find((a) => a.id === id && a.userId === userId && !a.applied);
      if (!row) return false;
      row.suggestion = { ...row.suggestion, clientId };
      return true;
    }),
    releaseBatch: vi.fn(async (batchId, userId) => {
      const rows = fake.activity.filter((a) => a.batchId === batchId && a.userId === userId && !a.applied);
      rows.forEach((r) => (r.held = false));
      return rows.length;
    }),
    pendingActivity: vi.fn(async () => fake.activity.filter((a) => !a.held && !a.applied).map((a) => ({ id: a.id }))),
    markActivityApplied: vi.fn(async (ids) => ids.length),
    readUpload: vi.fn(async (id) => {
      const u = fake.uploads.find((x) => x.id === id);
      return u ? { fileName: u.fileName, contentType: u.contentType, content: u.bytes } : null;
    }),
  };
});

const { default: router } = await import('../intake.mjs');

let server;
let baseUrl;
const ENV_KEYS = ['DATABASE_URL', 'ANTHROPIC_API_KEY'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const asRay = { 'x-test-user': 'u_ray' };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${baseUrl}${path}`, { method, headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const json = (res.headers['content-type'] ?? '').includes('application/json');
        resolve({ status: res.statusCode, headers: res.headers, body: json ? JSON.parse(raw.toString() || '{}') : raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const share = (files, text) => request('POST', '/api/intake/batches', { files, text }, asRay);
const jpeg = (name = 'IMG_1.jpg') => ({ fileName: name, contentType: 'image/jpeg', contentBase64: JPEG.toString('base64') });

beforeAll(async () => {
  const app = express();
  app.use('/api/intake', router);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://fake-for-route-tests/none';
  process.env.ANTHROPIC_API_KEY = 'sk-test';
});

afterEach(() => {
  fake.uploads.length = 0;
  fake.activity.length = 0;
  fake.duplicate = null;
  fake.read = null;
  fake.reads = 0;
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('availability', () => {
  it('reports itself, refuses everything else without a database, and needs a signed-in user', async () => {
    expect((await request('GET', '/api/intake/status')).body).toEqual({ configured: true });
    expect((await request('POST', '/api/intake/batches', { files: [jpeg()] })).status).toBe(401);
    delete process.env.DATABASE_URL;
    expect((await request('GET', '/api/intake/status')).body).toEqual({ configured: false });
    expect((await share([jpeg()])).status).toBe(503);
  });
});

describe('POST /batches', () => {
  it('stores, reads and queues a share held for the share screen, and says where each document went', async () => {
    fake.read = [{ parts: [0, 1], documentType: 'Corporation Tax notice to deliver', reference: null, letterDate: null, period: null, identifiers: { companyNumber: '8654123', utr: null, vatNumber: null, payeReference: null }, clientId: null, confidence: 0.4, rationale: 'x', summary: 'CT notice for Acme' }];
    const res = await share([jpeg('a.jpg'), jpeg('b.jpg')]);
    expect(res.status).toBe(201);
    expect(res.body.read).toBe(true);
    expect(res.body.documents).toEqual([
      expect.objectContaining({ filed: true, clientId: 'cl_acme', clientName: 'Acme Ltd', fileName: 'a.jpg (+1 more page)', summary: 'CT notice for Acme', documentType: 'Corporation Tax notice to deliver' }),
    ]);
    expect(fake.uploads.map((u) => u.userId)).toEqual(['u_ray', 'u_ray']);
    expect(fake.activity[0]).toMatchObject({ source: 'share', userId: 'u_ray', holdMinutes: 10 });
  });

  it('rejects a bad share before storing anything', async () => {
    expect((await share([])).body).toEqual({ error: 'empty' });
    expect((await share([{ fileName: 'x.pdf', contentType: 'application/pdf', contentBase64: JPEG.toString('base64') }])).body).toEqual({ error: 'content_mismatch' });
    expect(fake.uploads).toEqual([]);
    expect(fake.reads).toBe(0);
  });

  it('says so when the same files were already shared, without reading them again', async () => {
    fake.duplicate = 'inb_earlier';
    const res = await share([jpeg()]);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'already_shared' });
    expect(fake.reads).toBe(0);
  });

  it('caps how many shares one user can send a minute', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await request('POST', '/api/intake/batches', { files: [] }, { 'x-test-user': 'u_limit' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('the share screen', () => {
  it('lets the sharer correct the client, or clear it, and release the batch', async () => {
    const { body } = await share([jpeg()], 'my UTR is 1234567890');
    const [first, second] = body.documents;
    expect((await request('POST', `/api/intake/activity/${first.id}/assign`, { clientId: 'cl_acme' }, asRay)).body).toEqual({ ok: true });
    expect((await request('POST', `/api/intake/activity/${second.id}/assign`, { clientId: null }, asRay)).body).toEqual({ ok: true });
    expect((await request('GET', '/api/intake/activity', undefined, asRay)).body.activity).toEqual([]);

    expect((await request('POST', `/api/intake/batches/${body.batchId}/release`, {}, asRay)).body).toEqual({ released: 2 });
    expect((await request('GET', '/api/intake/activity', undefined, asRay)).body.activity.map((a) => a.id)).toEqual([first.id, second.id]);
  });

  it('refuses a malformed client, and another user’s document', async () => {
    const { body } = await share([jpeg()]);
    const id = body.documents[0].id;
    expect((await request('POST', `/api/intake/activity/${id}/assign`, { clientId: 42 }, asRay)).status).toBe(400);
    expect((await request('POST', `/api/intake/activity/${id}/assign`, {}, asRay)).status).toBe(400);
    expect((await request('POST', `/api/intake/activity/${id}/assign`, { clientId: 'cl_acme' }, { 'x-test-user': 'u_farhan' })).status).toBe(404);
  });
});

describe('GET /uploads/:id', () => {
  it('serves each page inline and uncached, text as plain text, and 404s anything unknown', async () => {
    await share([jpeg('statement.jpg')], '<script>alert(1)</script>');
    const [image, text] = fake.uploads;
    const photo = await request('GET', `/api/intake/uploads/${image.id}`, undefined, asRay);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(photo.headers['content-disposition']).toBe('inline; filename="statement.jpg"');
    expect(photo.headers['cache-control']).toBe('no-store');
    expect(photo.headers['x-content-type-options']).toBe('nosniff');
    expect(photo.body.equals(JPEG)).toBe(true);

    const note = await request('GET', `/api/intake/uploads/${text.id}`, undefined, asRay);
    expect(note.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect((await request('GET', '/api/intake/uploads/inu_missing', undefined, asRay)).status).toBe(404);
    expect((await request('GET', `/api/intake/uploads/${image.id}`)).status).toBe(401);
  });
});
