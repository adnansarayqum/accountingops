import type { Client, ClientIdentifier, IsoDateTime } from '../domain/types';
import { normaliseCompanyNumber } from '../domain/companyNumber';

/** How old a client's Companies House data may be before it's re-pulled. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Most clients to sync in one pass, so a first run over a large roster doesn't fire hundreds of requests at once. */
export const BATCH_SIZE = 8;

/** Simultaneous lookups. Companies House allows 600 requests per 5 minutes; this stays far below that. */
export const CONCURRENCY = 3;

export interface SyncCandidate {
  clientId: string;
  companyNumber: string;
}

/**
 * The clients worth re-pulling right now: limited companies with a company
 * number, never synced or synced longer ago than STALE_AFTER_MS, oldest
 * first so nothing is starved by a large roster. Pure, so the batching rules
 * are testable without a store, a clock or a network.
 */
export function findStaleClients(
  clients: Client[],
  identifiers: ClientIdentifier[],
  now: Date,
  opts: { staleAfterMs?: number; limit?: number } = {},
): SyncCandidate[] {
  const staleAfterMs = opts.staleAfterMs ?? STALE_AFTER_MS;
  const limit = opts.limit ?? BATCH_SIZE;
  const numberByClient = new Map<string, string>();
  for (const id of identifiers) {
    // Normalised at lookup time as well as at import, so a number stored before
    // leading zeros were preserved still finds its company.
    if (id.kind === 'company_number' && id.value.trim()) numberByClient.set(id.clientId, normaliseCompanyNumber(id.value));
  }

  return clients
    .filter((c) => numberByClient.has(c.id))
    .filter((c) => isStale(c.companiesHouseSyncedAt, now, staleAfterMs))
    .sort((a, b) => syncedMs(a.companiesHouseSyncedAt) - syncedMs(b.companiesHouseSyncedAt))
    .slice(0, limit)
    .map((c) => ({ clientId: c.id, companyNumber: numberByClient.get(c.id)! }));
}

function isStale(syncedAt: IsoDateTime | undefined, now: Date, staleAfterMs: number): boolean {
  if (!syncedAt) return true;
  return now.getTime() - new Date(syncedAt).getTime() >= staleAfterMs;
}

/** Never-synced sorts first; an unparseable timestamp is treated as never-synced rather than throwing. */
function syncedMs(syncedAt: IsoDateTime | undefined): number {
  if (!syncedAt) return 0;
  const ms = new Date(syncedAt).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Runs `fn` over `items` with at most `limit` in flight at once. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
