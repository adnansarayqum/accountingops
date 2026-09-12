import { describe, expect, it, vi } from 'vitest';
import { baseUrl, fetchVatObligations, hmrcFetch, HmrcError, isHmrcConfigured, isSandbox, PRODUCTION_BASE_URL, SANDBOX_BASE_URL, VAT_ACCEPT } from '../client.mjs';
import { buildFraudPreventionHeaders } from '../fraudPreventionHeaders.mjs';

const fraudHeaders = buildFraudPreventionHeaders({
  device: { userAgent: 'UA', deviceId: 'id', timezone: 'UTC+00:00', screens: [{ width: 1, height: 1 }], windowSize: { width: 1, height: 1 } },
  clientPublicIp: '203.0.113.7',
  clientPublicPort: 1234,
  vendorPublicIp: '198.51.100.4',
  forwarded: [{ by: '198.51.100.4', for: '203.0.113.7' }],
  productName: 'App',
  vendorVersion: { app: '1.0.0' },
  licenseIds: { app: 'none' },
  userIds: { app: 'u1' },
  multiFactor: [],
});

const ok = (body) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
const fail = (status, body) => ({ ok: false, status, json: async () => body, headers: { get: () => 'corr-1' } });

describe('environment selection', () => {
  it('defaults to the sandbox — production has to be asked for explicitly', () => {
    expect(baseUrl({})).toBe(SANDBOX_BASE_URL);
    expect(baseUrl({ HMRC_ENVIRONMENT: 'sandbox' })).toBe(SANDBOX_BASE_URL);
    expect(isSandbox({})).toBe(true);
  });

  it('uses production only when named exactly', () => {
    expect(baseUrl({ HMRC_ENVIRONMENT: 'production' })).toBe(PRODUCTION_BASE_URL);
    expect(isSandbox({ HMRC_ENVIRONMENT: 'production' })).toBe(false);
    // A typo must not silently point live traffic at production.
    expect(baseUrl({ HMRC_ENVIRONMENT: 'Production ' })).toBe(SANDBOX_BASE_URL);
  });

  it('is unconfigured without both halves of the credential', () => {
    expect(isHmrcConfigured({})).toBe(false);
    expect(isHmrcConfigured({ HMRC_CLIENT_ID: 'a' })).toBe(false);
    expect(isHmrcConfigured({ HMRC_CLIENT_ID: 'a', HMRC_CLIENT_SECRET: 'b' })).toBe(true);
  });
});

describe('hmrcFetch', () => {
  it('sends the versioned Accept header, the bearer token and every fraud header', async () => {
    const fetchImpl = vi.fn(async () => ok({ obligations: [] }));
    await hmrcFetch('/organisations/vat/123456789/obligations?status=O', { accessToken: 'tok', fraudHeaders, fetchImpl, env: {} });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${SANDBOX_BASE_URL}/organisations/vat/123456789/obligations?status=O`);
    expect(init.headers.Accept).toBe(VAT_ACCEPT);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Gov-Client-Connection-Method']).toBe('WEB_APP_VIA_SERVER');
    expect(init.headers['Gov-Vendor-Version']).toBe('app=1.0.0');
  });

  it('refuses to call HMRC at all with an incomplete fraud header set', async () => {
    const fetchImpl = vi.fn();
    await expect(hmrcFetch('/x', { accessToken: 't', fraudHeaders: { 'Gov-Client-Device-ID': 'only-one' }, fetchImpl, env: {} })).rejects.toMatchObject({ code: 'fraud_headers_incomplete' });
    // The point: nothing was spent finding this out.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('names what was missing, so the gap is fixable', async () => {
    const err = await hmrcFetch('/x', { accessToken: 't', fraudHeaders: {}, fetchImpl: vi.fn(), env: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(HmrcError);
    expect(err.detail.missing).toContain('Gov-Client-Screens');
  });

  it('passes a sandbox test scenario through', async () => {
    const fetchImpl = vi.fn(async () => ok({ obligations: [] }));
    await hmrcFetch('/x', { accessToken: 't', fraudHeaders, testScenario: 'QUARTERLY_NONE_MET', fetchImpl, env: {} });
    expect(fetchImpl.mock.calls[0][1].headers['Gov-Test-Scenario']).toBe('QUARTERLY_NONE_MET');
  });

  it('never sends a test scenario at production, where it would be meaningless', async () => {
    const fetchImpl = vi.fn(async () => ok({ obligations: [] }));
    await hmrcFetch('/x', { accessToken: 't', fraudHeaders, testScenario: 'QUARTERLY_NONE_MET', fetchImpl, env: { HMRC_ENVIRONMENT: 'production' } });
    expect(fetchImpl.mock.calls[0][1].headers['Gov-Test-Scenario']).toBeUndefined();
  });

  it('maps HMRC’s error bodies onto this app’s vocabulary, keeping the correlation id for support', async () => {
    const err = await hmrcFetch('/x', { accessToken: 't', fraudHeaders, fetchImpl: async () => fail(403, { code: 'CLIENT_OR_AGENT_NOT_AUTHORISED' }), env: {} }).catch((e) => e);
    expect(err.code).toBe('client_not_authorised');
    expect(err.status).toBe(403);
    expect(err.detail.correlationId).toBe('corr-1');
  });

  it('reports a timeout as a timeout rather than an unreachable host', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const err = await hmrcFetch('/x', { accessToken: 't', fraudHeaders, fetchImpl: async () => { throw timeout; }, env: {} }).catch((e) => e);
    expect(err.code).toBe('upstream_timeout');
  });

  it('reports an unreachable host', async () => {
    const err = await hmrcFetch('/x', { accessToken: 't', fraudHeaders, fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, env: {} }).catch((e) => e);
    expect(err.code).toBe('upstream_unreachable');
  });
});

describe('fetchVatObligations', () => {
  it('asks for open obligations with no date range and returns them mapped', async () => {
    const fetchImpl = vi.fn(async () => ok({ obligations: [{ start: '2026-01-01', end: '2026-03-31', due: '2026-05-07', status: 'O', periodKey: '26A1' }] }));
    const result = await fetchVatObligations('123456789', { accessToken: 't', fraudHeaders, fetchImpl, env: {} });

    expect(fetchImpl.mock.calls[0][0]).toContain('/organisations/vat/123456789/obligations?status=O');
    expect(result).toEqual([{ periodStart: '2026-01-01', periodEnd: '2026-03-31', dueDate: '2026-05-07', periodKey: '26A1', fulfilled: false, receivedOn: null }]);
  });

  it('never substitutes sample data — a VAT deadline is not something to approximate', async () => {
    await expect(fetchVatObligations('123456789', { accessToken: 't', fraudHeaders, fetchImpl: async () => fail(503, { code: 'SERVER_ERROR' }), env: {} })).rejects.toMatchObject({ code: 'upstream_error' });
  });
});
