import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

/** The automation routes over a real local HTTP server, with sign-in, the runner and the ledger faked. */
const fake = vi.hoisted(() => ({ result: null, runs: [], activity: [], acked: [], events: [], unknown: [] }));

vi.mock('../auth.mjs', () => ({
  requireAuth: (req, res, next) => {
    const user = req.get('x-test-user');
    if (!user) return res.status(401).json({ error: 'not_authenticated' });
    req.user = { id: user, username: user, role: req.get('x-test-role') ?? 'owner' };
    next();
  },
}));
vi.mock('../../lib/securityAudit.mjs', () => ({ recordSecurityEvent: vi.fn(async (event) => void fake.events.push(event.action)) }));
vi.mock('../../lib/automationScheduler.mjs', () => ({ automationDeps: () => ({ getProvider: () => ({ name: 'postmark', simulated: false }) }) }));
vi.mock('../../lib/automationRunner.mjs', () => ({
  usableProvider: (get) => ({ provider: get(), problem: null }),
  runAutomation: vi.fn(async (options) => {
    fake.runs.push(options);
    return fake.result;
  }),
}));
vi.mock('../../lib/automationStore.mjs', () => ({
  pendingActivity: vi.fn(async () => fake.activity),
  markActivityApplied: vi.fn(async (ids) => {
    fake.acked.push(ids);
    return ids.length;
  }),
  unknownReminders: vi.fn(async () => fake.unknown),
}));

const { default: router } = await import('../automation.mjs');

let server;
let baseUrl;
const originalUrl = process.env.DATABASE_URL;
const asOwner = { 'x-test-user': 'u_ray', 'x-test-role': 'owner' };

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

const planned = { jobId: 'job_1', clientName: 'Brown Property Ltd', jobName: 'Accounts', dueDate: '2026-10-14', stage: 'Email (30 days)', to: 'a@example.com', contactName: 'Alex', subject: 'S', body: 'B', sender: 'Ray', secret: 'must not leak' };

beforeAll(async () => {
  const app = express();
  app.use('/api/automation', router);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://fake-for-route-tests/none';
  fake.result = { status: 'preview', plan: { enabled: true, timezone: 'Europe/London', workingHours: true, due: [planned], waiting: [1, 2], needsYou: [{ jobId: 'job_2', clientName: 'Smith', jobName: 'VAT', stage: 'Phone call', reason: 'not_an_email_step', extra: 'x' }] }, sent: [], failed: [], unknown: [] };
});
afterEach(() => {
  fake.runs.length = 0;
  fake.acked.length = 0;
  fake.events.length = 0;
  fake.activity = [];
  fake.unknown = [];
});
afterAll(async () => {
  process.env.DATABASE_URL = originalUrl;
  await new Promise((resolve) => server.close(resolve));
});

describe('availability', () => {
  it('needs a signed-in user and a database', async () => {
    expect((await request('GET', '/api/automation/status')).status).toBe(401);
    delete process.env.DATABASE_URL;
    expect((await request('GET', '/api/automation/status', undefined, asOwner)).status).toBe(503);
  });
});

describe('status and preview', () => {
  it('reports what would go and what needs a person, without sending, and without leaking more than it should', async () => {
    fake.unknown = [{ id: 'arm_1' }];
    const res = await request('GET', '/api/automation/status', undefined, asOwner);
    expect(res.status).toBe(200);
    expect(fake.runs).toEqual([{ dryRun: true }]);
    expect(res.body).toMatchObject({ status: 'preview', enabled: true, workingHours: true, waiting: 2, emailReady: true, unknown: 1, hours: { timezone: 'Europe/London' } });
    expect(res.body.due).toEqual([expect.objectContaining({ clientName: 'Brown Property Ltd', to: 'a@example.com' })]);
    expect(JSON.stringify(res.body)).not.toContain('must not leak');
    expect(res.body.needsYou).toEqual([{ jobId: 'job_2', clientName: 'Smith', jobName: 'VAT', stage: 'Phone call', reason: 'not_an_email_step' }]);
  });

  it('previews on demand, still sending nothing', async () => {
    const res = await request('POST', '/api/automation/preview', {}, asOwner);
    expect(res.status).toBe(200);
    expect(fake.runs).toEqual([{ dryRun: true }]);
  });
});

describe('POST /run-now', () => {
  beforeEach(() => {
    fake.result = { status: 'done', plan: { enabled: true, timezone: 'Europe/London', workingHours: true, due: [], waiting: [], needsYou: [] }, sent: [{ clientName: 'Brown Property Ltd', jobName: 'Accounts', stage: 'Email (30 days)', body: 'private' }], failed: [], unknown: [] };
  });

  it('sends what is due, says what went, and leaves a record of who asked', async () => {
    const res = await request('POST', '/api/automation/run-now', {}, asOwner);
    expect(res.status).toBe(200);
    expect(fake.runs).toEqual([{ ignoreHours: false }]);
    expect(res.body.sent).toEqual([{ clientName: 'Brown Property Ltd', jobName: 'Accounts', stage: 'Email (30 days)' }]);
    expect(fake.events).toEqual(['automation.run_now']);
  });

  it('only skips the working-hours rule when explicitly told to', async () => {
    await request('POST', '/api/automation/run-now', { ignoreHours: 'yes' }, asOwner);
    await request('POST', '/api/automation/run-now', { ignoreHours: true }, { ...asOwner, 'x-test-user': 'u_two' });
    expect(fake.runs).toEqual([{ ignoreHours: false }, { ignoreHours: true }]);
  });

  it('is refused to people who cannot change practice settings', async () => {
    const res = await request('POST', '/api/automation/run-now', {}, { 'x-test-user': 'u_staff', 'x-test-role': 'staff' });
    expect(res.status).toBe(403);
    expect(fake.runs).toEqual([]);
  });

  it('caps how often one person can send to clients', async () => {
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await request('POST', '/api/automation/run-now', {}, { 'x-test-user': 'u_limit', 'x-test-role': 'owner' })).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe('activity hand-off', () => {
  it('lists what was sent and acknowledges only ids that are given as a list', async () => {
    fake.activity = [{ id: 'arm_1', jobId: 'job_1' }];
    expect((await request('GET', '/api/automation/activity', undefined, asOwner)).body).toEqual({ activity: [{ id: 'arm_1', jobId: 'job_1' }] });
    expect((await request('POST', '/api/automation/activity/ack', { ids: ['arm_1'] }, asOwner)).body).toEqual({ applied: 1 });
    expect((await request('POST', '/api/automation/activity/ack', { ids: 'arm_1' }, asOwner)).body).toEqual({ applied: 0 });
    expect(fake.acked).toEqual([['arm_1'], []]);
  });
});
