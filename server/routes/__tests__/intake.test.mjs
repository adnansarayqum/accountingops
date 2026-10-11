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
  keys: new Map(),
}));

vi.mock('../auth.mjs', () => ({
  requireAuth: (req, res, next) => {
    const user = req.get('x-test-user');
    if (!user) return res.status(401).json({ error: 'not_authenticated' });
    req.user = { id: user, username: user, role: 'owner' };
    next();
  },
}));

vi.mock('../../lib/intakeTokens.mjs', async () => {
  const actual = await vi.importActual('../../lib/intakeTokens.mjs');
  return {
    parseBearer: actual.parseBearer,
    userForToken: vi.fn(async (token) => {
      const key = fake.keys.get(token);
      return key && !key.revoked ? { id: key.userId, username: key.userId, role: 'owner' } : null;
    }),
    createToken: vi.fn(async (userId, label) => {
      if ([...fake.keys.values()].filter((k) => k.userId === userId && !k.revoked).length >= 5) return { error: 'too_many' };
      const id = `ink_${fake.keys.size + 1}`;
      const token = `frk_test_${id}`;
      fake.keys.set(token, { id, userId, label: label || 'iPhone', revoked: false });
      return { id, label: label || 'iPhone', token };
    }),
    listTokens: vi.fn(async (userId) => [...fake.keys.values()].filter((k) => k.userId === userId && !k.revoked).map((k) => ({ id: k.id, label: k.label, createdAt: '2026-10-10T10:00:00.000Z', lastUsedAt: null }))),
    revokeToken: vi.fn(async (id, userId) => {
      const key = [...fake.keys.values()].find((k) => k.id === id && k.userId === userId && !k.revoked);
      if (key) key.revoked = true;
      return Boolean(key);
    }),
  };
});

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
  fake.keys.clear();
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
    expect((await share([])).body).toMatchObject({ error: 'empty', message: expect.any(String) });
    expect((await share([{ fileName: 'x.pdf', contentType: 'application/pdf', contentBase64: JPEG.toString('base64') }])).body).toMatchObject({ error: 'content_mismatch' });
    expect(fake.uploads).toEqual([]);
    expect(fake.reads).toBe(0);
  });

  it('says so when the same files were already shared, without reading them again', async () => {
    fake.duplicate = 'inb_earlier';
    const res = await share([jpeg()]);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'already_shared' });
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

/** A multipart/form-data body, as the iPhone Shortcut's "Form" request sends one. */
function multipart(fields) {
  const boundary = '----ShortcutBoundary7MA4YWxk';
  const chunks = [];
  for (const f of fields) {
    const disposition = `Content-Disposition: form-data; name="${f.name}"${f.fileName ? `; filename="${f.fileName}"` : ''}`;
    chunks.push(Buffer.from(`--${boundary}\r\n${disposition}\r\n${f.contentType ? `Content-Type: ${f.contentType}\r\n` : ''}\r\n`), Buffer.isBuffer(f.value) ? f.value : Buffer.from(f.value), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  return { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } };
}

function upload(fields, headers) {
  const { body, headers: formHeaders } = multipart(fields);
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}/api/intake/batches`, { method: 'POST', headers: { ...formHeaders, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const makeKey = async (userId = 'u_ray') => (await request('POST', '/api/intake/tokens', { label: 'My iPhone' }, { 'x-test-user': userId })).body;
const withKey = (token) => ({ Authorization: `Bearer ${token}` });
const photo = (extra = {}) => ({ name: 'file', fileName: 'IMG_0001.JPG', contentType: 'application/octet-stream', value: JPEG, ...extra });

describe('upload keys for the iPhone Shortcut', () => {
  it('make a key shown once, list without it, and revoke it — only by the person who made it', async () => {
    const made = await makeKey();
    expect(made).toMatchObject({ id: expect.any(String), label: 'My iPhone', token: expect.stringMatching(/^frk_/) });
    const listed = (await request('GET', '/api/intake/tokens', undefined, asRay)).body.tokens;
    expect(listed).toEqual([expect.objectContaining({ id: made.id, label: 'My iPhone' })]);
    expect(JSON.stringify(listed)).not.toContain(made.token);

    expect((await request('DELETE', `/api/intake/tokens/${made.id}`, undefined, { 'x-test-user': 'u_farhan' })).status).toBe(404);
    expect((await request('DELETE', `/api/intake/tokens/${made.id}`, undefined, asRay)).body).toEqual({ ok: true });
    expect((await request('GET', '/api/intake/tokens', undefined, asRay)).body.tokens).toEqual([]);
  });

  it('are made from a signed-in session only, and at most five at a time', async () => {
    expect((await request('POST', '/api/intake/tokens', { label: 'x' })).status).toBe(401);
    const key = await makeKey();
    expect((await request('POST', '/api/intake/tokens', { label: 'x' }, withKey(key.token))).status).toBe(401);
    expect((await request('GET', '/api/intake/tokens', undefined, withKey(key.token))).status).toBe(401);
    for (let i = 0; i < 4; i += 1) expect((await request('POST', '/api/intake/tokens', {}, asRay)).status).toBe(201);
    expect((await request('POST', '/api/intake/tokens', {}, asRay)).status).toBe(409);
  });

  it('send a multipart form straight in — no share screen to wait for, and a message saying where it went', async () => {
    const { token } = await makeKey('u_k1');
    fake.read = [{ parts: [0], documentType: 'Bank statement', reference: null, letterDate: null, period: null, identifiers: { companyNumber: '8654123', utr: null, vatNumber: null, payeReference: null }, clientId: null, confidence: 0, rationale: 'x', summary: 'Statement' }];
    const res = await upload([photo()], withKey(token));
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Filed under Acme Ltd: Bank statement');
    expect(fake.uploads).toEqual([expect.objectContaining({ userId: 'u_k1', contentType: 'image/jpeg', fileName: 'IMG_0001.jpg' })]);
    expect(fake.activity[0]).toMatchObject({ source: 'shortcut', userId: 'u_k1', holdMinutes: 0, held: false });
  });

  it('read the type from the bytes, take text from a text field, and accept several files', async () => {
    const { token } = await makeKey('u_k2');
    const pdf = Buffer.from('%PDF-1.7 statement');
    const res = await upload([photo(), { name: 'file', fileName: 'statement', contentType: 'application/octet-stream', value: pdf }, { name: 'text', value: 'new UTR 1234567890' }], withKey(token));
    expect(res.status).toBe(201);
    expect(fake.uploads.map((u) => u.contentType)).toEqual(['image/jpeg', 'application/pdf', 'text/plain']);
    expect(fake.uploads[2].bytes.toString()).toBe('new UTR 1234567890');
  });

  it('refuse what cannot be read, with a message a Shortcut can show', async () => {
    const { token } = await makeKey('u_k3');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic')]);
    const unsupported = await upload([{ name: 'file', fileName: 'IMG.HEIC', contentType: 'image/heic', value: heic }], withKey(token));
    expect(unsupported.status).toBe(400);
    expect(unsupported.body).toMatchObject({ error: 'unsupported_type', message: expect.stringContaining('JPEG') });

    expect((await upload([], withKey(token))).body).toMatchObject({ error: 'empty' });
    expect((await upload([photo({ value: Buffer.alloc(0) })], withKey(token))).body).toMatchObject({ error: 'empty' });
    const many = Array.from({ length: 11 }, () => photo());
    expect((await upload(many, withKey(token))).body).toMatchObject({ error: 'too_many_files' });
    const big = Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024)]);
    expect((await upload([photo({ value: big })], withKey(token))).body).toMatchObject({ error: 'file_too_large' });
    expect(fake.uploads).toEqual([]);
    expect(fake.reads).toBe(0);
  });

  it('never fall back to the cookie: a bad or revoked key is refused even beside a signed-in session', async () => {
    const { id, token } = await makeKey('u_k4');
    const asK4 = { 'x-test-user': 'u_k4' };
    expect((await upload([photo()], { ...withKey('frk_nope'), ...asK4 })).status).toBe(401);
    expect((await upload([photo()], { Authorization: 'Basic abc', ...asK4 })).status).toBe(401);
    await request('DELETE', `/api/intake/tokens/${id}`, undefined, asK4);
    expect((await upload([photo()], withKey(token))).status).toBe(401);
  });

  it('keep multipart for keys: a form upload on a session cookie alone is refused', async () => {
    const res = await upload([photo()], { 'x-test-user': 'u_k5' });
    expect(res.status).toBe(415);
    expect(res.body.error).toBe('use_json');
    expect(fake.uploads).toEqual([]);
  });

  it('open nothing but uploading: a key cannot read activity, files or the other routes', async () => {
    const { token } = await makeKey('u_k6');
    for (const path of ['/api/intake/activity', '/api/intake/uploads/inu_1']) expect((await request('GET', path, undefined, withKey(token))).status).toBe(401);
    expect((await request('POST', '/api/intake/activity/ack', { ids: [] }, withKey(token))).status).toBe(401);
  });

  it('share the per-user rate limit with the app', async () => {
    const { token } = await makeKey('u_keylimit');
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await upload([], withKey(token))).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
