import type { PracticeData } from '../../domain/types';
import type { PracticeRepository } from './repository';

/**
 * Thrown by save() when the server refused the write because the stored
 * snapshot has moved on since this client loaded it. Carries the snapshot
 * that is actually stored, so the store can rebuild its change on top of
 * it without another round trip.
 */
export class SnapshotConflictError extends Error {
  constructor(
    public readonly current: PracticeData,
    public readonly version: number,
  ) {
    super('Someone else saved a newer version of the practice.');
    this.name = 'SnapshotConflictError';
  }
}

/**
 * Server-backed persistence used once a signed-in session exists (see
 * src/App.tsx) — every mutation is saved to the shared database instead of
 * the browser's own localStorage, so Adnan, Farhan and Raihan see the same
 * practice data from their own devices.
 *
 * Every snapshot carries a version. load() remembers it; save() sends it
 * as the version this write was built on, and the server refuses the write
 * (409, with the newer snapshot) if someone else saved in between — see
 * server/routes/practiceData.mjs.
 */
export class HttpRepository implements PracticeRepository {
  /** Version of the snapshot this client last loaded or saved; 0 before anything is stored. */
  private version = 0;

  currentVersion(): number {
    return this.version;
  }

  async load(): Promise<PracticeData | null> {
    const res = await fetch('/api/practice-data', { credentials: 'include' });
    if (res.status === 404) {
      // Only the practice-data route's own "nothing saved yet" answer means
      // a brand-new practice. Any other 404 (the router unmounted, a wrong
      // deploy, a proxy in the way) is a failure — treating it as "new"
      // would hand the user an empty practice with the real one intact but
      // out of reach, one save away from being overwritten.
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === 'not_found') {
        this.version = 0;
        return null;
      }
      throw new Error("Couldn't load practice data.");
    }
    if (!res.ok) throw new Error("Couldn't load practice data.");
    const body = (await res.json()) as { data: PracticeData; version?: number };
    this.version = body.version ?? 0;
    return body.data;
  }

  async save(data: PracticeData): Promise<void> {
    const res = await fetch('/api/practice-data', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, expectedVersion: this.version }),
    });
    if (res.status === 409) {
      const body = (await res.json()) as { version: number; data: PracticeData };
      this.version = body.version;
      throw new SnapshotConflictError(body.data, body.version);
    }
    if (!res.ok) throw new Error("Couldn't save practice data.");
    const body = (await res.json()) as { version?: number };
    if (typeof body.version === 'number') this.version = body.version;
  }

  async clear(): Promise<void> {
    // No hard-delete endpoint — a subsequent save() overwrites the snapshot.
  }
}
