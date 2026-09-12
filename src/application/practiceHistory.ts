import type { PracticeData } from '../domain/types';

export interface SnapshotVersion {
  version: number;
  savedBy: string | null;
  savedAt: string;
}

export interface SnapshotHistory {
  /** The version currently stored — what a restore must name as its `expectedVersion`. */
  current: number;
  /** Newest first. */
  versions: SnapshotVersion[];
}

/** The versions of the shared practice still on file. Server mode only. */
export async function fetchSnapshotHistory(): Promise<SnapshotHistory> {
  const res = await fetch('/api/practice-data/history', { credentials: 'include' });
  if (!res.ok) throw new Error("Couldn't load the version history.");
  return (await res.json()) as SnapshotHistory;
}

/**
 * Brings an earlier version back as a new version on top of the current
 * one. `expectedVersion` is the version this browser currently holds; the
 * server refuses the restore if someone has saved since, the same as any
 * other stale write.
 */
export async function restoreSnapshotVersion(version: number, expectedVersion: number): Promise<{ version: number; data: PracticeData }> {
  const res = await fetch('/api/practice-data/restore', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, expectedVersion }),
  });
  if (res.status === 409) throw new Error('Someone else has saved since you last loaded — reload and try again.');
  if (!res.ok) throw new Error("Couldn't restore that version.");
  return (await res.json()) as { version: number; data: PracticeData };
}
