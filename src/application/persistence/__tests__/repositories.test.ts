import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpRepository } from '../httpRepository';
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
