import type { PracticeData } from '../../domain/types';

/**
 * Persistence boundary. The demo uses localStorage; production will use a
 * tenant-scoped PostgreSQL repository behind an HTTP API. Nothing outside
 * this folder should touch storage directly.
 */
export interface PracticeRepository {
  load(): Promise<PracticeData | null>;
  save(data: PracticeData): Promise<void>;
  clear(): Promise<void>;
}

/** Bump when the persisted shape changes so stale demo snapshots are discarded. */
export const SCHEMA_VERSION = 4;
