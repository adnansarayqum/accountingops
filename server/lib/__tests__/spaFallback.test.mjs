import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isAssetRequest, spaFallback } from '../spaFallback.mjs';

describe('isAssetRequest', () => {
  it('recognises built assets and file-like paths, but not client routes', () => {
    expect(isAssetRequest('/assets/app-abc123.js')).toBe(true);
    expect(isAssetRequest('/assets/anything')).toBe(true);
    expect(isAssetRequest('/favicon.ico')).toBe(true);
    expect(isAssetRequest('/fonts/inter.woff2')).toBe(true);
    expect(isAssetRequest('/robots.txt')).toBe(true);
    expect(isAssetRequest('/')).toBe(false);
    expect(isAssetRequest('/clients/cl_abc')).toBe(false);
    expect(isAssetRequest('/jobs/job_abc_accounts')).toBe(false);
    expect(isAssetRequest('/settings')).toBe(false);
  });
});

describe('spaFallback (mounted the way server/index.mjs mounts it)', () => {
  let dist;
  let server;
  let baseUrl;

  beforeAll(async () => {
    dist = mkdtempSync(path.join(tmpdir(), 'spa-fallback-'));
    mkdirSync(path.join(dist, 'assets'));
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
    writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log("hi")');
    const app = express();
    app.get('/api/ping', (_req, res) => res.json({ ok: true }));
    app.use(express.static(dist, { index: false }));
    app.get('/{*splat}', spaFallback(dist));
    app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dist, { recursive: true, force: true });
  });

  it('answers a client-side route with index.html, uncached', async () => {
    const res = await fetch(`${baseUrl}/clients/cl_abc`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('<title>app</title>');
  });

  it('serves an asset that exists', async () => {
    const res = await fetch(`${baseUrl}/assets/app-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
  });

  it('answers a missing asset with a JSON 404, never index.html', async () => {
    for (const missing of ['/assets/app-old999.js', '/assets/style-old.css', '/favicon.ico', '/site.webmanifest']) {
      const res = await fetch(`${baseUrl}${missing}`);
      expect(res.status, missing).toBe(404);
      expect(res.headers.get('content-type'), missing).toMatch(/application\/json/);
      expect(await res.json()).toEqual({ error: 'Not found', path: missing });
    }
  });

  it('leaves API paths to the API (a live one answers, an unknown one is a JSON 404)', async () => {
    expect((await (await fetch(`${baseUrl}/api/ping`)).json())).toEqual({ ok: true });
    const res = await fetch(`${baseUrl}/api/nothing-here`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found', path: '/api/nothing-here' });
  });
});
