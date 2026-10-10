import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

/** The retired Telegram bot's one remaining route: the photos it filed. */
const fake = vi.hoisted(() => ({ uploads: new Map() }));

vi.mock('../auth.mjs', () => ({
  requireAuth: (req, res, next) => (req.get('x-test-user') ? next() : res.status(401).json({ error: 'not_authenticated' })),
}));
vi.mock('../../lib/telegramStore.mjs', () => ({ readUpload: vi.fn(async (id) => fake.uploads.get(id) ?? null) }));

const { default: router } = await import('../telegram.mjs');

let server;
let baseUrl;
const original = process.env.DATABASE_URL;

const get = (path, headers = {}) =>
  new Promise((resolve, reject) => {
    http
      .get(`${baseUrl}${path}`, { headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });

beforeAll(async () => {
  const app = express();
  app.use('/api/telegram', router);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://fake/none';
  fake.uploads.set('tgu_1', { fileName: 'telegram-"1".jpg', contentType: 'image/jpeg', content: Buffer.from([0xff, 0xd8, 0xff]) });
});
afterEach(() => {
  fake.uploads.clear();
  if (original === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = original;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /uploads/:id', () => {
  it('serves a stored photo inline and uncached, to a signed-in user only', async () => {
    expect((await get('/api/telegram/uploads/tgu_1')).status).toBe(401);
    const res = await get('/api/telegram/uploads/tgu_1', { 'x-test-user': 'u_ray' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['content-disposition']).toBe('inline; filename="telegram-1.jpg"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body.equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
  });

  it('404s an unknown photo, and is unavailable without a database', async () => {
    expect((await get('/api/telegram/uploads/tgu_missing', { 'x-test-user': 'u_ray' })).status).toBe(404);
    delete process.env.DATABASE_URL;
    expect((await get('/api/telegram/uploads/tgu_1', { 'x-test-user': 'u_ray' })).status).toBe(503);
  });

  it('no longer answers anything the bot used to', async () => {
    for (const path of ['/api/telegram/status', '/api/telegram/link', '/api/telegram/activity']) {
      expect((await get(path, { 'x-test-user': 'u_ray' })).status).toBe(404);
    }
  });
});
