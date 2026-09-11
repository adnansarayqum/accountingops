import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import router from '../companiesHouse.mjs';

/**
 * The router is exercised over a real local HTTP server rather than by
 * calling handlers directly, so these tests cover exactly what the browser
 * (or the Vite dev middleware) actually sees: status codes, JSON shape,
 * and — critically — that no API key ever appears in a response.
 *
 * Requests to the local test server use node:http directly, not global
 * fetch, because several tests stub global fetch to intercept the route
 * handler's OWN outbound call to Companies House — stubbing fetch for that
 * must not also intercept the test's request to its own server.
 */
let server;
let baseUrl;
const originalKey = process.env.COMPANIES_HOUSE_API_KEY;

function localGet(path) {
  return new Promise((resolve, reject) => {
    http
      .get(`${baseUrl}${path}`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(data || '{}') }));
      })
      .on('error', reject);
  });
}

beforeAll(async () => {
  const app = express();
  app.use('/api/companies-house', router);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
  else process.env.COMPANIES_HOUSE_API_KEY = originalKey;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('GET /status', () => {
  it('reports not configured when no key is set', async () => {
    delete process.env.COMPANIES_HOUSE_API_KEY;
    const res = await localGet('/api/companies-house/status');
    expect(await res.json()).toEqual({ configured: false });
  });

  it('reports configured once a key is set, without ever echoing it', async () => {
    process.env.COMPANIES_HOUSE_API_KEY = 'super-secret-key';
    const res = await localGet('/api/companies-house/status');
    const body = await res.json();
    expect(body).toEqual({ configured: true });
    expect(JSON.stringify(body)).not.toContain('super-secret-key');
  });
});

describe('GET /search', () => {
  it('returns 503 not_configured when no key is set, rather than a bare 500', async () => {
    delete process.env.COMPANIES_HOUSE_API_KEY;
    const res = await localGet('/api/companies-house/search?q=harbour');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured' });
  });

  it('rejects a query below the minimum length before touching the network', async () => {
    process.env.COMPANIES_HOUSE_API_KEY = 'test-key';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await localGet('/api/companies-house/search?q=a');
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps a successful upstream response and never leaks the Authorization header', async () => {
    process.env.COMPANIES_HOUSE_API_KEY = 'test-key';
    let capturedAuth;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        capturedAuth = init.headers.Authorization;
        return new Response(JSON.stringify({ items: [{ company_number: '14829301', title: 'HARBOUR CYCLES LTD', company_status: 'active' }] }), { status: 200 });
      }),
    );
    const res = await localGet('/api/companies-house/search?q=harbour');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].companyNumber).toBe('14829301');
    expect(body.source).toBe('companies_house');
    expect(capturedAuth).toBe(`Basic ${Buffer.from('test-key:').toString('base64')}`);
    expect(JSON.stringify(body)).not.toContain('test-key');
  });

  it('maps an upstream rate limit to 429', async () => {
    process.env.COMPANIES_HOUSE_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    const res = await localGet('/api/companies-house/search?q=harbour');
    expect(res.status).toBe(429);
  });
});

describe('GET /company/:number', () => {
  it('maps a 404 from Companies House to a 404 here', async () => {
    process.env.COMPANIES_HOUSE_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const res = await localGet('/api/companies-house/company/00000001');
    expect(res.status).toBe(404);
  });

  it('returns 503 not_configured without a key', async () => {
    delete process.env.COMPANIES_HOUSE_API_KEY;
    const res = await localGet('/api/companies-house/company/14829301');
    expect(res.status).toBe(503);
  });
});

describe('GET /company/:number/people', () => {
  it('returns 503 not_configured without a key', async () => {
    delete process.env.COMPANIES_HOUSE_API_KEY;
    const res = await localGet('/api/companies-house/company/14829301/people');
    expect(res.status).toBe(503);
  });

  it('fetches officers and PSCs in parallel and maps both', async () => {
    process.env.COMPANIES_HOUSE_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url.includes('/officers')) {
          return new Response(JSON.stringify({ items: [{ name: 'SMITH, Jane', officer_role: 'director', appointed_on: '2020-01-01' }] }), { status: 200 });
        }
        if (url.includes('/persons-with-significant-control')) {
          return new Response(JSON.stringify({ items: [{ name: 'JONES, John', kind: 'individual-person-with-significant-control', notified_on: '2020-01-01' }] }), { status: 200 });
        }
        throw new Error(`unexpected url ${url}`);
      }),
    );
    const res = await localGet('/api/companies-house/company/14829301/people');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('companies_house');
    expect(body.directors).toHaveLength(1);
    expect(body.directors[0].name).toBe('SMITH, Jane');
    expect(body.pscs).toHaveLength(1);
    expect(body.pscs[0].name).toBe('JONES, John');
  });

  it('treats a 404 on the PSC endpoint as no PSCs, not a failure', async () => {
    process.env.COMPANIES_HOUSE_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url.includes('/officers')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes('/persons-with-significant-control')) return new Response('', { status: 404 });
        throw new Error(`unexpected url ${url}`);
      }),
    );
    const res = await localGet('/api/companies-house/company/14829301/people');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pscs).toEqual([]);
  });

  it('maps a 404 on the officers endpoint (invalid company) to a 404 here', async () => {
    process.env.COMPANIES_HOUSE_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const res = await localGet('/api/companies-house/company/00000001/people');
    expect(res.status).toBe(404);
  });
});
