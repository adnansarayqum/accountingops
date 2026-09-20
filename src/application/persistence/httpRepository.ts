import type { PracticeData } from '../../domain/types';
import { normalizePracticeData } from '../emptyState';
import type { PeekedSnapshot, PracticeRepository } from './repository';

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
 * Thrown by save() when the server understood the write and refused it for
 * this user's role — e.g. it changes the practice's settings or the team, and
 * only an owner (or manager) may. Retrying cannot help, and neither can
 * replaying onto a newer snapshot: the store drops the change and reloads.
 */
export class SnapshotForbiddenError extends Error {
  constructor(public readonly permission: string) {
    super("Your role isn't allowed to make that change.");
    this.name = 'SnapshotForbiddenError';
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

  /**
   * Bumped whenever this repository's idea of the stored version changes
   * (a save landing, a conflict, an adopted read). A read remembers the
   * value it started under and may only be adopted if it is unchanged —
   * otherwise it is older than something this client already knows about.
   */
  private generation = 0;

  currentVersion(): number {
    return this.version;
  }

  private setVersion(version: number): void {
    this.version = version;
    this.generation += 1;
  }

  /**
   * Reads the stored snapshot WITHOUT changing the version the next save
   * will be based on. The version only advances when the caller adopts the
   * read: a caller that throws the data away (a refresh that lost a race to
   * a local edit) must not leave behind a version newer than any data it
   * holds, or its next save would pass the server's conflict check while
   * silently overwriting the changes it never saw.
   */
  async peek(): Promise<PeekedSnapshot> {
    const startedUnder = this.generation;
    const { data, version } = await this.fetchStored();
    return {
      data,
      adopt: () => {
        if (this.generation !== startedUnder) return false;
        this.setVersion(version);
        return true;
      },
    };
  }

  /** Reads and adopts in one step — for the initial load, where there is nothing local to lose. */
  async load(): Promise<PracticeData | null> {
    const { data, version } = await this.fetchStored();
    this.setVersion(version);
    return data;
  }

  private async fetchStored(): Promise<{ data: PracticeData | null; version: number }> {
    const res = await fetch('/api/practice-data', { credentials: 'include' });
    if (res.status === 404) {
      // Only the practice-data route's own "nothing saved yet" answer means
      // a brand-new practice. Any other 404 (the router unmounted, a wrong
      // deploy, a proxy in the way) is a failure — treating it as "new"
      // would hand the user an empty practice with the real one intact but
      // out of reach, one save away from being overwritten.
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === 'not_found') return { data: null, version: 0 };
      throw new Error("Couldn't load practice data.");
    }
    if (!res.ok) throw new Error("Couldn't load practice data.");
    const body = (await res.json()) as { data: PracticeData; version?: number };
    // A snapshot saved before this build's newest collection existed
    // otherwise comes back missing it — see normalizePracticeData.
    return { data: normalizePracticeData(body.data), version: body.version ?? 0 };
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
      this.setVersion(body.version);
      throw new SnapshotConflictError(normalizePracticeData(body.data), body.version);
    }
    if (res.status === 403) {
      const denied = (await res.json().catch(() => null)) as { error?: string; permission?: string } | null;
      if (denied?.error === 'forbidden') throw new SnapshotForbiddenError(denied.permission ?? 'unknown');
    }
    if (!res.ok) throw new Error("Couldn't save practice data.");
    const body = (await res.json()) as { version?: number };
    if (typeof body.version === 'number') this.setVersion(body.version);
  }

  async clear(): Promise<void> {
    // No hard-delete endpoint — a subsequent save() overwrites the snapshot.
  }
}
