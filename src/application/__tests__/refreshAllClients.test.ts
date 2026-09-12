import { describe, expect, it, vi } from 'vitest';
import { CLIENTS_PER_MINUTE, findAllSyncableClients, refreshAllClients, type LookupOutcome, type RefreshAllUpdate } from '../refreshAllClients';
import type { Client, ClientIdentifier } from '../../domain/types';
import type { CompanyProfile } from '../../integrations/companiesHouseTypes';

const client = (id: string, syncedAt?: string): Client => ({ id, practiceId: 'p', name: id, type: 'limited_company', ownerUserId: 'u', companiesHouseSyncedAt: syncedAt }) as Client;
const companyNumber = (clientId: string, value: string): ClientIdentifier => ({ id: `id_${clientId}`, practiceId: 'p', clientId, kind: 'company_number', value }) as unknown as ClientIdentifier;
const profile = (companyNumber: string): CompanyProfile => ({ companyNumber, companyName: `Company ${companyNumber}` }) as CompanyProfile;
const live = (n: string): LookupOutcome => ({ ok: true, profile: profile(n), people: null });
const candidates = (count: number) => Array.from({ length: count }, (_, i) => ({ clientId: `cl_${i}`, companyNumber: String(10000000 + i) }));

describe('findAllSyncableClients', () => {
  it('includes freshly synced clients too — freshness is the background sync\'s concern, not this one\'s', () => {
    const all = findAllSyncableClients([client('cl_fresh', new Date().toISOString()), client('cl_never'), client('cl_no_number')], [companyNumber('cl_fresh', '1'), companyNumber('cl_never', '2')]);
    expect(all.map((c) => c.clientId).sort()).toEqual(['cl_fresh', 'cl_never']);
  });
});

describe('refreshAllClients', () => {
  it('looks every client up, applies the successes as one change and reports what failed', async () => {
    const lookup = vi.fn(async (n: string): Promise<LookupOutcome> => (n === '10000001' ? { ok: false, reason: 'not_found' } : live(n)));
    const apply = vi.fn((_updates: RefreshAllUpdate[]) => ({ peopleAdded: 2, verificationsConfirmed: 1 }));
    const progress: number[] = [];
    const result = await refreshAllClients(candidates(3), { lookup, apply, onProgress: (p) => progress.push(p.done), sleep: async () => {} });

    expect(result).toEqual({ total: 3, refreshed: 2, failed: [{ clientId: 'cl_1', companyNumber: '10000001', reason: 'not_found' }], peopleAdded: 2, verificationsConfirmed: 1 });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0].map((u) => u.clientId).sort()).toEqual(['cl_0', 'cl_2']);
    expect(progress).toEqual([0, 1, 2, 3]);
  });

  it('does nothing — not even an apply — when there is nothing to refresh', async () => {
    const apply = vi.fn(() => ({ peopleAdded: 0, verificationsConfirmed: 0 }));
    const result = await refreshAllClients([], { lookup: vi.fn(), apply });
    expect(result).toEqual({ total: 0, refreshed: 0, failed: [], peopleAdded: 0, verificationsConfirmed: 0 });
    expect(apply).not.toHaveBeenCalled();
  });

  it('never applies when every lookup failed', async () => {
    const apply = vi.fn(() => ({ peopleAdded: 0, verificationsConfirmed: 0 }));
    const result = await refreshAllClients(candidates(2), { lookup: async () => ({ ok: false, reason: 'unavailable' }), apply, sleep: async () => {} });
    expect(result.failed).toHaveLength(2);
    expect(apply).not.toHaveBeenCalled();
  });

  it('paces a large roster: waits out the minute between chunks of CLIENTS_PER_MINUTE', async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const lookup = vi.fn(async (n: string) => {
      clock += 100; // each lookup takes a moment
      return live(n);
    });
    const total = CLIENTS_PER_MINUTE * 2 + 1;
    const result = await refreshAllClients(candidates(total), { lookup, apply: () => ({ peopleAdded: 0, verificationsConfirmed: 0 }), sleep, now: () => clock });
    expect(result.refreshed).toBe(total);
    // Two pauses (after chunk one and chunk two), none after the last chunk.
    expect(sleep).toHaveBeenCalledTimes(2);
    for (const [ms] of sleep.mock.calls) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(60_000);
    }
  });

  it('announces every pause, with when lookups resume, so the button can count it down', async () => {
    let clock = 1_000_000;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const progress: { done: number; pausedUntil?: number }[] = [];
    const total = CLIENTS_PER_MINUTE + 2;
    await refreshAllClients(candidates(total), {
      lookup: async (n) => live(n),
      apply: () => ({ peopleAdded: 0, verificationsConfirmed: 0 }),
      sleep,
      now: () => clock,
      onProgress: (p) => progress.push({ done: p.done, pausedUntil: p.pausedUntil }),
    });
    const paused = progress.filter((p) => p.pausedUntil !== undefined);
    expect(paused).toEqual([{ done: CLIENTS_PER_MINUTE, pausedUntil: 1_000_000 + 60_000 }]);
    // The pause is followed by a "resumed" report with no pausedUntil, then the last two.
    const afterPause = progress.slice(progress.indexOf(paused[0]) + 1);
    expect(afterPause[0]).toEqual({ done: CLIENTS_PER_MINUTE, pausedUntil: undefined });
    expect(afterPause.at(-1)).toEqual({ done: total, pausedUntil: undefined });
  });

  it('waits out the minute and retries once when the proxy rate-limits a lookup', async () => {
    let calls = 0;
    const lookup = vi.fn(async (n: string): Promise<LookupOutcome> => {
      calls += 1;
      return calls === 1 ? { ok: false, reason: 'rate_limited' } : live(n);
    });
    const sleep = vi.fn(async () => {});
    const result = await refreshAllClients(candidates(1), { lookup, apply: () => ({ peopleAdded: 0, verificationsConfirmed: 0 }), sleep, now: () => 0 });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(60_000);
    expect(result).toMatchObject({ refreshed: 1, failed: [] });
  });

  it('counts a lookup rate-limited twice as failed', async () => {
    const lookup = vi.fn(async (): Promise<LookupOutcome> => ({ ok: false, reason: 'rate_limited' }));
    const result = await refreshAllClients(candidates(1), { lookup, apply: () => ({ peopleAdded: 0, verificationsConfirmed: 0 }), sleep: async () => {}, now: () => 0 });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(result.failed).toEqual([{ clientId: 'cl_0', companyNumber: '10000000', reason: 'rate_limited' }]);
  });
});
