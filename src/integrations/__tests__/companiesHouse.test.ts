import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAccountingReferenceDate, getCompanyPeople, getCompanyProfile, lookupCompanyProfile, searchCompanies } from '../companiesHouse';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchCompanies', () => {
  it('falls back to the sample dataset when the proxy reports not configured (503)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_configured' }), { status: 503 })));
    const res = await searchCompanies('harbour');
    expect(res.source).toBe('sample');
    expect(res.results[0].title).toBe('HARBOUR CYCLES LTD');
  });

  it('falls back to the sample dataset when the network call throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const res = await searchCompanies('harbour');
    expect(res.source).toBe('sample');
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
  it('falls back to the sample profile when not configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_configured' }), { status: 503 })));
    const profile = await getCompanyProfile('14829301');
    expect(profile?.source).toBe('sample');
    expect(profile?.companyName).toBe('HARBOUR CYCLES LTD');
  });
});

describe('lookupCompanyProfile', () => {
  const answer = (status: number, body: unknown = {}) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it('says why there is no live data instead of substituting sample data', async () => {
    answer(503, { error: 'not_configured' });
    expect(await lookupCompanyProfile('14829301')).toEqual({ outcome: 'not_configured', profile: null });
    answer(404, { error: 'not_found' });
    expect(await lookupCompanyProfile('14829301')).toEqual({ outcome: 'not_found', profile: null });
    answer(429, { error: 'rate_limited' });
    expect(await lookupCompanyProfile('14829301')).toEqual({ outcome: 'rate_limited', profile: null });
    answer(502, { error: 'upstream_unreachable' });
    expect(await lookupCompanyProfile('14829301')).toEqual({ outcome: 'unavailable', profile: null });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await lookupCompanyProfile('14829301')).toEqual({ outcome: 'unavailable', profile: null });
  });

  it('gives up on a lookup that never answers, reporting it unavailable', async () => {
    // fetch is handed a timeout signal; a proxy that never replies is cut off by it.
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      expect(signal).toBeDefined();
      if (signal?.aborted) reject(signal.reason);
      signal?.addEventListener('abort', () => reject(signal.reason));
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    try {
      expect(await lookupCompanyProfile('14829301')).toEqual({ outcome: 'unavailable', profile: null });
      expect((await getCompanyPeople('14829301')).source).toBe('sample');
      expect(timeout).toHaveBeenCalledTimes(2);
    } finally {
      timeout.mockRestore();
    }
  });

  it('returns the live profile on success', async () => {
    const live = { companyNumber: '14829301', companyName: 'LIVE LTD', source: 'companies_house' };
    answer(200, live);
    const result = await lookupCompanyProfile('14829301');
    expect(result.outcome).toBe('live');
    expect(result.profile).toEqual(live);
  });
});

describe('getCompanyPeople', () => {
  it('falls back to empty sample people when not configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_configured' }), { status: 503 })));
    const people = await getCompanyPeople('14829301');
    expect(people).toEqual({ directors: [], pscs: [], source: 'sample' });
  });

  it('falls back to empty sample people when the network call throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const people = await getCompanyPeople('14829301');
    expect(people.source).toBe('sample');
  });

  it('passes through a live response unchanged', async () => {
    const live = {
      directors: [{ name: 'SMITH, Jane', role: 'director' as const, appointedOn: '2020-01-01', dateOfBirth: { month: '5', year: '1980' }, nationality: 'British', occupation: 'Director', naturesOfControl: [] }],
      pscs: [],
      source: 'companies_house' as const,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(live), { status: 200 })));
    const people = await getCompanyPeople('14829301');
    expect(people).toEqual(live);
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
