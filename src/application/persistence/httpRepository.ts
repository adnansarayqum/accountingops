import type { PracticeData } from '../../domain/types';
import type { PracticeRepository } from './repository';

/**
 * Server-backed persistence used once a signed-in session exists (see
 * src/App.tsx) — every mutation is saved to the shared database instead of
 * the browser's own localStorage, so Adnan, Farhan and Raihan see the same
 * practice data from their own devices.
 */
export class HttpRepository implements PracticeRepository {
  async load(): Promise<PracticeData | null> {
    const res = await fetch('/api/practice-data', { credentials: 'include' });
    if (res.status === 404) {
      // Only the practice-data route's own "nothing saved yet" answer means
      // a brand-new practice. Any other 404 (the router unmounted, a wrong
      // deploy, a proxy in the way) is a failure — treating it as "new"
      // would hand the user an empty practice with the real one intact but
      // out of reach, one save away from being overwritten.
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === 'not_found') return null;
      throw new Error("Couldn't load practice data.");
    }
    if (!res.ok) throw new Error("Couldn't load practice data.");
    const body = (await res.json()) as { data: PracticeData };
    return body.data;
  }

  async save(data: PracticeData): Promise<void> {
    const res = await fetch('/api/practice-data', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) throw new Error("Couldn't save practice data.");
  }

  async clear(): Promise<void> {
    // No hard-delete endpoint — a subsequent save() overwrites the snapshot.
  }
}
