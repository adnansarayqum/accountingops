import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureRepository, useAppStore } from '../store';
import { HttpRepository } from '../persistence/httpRepository';
import { buildFixtureData } from '../../testing/fixtures';
import type { PracticeData } from '../../domain/types';

/**
 * Regression tests for the refresh/version race: a background refresh reads
 * the stored snapshot, and HttpRepository used to advance the version its
 * next save is based on as a side effect of that read — even when the store
 * then threw the read away because the user edited while it was in flight.
 *
 * Driven end to end (real store + real HttpRepository) against a fake
 * server whose GET is held until the test releases it, so the interleaving
 * is exact rather than timing-dependent. The server captures its answer at
 * request time, like a real one, and releases it later.
 */
const today = '2026-09-11';

class FakeServer {
  version: number;
  data: PracticeData;
  puts: { expectedVersion: number; data: PracticeData }[] = [];
  holdGets = false;
  failNextPut = false;
  private heldGets: Array<() => void> = [];

  constructor(data: PracticeData, version: number) {
    this.data = structuredClone(data);
    this.version = version;
  }

  /** Another user's save landing directly on the server. */
  saveElsewhere(mutate: (d: PracticeData) => void): void {
    const next = structuredClone(this.data);
    mutate(next);
    this.data = next;
    this.version += 1;
  }

  releaseGets(): void {
    for (const release of this.heldGets.splice(0)) release();
  }

  fetch = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(init.body as string) as { data: PracticeData; expectedVersion: number };
      this.puts.push({ expectedVersion: body.expectedVersion, data: body.data });
      if (this.failNextPut) {
        this.failNextPut = false;
        return new Response('', { status: 500 });
      }
      if (body.expectedVersion !== this.version) return new Response(JSON.stringify({ error: 'version_conflict', version: this.version, data: this.data }), { status: 409 });
      this.data = structuredClone(body.data);
      this.version += 1;
      return new Response(JSON.stringify({ ok: true, version: this.version }), { status: 200 });
    }
    // GET: the answer is fixed the moment the request arrives...
    const answer = JSON.stringify({ data: this.data, version: this.version });
    if (!this.holdGets) return new Response(answer, { status: 200 });
    // ...but is only delivered when the test says so.
    await new Promise<void>((resolve) => this.heldGets.push(resolve));
    return new Response(answer, { status: 200 });
  });
}

const nameOf = (d: PracticeData, id: string) => d.users.find((u) => u.id === id)?.name;
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('refresh() vs. edits made while the read is in flight', () => {
  let server: FakeServer;
  let repo: HttpRepository;

  beforeEach(async () => {
    server = new FakeServer(buildFixtureData(today), 7);
    vi.stubGlobal('fetch', server.fetch);
    repo = new HttpRepository();
    configureRepository(repo);
    useAppStore.setState({ ready: false, loadFailed: false, unsaved: false, currentUserId: 'u_adnan', toasts: [] });
    await useAppStore.getState().init();
    expect(repo.currentVersion()).toBe(7);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not move the base version to a newer snapshot it threw away — the next save must still be refused as stale, not overwrite it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Someone else saves version 8; our refresh reads it, but its answer is still on the wire.
    server.saveElsewhere((d) => {
      d.users.find((u) => u.id === 'u_sarah')!.name = 'Renamed by someone else';
    });
    server.holdGets = true;
    const refresh = useAppStore.getState().refresh();

    // Meanwhile this user edits, and that save fails in transit (so it is not confirmed).
    server.failNextPut = true;
    useAppStore.getState().renameUser('u_adnan', 'Renamed here');
    await flush();
    expect(useAppStore.getState().unsaved).toBe(true);

    server.releaseGets();
    // The read is discarded — the user's edit is newer than it.
    expect(await refresh).toBe(false);
    expect(nameOf(useAppStore.getState().data, 'u_adnan')).toBe('Renamed here');
    // The heart of the bug: the version must still be the one this client's data was built on.
    expect(repo.currentVersion()).toBe(7);

    // The user's next edit re-sends everything unsaved. Pre-fix this went out
    // as expectedVersion 8, passed the server's check, and wiped 'Renamed by someone else'.
    server.holdGets = false;
    useAppStore.getState().renameUser('u_adnan', 'Renamed here again');
    await flush();

    const [, second, third] = server.puts;
    expect(second.expectedVersion).toBe(7);
    // The 409 is rebased onto their version, so both people's changes survive.
    expect(third.expectedVersion).toBe(8);
    expect(nameOf(server.data, 'u_sarah')).toBe('Renamed by someone else');
    expect(nameOf(server.data, 'u_adnan')).toBe('Renamed here again');
    expect(useAppStore.getState().unsaved).toBe(false);
  });

  it('does not wind the base version back to a snapshot older than a save that landed while the read was in flight', async () => {
    server.holdGets = true;
    const refresh = useAppStore.getState().refresh(); // reads version 7, delivery delayed

    useAppStore.getState().renameUser('u_adnan', 'Saved during the read'); // PUT lands: server is now version 8
    await flush();
    expect(useAppStore.getState().unsaved).toBe(false);
    expect(repo.currentVersion()).toBe(8);

    server.releaseGets(); // the stale version-7 answer arrives
    expect(await refresh).toBe(false);
    // Pre-fix this read 7 back into the repository, so the next save conflicted with the user's own save.
    expect(repo.currentVersion()).toBe(8);
    expect(nameOf(useAppStore.getState().data, 'u_adnan')).toBe('Saved during the read');

    server.holdGets = false;
    useAppStore.getState().renameUser('u_adnan', 'Next edit');
    await flush();
    expect(server.puts.map((p) => p.expectedVersion)).toEqual([7, 8]);
    expect(useAppStore.getState().toasts.map((t) => t.title)).not.toContain('Someone else changed this first');
  });

  it('still adopts both the data and the version when nothing was edited during the read', async () => {
    server.saveElsewhere((d) => {
      d.users.find((u) => u.id === 'u_sarah')!.name = 'Renamed by someone else';
    });
    expect(await useAppStore.getState().refresh()).toBe(true);
    expect(nameOf(useAppStore.getState().data, 'u_sarah')).toBe('Renamed by someone else');
    expect(repo.currentVersion()).toBe(8);

    useAppStore.getState().renameUser('u_adnan', 'After refresh');
    await flush();
    expect(server.puts.map((p) => p.expectedVersion)).toEqual([8]);
    expect(useAppStore.getState().unsaved).toBe(false);
  });
});
