import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAccountingReferenceDate, getCompanyProfile, searchCompanies } from '../companiesHouse';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchCompanies', () => {
  it('falls back to the demo dataset when the proxy reports not configured (503)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_configured' }), { status: 503 })));
    const res = await searchCompanies('harbour');
    expect(res.source).toBe('demo');
    expect(res.results[0].title).toBe('HARBOUR CYCLES LTD');
  });

  it('falls back to the demo dataset when the network call throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const res = await searchCompanies('harbour');
    expect(res.source).toBe('demo');
  });

  it('passes through a live response unchanged', async () => {
    const live = { results: [{ companyNumber: '1', title: 'LIVE LTD', companyStatus: 'active', companyType: 'ltd', dateOfCreation: null, addressSnippet: null }], totalResults: 1, source: 'companies_house' as const };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(live), { status: 200 })));
    const res = await searchCompanies('live');
    expect(res).toEqual(live);
  });

  it('never calls fetch for a query below the minimum length', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await searchCompanies('h');
    expect(res.results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('getCompanyProfile', () => {
  it('falls back to the demo profile when not configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_configured' }), { status: 503 })));
    const profile = await getCompanyProfile('14829301');
    expect(profile?.source).toBe('demo');
    expect(profile?.companyName).toBe('HARBOUR CYCLES LTD');
  });
});

describe('formatAccountingReferenceDate', () => {
  it('formats a day/month pair as a readable date', () => {
    expect(formatAccountingReferenceDate({ day: '31', month: '03' })).toBe('31 March');
    expect(formatAccountingReferenceDate({ day: '1', month: '12' })).toBe('1 December');
  });
  it('returns undefined for null', () => {
    expect(formatAccountingReferenceDate(null)).toBeUndefined();
  });
});
