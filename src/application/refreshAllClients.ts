import type { Client, ClientIdentifier } from '../domain/types';
import type { CompanyPeopleResponse, CompanyProfile } from '../integrations/companiesHouseTypes';
import { CONCURRENCY, findStaleClients, mapWithConcurrency, type SyncCandidate } from './companiesHouseSync';

/**
 * "Refresh all from Companies House" — every limited company with a company
 * number, whether or not its data is stale, in one deliberate pass. The
 * background sync (useCompaniesHouseSync) does the same a few clients at
 * a time over hours; this is for when someone wants the whole roster
 * brought up to date now, e.g. right after a change in what a refresh
 * records (identity verification), without visiting every client.
 *
 * Paced to stay under the proxy's per-address rate limit (sixty lookups a
 * minute; each client is two — profile and people): at most
 * CLIENTS_PER_MINUTE clients start in any one minute. A rate-limited lookup
 * waits out the rest of the minute and tries once more before being
 * counted as failed.
 */
export const CLIENTS_PER_MINUTE = 25;
const MINUTE_MS = 60 * 1000;

export interface RefreshAllProgress {
  done: number;
  total: number;
  /** Set while sitting out the rate limit: when (epoch ms) lookups resume. */
  pausedUntil?: number;
}

export interface RefreshAllUpdate {
  clientId: string;
  profile: CompanyProfile;
  people: CompanyPeopleResponse | null;
}

export type LookupFailure = 'not_found' | 'rate_limited' | 'unavailable';

export interface RefreshAllResult {
  total: number;
  refreshed: number;
  failed: { clientId: string; companyNumber: string; reason: LookupFailure }[];
  peopleAdded: number;
  verificationsConfirmed: number;
}

export type LookupOutcome = { ok: true; profile: CompanyProfile; people: CompanyPeopleResponse | null } | { ok: false; reason: LookupFailure };

export interface RefreshAllDeps {
  /** One client's profile and people — reports what went wrong rather than substituting sample data. */
  lookup: (companyNumber: string) => Promise<LookupOutcome>;
  /** Applies every successful lookup as one change. */
  apply: (updates: RefreshAllUpdate[]) => { peopleAdded: number; verificationsConfirmed: number };
  onProgress?: (progress: RefreshAllProgress) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Every client a refresh-all would touch: limited companies with a company number, freshness ignored. */
export function findAllSyncableClients(clients: Client[], identifiers: ClientIdentifier[]): SyncCandidate[] {
  return findStaleClients(clients, identifiers, new Date(), { staleAfterMs: 0, limit: Infinity });
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function refreshAllClients(candidates: SyncCandidate[], deps: RefreshAllDeps): Promise<RefreshAllResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => Date.now());
  const result: RefreshAllResult = { total: candidates.length, refreshed: 0, failed: [], peopleAdded: 0, verificationsConfirmed: 0 };
  if (candidates.length === 0) return result;

  const updates: RefreshAllUpdate[] = [];
  let done = 0;
  const total = candidates.length;
  deps.onProgress?.({ done, total });

  // A pause is always announced: a button that just sits on "25 of 27" for
  // most of a minute looks stuck, when it is simply keeping under the limit.
  const pause = async (ms: number) => {
    if (ms <= 0) return;
    deps.onProgress?.({ done, total, pausedUntil: now() + ms });
    await sleep(ms);
    deps.onProgress?.({ done, total });
  };

  for (let start = 0; start < candidates.length; start += CLIENTS_PER_MINUTE) {
    const chunk = candidates.slice(start, start + CLIENTS_PER_MINUTE);
    const chunkStartedAt = now();
    await mapWithConcurrency(chunk, CONCURRENCY, async (candidate) => {
      let outcome = await deps.lookup(candidate.companyNumber);
      if (!outcome.ok && outcome.reason === 'rate_limited') {
        // Sit out the rest of this minute's allowance, then one more try.
        await pause(MINUTE_MS - (now() - chunkStartedAt));
        outcome = await deps.lookup(candidate.companyNumber);
      }
      if (outcome.ok) {
        updates.push({ clientId: candidate.clientId, profile: outcome.profile, people: outcome.people });
        result.refreshed += 1;
      } else {
        result.failed.push({ clientId: candidate.clientId, companyNumber: candidate.companyNumber, reason: outcome.reason });
      }
      done += 1;
      deps.onProgress?.({ done, total });
    });
    const remaining = start + CLIENTS_PER_MINUTE < candidates.length;
    if (remaining) await pause(MINUTE_MS - (now() - chunkStartedAt));
  }

  if (updates.length > 0) {
    const applied = deps.apply(updates);
    result.peopleAdded = applied.peopleAdded;
    result.verificationsConfirmed = applied.verificationsConfirmed;
  }
  return result;
}
