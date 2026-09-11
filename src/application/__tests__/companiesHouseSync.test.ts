import { describe, expect, it } from 'vitest';
import { findStaleClients, mapWithConcurrency, STALE_AFTER_MS } from '../companiesHouseSync';
import type { Client, ClientIdentifier } from '../../domain/types';

const now = new Date('2026-09-11T12:00:00.000Z');
const practiceId = 'prac_test';

function client(id: string, companiesHouseSyncedAt?: string): Client {
  return {
    id,
    practiceId,
    name: id,
    type: 'limited_company',
    lifecycle: 'active',
    ownerUserId: 'u_adnan',
    primaryContactId: `ct_${id}`,
    preferredChannel: 'email',
    averageResponseDays: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    companiesHouseSyncedAt,
  };
}

function companyNumber(clientId: string, value: string): ClientIdentifier {
  return { id: `idf_${clientId}`, practiceId, clientId, kind: 'company_number', value, sensitive: false };
}

const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();

describe('findStaleClients', () => {
  it('looks a client up by the canonical spelling of its company number, whatever was stored', () => {
    const stale = findStaleClients([client('cl_zero')], [companyNumber('cl_zero', '8654123')], now);
    expect(stale).toEqual([{ clientId: 'cl_zero', companyNumber: '08654123' }]);
  });

  it('picks up a client that has never been synced', () => {
    const stale = findStaleClients([client('cl_1')], [companyNumber('cl_1', '12345678')], now);
    expect(stale).toEqual([{ clientId: 'cl_1', companyNumber: '12345678' }]);
  });

  it('skips a client synced within the staleness window, and picks up one past it', () => {
    const clients = [client('cl_fresh', hoursAgo(2)), client('cl_stale', hoursAgo(30))];
    const ids = [companyNumber('cl_fresh', '11111111'), companyNumber('cl_stale', '22222222')];
    const stale = findStaleClients(clients, ids, now);
    expect(stale.map((s) => s.clientId)).toEqual(['cl_stale']);
  });

  it('skips a client with no company number — there is nothing to look up', () => {
    expect(findStaleClients([client('cl_1')], [], now)).toEqual([]);
  });

  it('syncs the oldest first, so a big roster does not starve anyone', () => {
    const clients = [client('cl_b', hoursAgo(30)), client('cl_never'), client('cl_a', hoursAgo(100))];
    const ids = [companyNumber('cl_b', '2'), companyNumber('cl_never', '3'), companyNumber('cl_a', '1')];
    const stale = findStaleClients(clients, ids, now);
    expect(stale.map((s) => s.clientId)).toEqual(['cl_never', 'cl_a', 'cl_b']);
  });

  it('caps each pass to the batch limit', () => {
    const clients = Array.from({ length: 20 }, (_, i) => client(`cl_${i}`));
    const ids = clients.map((c, i) => companyNumber(c.id, String(i)));
    expect(findStaleClients(clients, ids, now, { limit: 5 })).toHaveLength(5);
  });

  it('treats a client synced exactly at the window boundary as stale', () => {
    const at = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
    const stale = findStaleClients([client('cl_1', at)], [companyNumber('cl_1', '12345678')], now);
    expect(stale).toHaveLength(1);
  });
});

describe('mapWithConcurrency', () => {
  it('runs every item and keeps results in order', async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });
});
