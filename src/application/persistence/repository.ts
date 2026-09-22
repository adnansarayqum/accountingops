import type { PracticeData } from '../../domain/types';

/**
 * Persistence boundary. This build uses localStorage; a hosted deployment
 * will use a tenant-scoped PostgreSQL repository behind an HTTP API.
 * Nothing outside this folder should touch storage directly.
 */
export interface PracticeRepository {
  load(): Promise<PracticeData | null>;
  save(data: PracticeData): Promise<void>;
  clear(): Promise<void>;
  /**
   * Optional side-effect-free read, for a background refresh that may end up
   * discarding what it read. `load()` on a versioned repository *adopts* the
   * loaded version as the base of the next save, which is only correct when
   * the caller also adopts the loaded data. `peek()` reads without touching
   * that state; the caller invokes `adopt()` if — and only if — it really
   * takes the data. Repositories with no version to protect can omit it.
   */
  peek?(): Promise<PeekedSnapshot>;
}

export interface PeekedSnapshot {
  data: PracticeData | null;
  /**
   * Commits the read: the repository now treats `data` as what this client
   * holds. Returns false — and changes nothing — when the read went stale
   * while in flight (the repository saved or adopted something newer).
   */
  adopt(): boolean;
}

/** `repo.peek()` when the repository has one, otherwise a plain `load()` with nothing to defer. */
export async function peekSnapshot(repo: PracticeRepository): Promise<PeekedSnapshot> {
  if (repo.peek) return repo.peek();
  return { data: await repo.load(), adopt: () => true };
}

/** Bump when the persisted shape changes so stale snapshots are discarded. */
export const SCHEMA_VERSION = 5;
