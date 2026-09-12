import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpRepository, SnapshotConflictError } from '../httpRepository';
import { LocalStorageRepository } from '../localStorageRepository';
import { buildFixtureData } from '../../../testing/fixtures';

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
