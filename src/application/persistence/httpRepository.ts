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
    if (res.status === 404) return null;
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
