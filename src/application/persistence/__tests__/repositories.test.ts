import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpRepository, SnapshotConflictError } from '../httpRepository';
import { LocalStorageRepository } from '../localStorageRepository';
import { SCHEMA_VERSION } from '../repository';
import { buildFixtureData } from '../../../testing/fixtures';
import type { PracticeData } from '../../../domain/types';

describe('HttpRepository.load', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('treats the route\'s own "nothing saved yet" answer as a brand-new practice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })));
    expect(await new HttpRepository().load()).toBeNull();
  });

  it('treats any other 404 as a failure, never as "new practice"', async () => {
    // What the SPA fallback or a misrouted request would return.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><title>Not here</title>', { status: 404 })));
    await expect(new HttpRepository().load()).rejects.toThrow("Couldn't load practice data.");

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not found', path: '/api/practice-data' }), { status: 404 })));
    await expect(new HttpRepository().load()).rejects.toThrow("Couldn't load practice data.");
  });

  it('returns the stored snapshot on 200 and fails on a server error', async () => {
    const data = buildFixtureData('2026-09-11');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200 })));
    expect((await new HttpRepository().load())?.clients.length).toBe(data.clients.length);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(new HttpRepository().load()).rejects.toThrow();
  });

  it('fills in a collection missing from a snapshot saved before it existed, rather than handing back a gap every screen assumes is an array', async () => {
    const { wipEntries: _wipEntries, timeEntries: _timeEntries, ...withoutNewCollections } = buildFixtureData('2026-09-11');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: withoutNewCollections }), { status: 200 })));
    const loaded = await new HttpRepository().load();
    expect(loaded?.wipEntries).toEqual([]);
    expect(loaded?.timeEntries).toEqual([]);
    // A collection that *is* present, even non-empty, is untouched.
    expect(loaded?.clients.length).toBe(withoutNewCollections.clients.length);
  });
});

describe('HttpRepository versions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('remembers the loaded version, sends it with every save, and moves on with the server', async () => {
    const data = buildFixtureData('2026-09-11');
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (!init || init.method !== 'PUT') return new Response(JSON.stringify({ data, version: 7 }), { status: 200 });
        bodies.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ ok: true, version: 8 }), { status: 200 });
      }),
    );
    const repo = new HttpRepository();
    expect(repo.currentVersion()).toBe(0);
    await repo.load();
    expect(repo.currentVersion()).toBe(7);
    await repo.save(data);
    expect((bodies[0] as { expectedVersion: number }).expectedVersion).toBe(7);
    expect(repo.currentVersion()).toBe(8);
    await repo.save(data);
    expect((bodies[1] as { expectedVersion: number }).expectedVersion).toBe(8);
  });

  it('starts from version 0 for a brand-new practice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })));
    const repo = new HttpRepository();
    expect(await repo.load()).toBeNull();
    expect(repo.currentVersion()).toBe(0);
  });

  it('turns a 409 into a SnapshotConflictError carrying the stored snapshot, and adopts its version', async () => {
    const theirs = buildFixtureData('2026-09-11');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'version_conflict', version: 12, data: theirs }), { status: 409 })));
    const repo = new HttpRepository();
    const err = await repo.save(theirs).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SnapshotConflictError);
    expect((err as SnapshotConflictError).version).toBe(12);
    expect((err as SnapshotConflictError).current.clients.length).toBe(theirs.clients.length);
    expect(repo.currentVersion()).toBe(12);
  });

  it('also fills in a missing collection on the snapshot a 409 carries back — the rebase path reads it the same way a fresh load does', async () => {
    const { wipEntries: _wipEntries, ...theirsWithoutWip } = buildFixtureData('2026-09-11');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'version_conflict', version: 12, data: theirsWithoutWip }), { status: 409 })));
    const err = await new HttpRepository().save(theirsWithoutWip as PracticeData).catch((e: unknown) => e);
    expect((err as SnapshotConflictError).current.wipEntries).toEqual([]);
  });
});

describe('HttpRepository.peek', () => {
  afterEach(() => vi.unstubAllGlobals());

  const storedAt = (version: number) => vi.fn(async () => new Response(JSON.stringify({ data: buildFixtureData('2026-09-11'), version }), { status: 200 }));

  it('reads without moving the version — only adopt() does', async () => {
    vi.stubGlobal('fetch', storedAt(9));
    const repo = new HttpRepository();
    const snapshot = await repo.peek();
    expect(snapshot.data?.clients.length).toBeGreaterThan(0);
    expect(repo.currentVersion()).toBe(0);
    expect(snapshot.adopt()).toBe(true);
    expect(repo.currentVersion()).toBe(9);
  });

  it('refuses to adopt a read that was overtaken by a save while it was in flight', async () => {
    const repo = new HttpRepository();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ok: true, version: 5 }), { status: 200 });
        const answer = JSON.stringify({ data: buildFixtureData('2026-09-11'), version: 4 });
        await gate;
        return new Response(answer, { status: 200 });
      }),
    );
    const peeking = repo.peek();
    await repo.save(buildFixtureData('2026-09-11')); // lands as version 5 while the read (version 4) is on the wire
    release();
    const snapshot = await peeking;
    expect(snapshot.adopt()).toBe(false);
    expect(repo.currentVersion()).toBe(5);
  });

  it('refuses to adopt a read that a conflict response overtook', async () => {
    const repo = new HttpRepository();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const theirs = buildFixtureData('2026-09-11');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ error: 'version_conflict', version: 12, data: theirs }), { status: 409 });
        const answer = JSON.stringify({ data: theirs, version: 10 });
        await gate;
        return new Response(answer, { status: 200 });
      }),
    );
    const peeking = repo.peek();
    await repo.save(theirs).catch(() => {});
    release();
    expect((await peeking).adopt()).toBe(false);
    expect(repo.currentVersion()).toBe(12);
  });

  it('treats the "nothing saved yet" answer as version 0 once adopted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })));
    const repo = new HttpRepository();
    const snapshot = await repo.peek();
    expect(snapshot.data).toBeNull();
    expect(snapshot.adopt()).toBe(true);
    expect(repo.currentVersion()).toBe(0);
  });
});

describe('LocalStorageRepository.save', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('round-trips a snapshot', async () => {
    const repo = new LocalStorageRepository('test.data');
    const data = buildFixtureData('2026-09-11');
    await repo.save(data);
    expect((await repo.load())?.clients.length).toBe(data.clients.length);
  });

  it('rejects, rather than silently dropping the write, when the browser refuses it', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const repo = new LocalStorageRepository('test.data');
    await expect(repo.save(buildFixtureData('2026-09-11'))).rejects.toThrow(/Could not persist practice data/);
  });
});

describe('LocalStorageRepository.load', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('discards a snapshot saved under an older schema version rather than loading it half-shaped', async () => {
    const data = buildFixtureData('2026-09-11');
    localStorage.setItem('test.data', JSON.stringify({ version: SCHEMA_VERSION - 1, savedAt: new Date().toISOString(), data }));
    expect(await new LocalStorageRepository('test.data').load()).toBeNull();
  });

  it('still fills in a collection missing under the current schema version — the version bump is the real guard, this is the backstop for forgetting it', async () => {
    const { wipEntries: _wipEntries, timeEntries: _timeEntries, ...withoutNewCollections } = buildFixtureData('2026-09-11');
    localStorage.setItem('test.data', JSON.stringify({ version: SCHEMA_VERSION, savedAt: new Date().toISOString(), data: withoutNewCollections }));
    const loaded = await new LocalStorageRepository('test.data').load();
    expect(loaded?.wipEntries).toEqual([]);
    expect(loaded?.timeEntries).toEqual([]);
  });
});
