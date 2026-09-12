import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureRepository, useAppStore } from '../store';
import type { PracticeRepository } from '../persistence/repository';
import { buildFixtureData } from '../../testing/fixtures';
import type { PracticeData } from '../../domain/types';
import { SnapshotConflictError } from '../persistence/httpRepository';

const today = '2026-09-11';

/**
 * A repository whose saves complete only when the test says so, so the
 * order and number of writes can be observed while they are in flight.
 */
class ControlledRepository implements PracticeRepository {
  stored: PracticeData | null = null;
  loadError: Error | null = null;
  saves: PracticeData[] = [];
  private settlers: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  async load(): Promise<PracticeData | null> {
    if (this.loadError) throw this.loadError;
    return this.stored;
  }

  /** When set, the next save is refused as a conflict carrying this snapshot (then cleared). */
  conflictWith: PracticeData | null = null;
  /** Or keep refusing: every save conflicts with the snapshot this returns. */
  alwaysConflictWith: (() => PracticeData) | null = null;

  save(data: PracticeData): Promise<void> {
    this.saves.push(data);
    if (this.alwaysConflictWith) return Promise.reject(new SnapshotConflictError(this.alwaysConflictWith(), 99));
    if (this.conflictWith) {
      const current = this.conflictWith;
      this.conflictWith = null;
      return Promise.reject(new SnapshotConflictError(current, 2));
    }
    return new Promise<void>((resolve, reject) => this.settlers.push({ resolve, reject }));
  }

  async clear(): Promise<void> {
    this.stored = null;
  }

  /** Complete the oldest unfinished save. */
  async settleNext(outcome: 'ok' | 'fail' = 'ok'): Promise<void> {
    const next = this.settlers.shift();
    if (!next) throw new Error('no save in flight');
    if (outcome === 'ok') next.resolve();
    else next.reject(new Error('disk full'));
    // Let the store's continuation run.
    await Promise.resolve();
    await Promise.resolve();
  }

  get inFlight(): number {
    return this.settlers.length;
  }
}

const userName = () => useAppStore.getState().data.users.find((u) => u.id === 'u_adnan')?.name;

describe('store persistence', () => {
  let repo: ControlledRepository;

  beforeEach(() => {
    repo = new ControlledRepository();
    configureRepository(repo);
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true, currentUserId: 'u_adnan', loadFailed: false, unsaved: false, toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('serialised saves', () => {
    it('sends the first save immediately and marks the change unsaved until it completes', async () => {
      useAppStore.getState().renameUser('u_adnan', 'First');
      expect(repo.saves).toHaveLength(1);
      expect(useAppStore.getState().unsaved).toBe(true);
      await repo.settleNext();
      expect(useAppStore.getState().unsaved).toBe(false);
    });

    it('never has two saves in flight, and sends only the newest snapshot once the first completes', async () => {
      useAppStore.getState().renameUser('u_adnan', 'First');
      useAppStore.getState().renameUser('u_adnan', 'Second');
      useAppStore.getState().renameUser('u_adnan', 'Third');
      // Only the first has gone out; the other two are coalesced behind it.
      expect(repo.saves).toHaveLength(1);
      expect(repo.inFlight).toBe(1);

      await repo.settleNext();
      expect(repo.saves).toHaveLength(2);
      expect(repo.saves[1].users.find((u) => u.id === 'u_adnan')?.name).toBe('Third');
      // Still unsaved until the newest snapshot has actually landed.
      expect(useAppStore.getState().unsaved).toBe(true);

      await repo.settleNext();
      expect(repo.saves).toHaveLength(2);
      expect(useAppStore.getState().unsaved).toBe(false);
    });

    it('surfaces a failed save as a toast and leaves the change marked unsaved', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      useAppStore.getState().renameUser('u_adnan', 'Unsaved Name');
      await repo.settleNext('fail');
      expect(useAppStore.getState().unsaved).toBe(true);
      expect(useAppStore.getState().toasts.map((t) => t.title)).toContain("We couldn't save that change");
      // The change itself is still on screen for the user to retry.
      expect(userName()).toBe('Unsaved Name');
      errorSpy.mockRestore();
    });

    it('carries on with the queued save after an earlier one fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      useAppStore.getState().renameUser('u_adnan', 'One');
      useAppStore.getState().renameUser('u_adnan', 'Two');
      await repo.settleNext('fail');
      expect(repo.saves).toHaveLength(2);
      await repo.settleNext();
      expect(useAppStore.getState().unsaved).toBe(false);
      errorSpy.mockRestore();
    });
  });

  describe('init()', () => {
    it('does not write anything when nothing is stored yet', async () => {
      repo.stored = null;
      useAppStore.setState({ ready: false });
      await useAppStore.getState().init();
      expect(useAppStore.getState().ready).toBe(true);
      expect(useAppStore.getState().data.clients).toEqual([]);
      expect(repo.saves).toHaveLength(0);
    });

    it('after a failed load, refuses every mutation until a retry succeeds', async () => {
      vi.useFakeTimers();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const real = buildFixtureData(today);
      repo.loadError = new Error('502 from the proxy');
      useAppStore.setState({ ready: false });

      const loading = useAppStore.getState().init();
      await vi.advanceTimersByTimeAsync(2000); // through the retry back-off
      await loading;

      const state = useAppStore.getState();
      expect(state.ready).toBe(true);
      expect(state.loadFailed).toBe(true);
      expect(state.data.clients).toEqual([]);

      // The stand-in must never reach storage.
      useAppStore.getState().renameUser('u_adnan', 'Should not persist');
      expect(repo.saves).toHaveLength(0);
      expect(useAppStore.getState().unsaved).toBe(false);
      expect(useAppStore.getState().toasts.map((t) => t.title)).toContain('Changes are paused');

      // The retry path: storage answers, the real practice comes back, and mutations work again.
      repo.loadError = null;
      repo.stored = real;
      await useAppStore.getState().init();
      expect(useAppStore.getState().loadFailed).toBe(false);
      expect(useAppStore.getState().data.clients.length).toBe(real.clients.length);
      useAppStore.getState().renameUser('u_adnan', 'Persists now');
      expect(repo.saves).toHaveLength(1);
      errorSpy.mockRestore();
    });
  });

  describe('when someone else saved first', () => {
    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };

    it('replays the unsaved change on top of their version, so both changes survive', async () => {
      // Another user renamed Farhan while this tab was renaming Adnan.
      const theirs = structuredClone(buildFixtureData(today));
      theirs.users.find((u) => u.id === 'u_sarah')!.name = 'Sarah Renamed Elsewhere';
      repo.conflictWith = theirs;

      useAppStore.getState().renameUser('u_adnan', 'Adnan Renamed Here');
      await flush();

      // The first save was refused; the second carries their change plus ours.
      expect(repo.saves).toHaveLength(2);
      const resent = repo.saves[1];
      expect(resent.users.find((u) => u.id === 'u_sarah')?.name).toBe('Sarah Renamed Elsewhere');
      expect(resent.users.find((u) => u.id === 'u_adnan')?.name).toBe('Adnan Renamed Here');
      // And that is what's on screen, still marked unsaved until it lands.
      expect(useAppStore.getState().data.users.find((u) => u.id === 'u_sarah')?.name).toBe('Sarah Renamed Elsewhere');
      expect(userName()).toBe('Adnan Renamed Here');
      expect(useAppStore.getState().unsaved).toBe(true);
      await repo.settleNext();
      expect(useAppStore.getState().unsaved).toBe(false);
      expect(useAppStore.getState().toasts).toEqual([]);
    });

    it('replays every unsaved change, not just the last one', async () => {
      const theirs = structuredClone(buildFixtureData(today));
      theirs.users.find((u) => u.id === 'u_sarah')!.name = 'Theirs';
      useAppStore.getState().renameUser('u_adnan', 'First');
      useAppStore.getState().markAllNotificationsRead();
      repo.conflictWith = theirs;
      await repo.settleNext('ok'); // first save (carrying only 'First') lands
      // The queued save (carrying the notifications change) is refused and replayed.
      await flush();
      const last = repo.saves[repo.saves.length - 1];
      expect(last.users.find((u) => u.id === 'u_sarah')?.name).toBe('Theirs');
      expect(last.notifications.every((n) => n.read)).toBe(true);
      // The already-saved rename is NOT replayed onto their copy — their copy
      // predates it, and re-applying would resurrect it only by accident; but it
      // was saved as version N and their copy is version N+1, which means they
      // overwrote it. That is the whole-snapshot model's remaining limit and is
      // why the save that lost carries the newest local state.
    });

    it('gives up after repeated conflicts, keeps their version and says so', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const theirs = structuredClone(buildFixtureData(today));
      theirs.users.find((u) => u.id === 'u_sarah')!.name = 'Always Theirs';
      repo.alwaysConflictWith = () => structuredClone(theirs);

      useAppStore.getState().renameUser('u_adnan', 'Never Lands');
      for (let i = 0; i < 8; i += 1) await flush();

      // One original attempt plus the allowed replays, then no more.
      expect(repo.saves).toHaveLength(4);
      expect(useAppStore.getState().unsaved).toBe(false);
      expect(useAppStore.getState().data.users.find((u) => u.id === 'u_sarah')?.name).toBe('Always Theirs');
      expect(userName()).not.toBe('Never Lands');
      expect(useAppStore.getState().toasts.map((t) => t.title)).toContain('Someone else changed this first');
      errorSpy.mockRestore();
    });
  });

  describe('refresh()', () => {
    it('adopts a newer stored snapshot when this tab has nothing unsaved', async () => {
      const newer = structuredClone(buildFixtureData(today)); // the fixture shares row objects between calls
      newer.users.find((u) => u.id === 'u_adnan')!.name = 'Renamed elsewhere';
      repo.stored = newer;
      expect(await useAppStore.getState().refresh()).toBe(true);
      expect(userName()).toBe('Renamed elsewhere');
    });

    it('is a no-op when the stored snapshot is identical', async () => {
      repo.stored = structuredClone(useAppStore.getState().data);
      const before = useAppStore.getState().data;
      expect(await useAppStore.getState().refresh()).toBe(false);
      expect(useAppStore.getState().data).toBe(before);
    });

    it('keeps a local change that has not finished saving', async () => {
      const newer = structuredClone(buildFixtureData(today)); // the fixture shares row objects between calls
      newer.users.find((u) => u.id === 'u_adnan')!.name = 'Renamed elsewhere';
      repo.stored = newer;
      useAppStore.getState().renameUser('u_adnan', 'Renamed here');
      expect(await useAppStore.getState().refresh()).toBe(false);
      expect(userName()).toBe('Renamed here');
      await repo.settleNext();
      // Once the save has landed, a refresh may read again.
      repo.stored = useAppStore.getState().data;
      expect(await useAppStore.getState().refresh()).toBe(false);
    });

    it('does nothing while the practice has not loaded, or after a failed load', async () => {
      repo.stored = buildFixtureData(today);
      useAppStore.setState({ ready: false });
      expect(await useAppStore.getState().refresh()).toBe(false);
      useAppStore.setState({ ready: true, loadFailed: true });
      expect(await useAppStore.getState().refresh()).toBe(false);
    });

    it('swallows a read failure and keeps what is on screen', async () => {
      repo.loadError = new Error('offline');
      const before = useAppStore.getState().data;
      expect(await useAppStore.getState().refresh()).toBe(false);
      expect(useAppStore.getState().data).toBe(before);
    });
  });
});
