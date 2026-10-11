import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignSharedDocument, createUploadKey, listUploadKeys, revokeUploadKey, sendShare } from '../intake';

function respond(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe('sendShare', () => {
  it('posts the files and text, and returns what the server found', async () => {
    const spy = respond(201, { batchId: 'inb_1', read: true, documents: [] });
    const result = await sendShare([{ fileName: 'a.jpg', contentType: 'image/jpeg', contentBase64: 'AAA' }], 'hello');
    expect(result).toEqual({ ok: true, result: { batchId: 'inb_1', read: true, documents: [] } });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/intake/batches');
    expect(JSON.parse(String(init.body))).toEqual({ files: [{ fileName: 'a.jpg', contentType: 'image/jpeg', contentBase64: 'AAA' }], text: 'hello' });
  });

  it('turns each server refusal into something the share screen can explain', async () => {
    const cases: [number, unknown, string][] = [
      [409, { error: 'already_shared' }, 'already_shared'],
      [503, { error: 'not_configured' }, 'not_configured'],
      [413, {}, 'too_large'],
      [400, { error: 'batch_too_large' }, 'too_large'],
      [400, { error: 'too_many_files' }, 'too_large'],
      [400, { error: 'unsupported_type' }, 'unsupported'],
      [400, { error: 'content_mismatch' }, 'unsupported'],
      [500, {}, 'failed'],
    ];
    for (const [status, body, error] of cases) {
      respond(status, body);
      expect(await sendShare([], 'x')).toEqual({ ok: false, error });
    }
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await sendShare([], 'x')).toEqual({ ok: false, error: 'failed' });
  });
});

describe('assignSharedDocument', () => {
  it('reports whether the change was accepted', async () => {
    respond(200, { ok: true });
    expect(await assignSharedDocument('ina_1', null)).toBe(true);
    respond(404, { error: 'not_found' });
    expect(await assignSharedDocument('ina_1', 'cl_abc')).toBe(false);
  });
});

describe('upload keys', () => {
  it('lists keys, and says nothing is available (null) when there is no server to ask', async () => {
    const spy = respond(200, { tokens: [{ id: 'ink_1', label: 'iPhone', createdAt: '2026-10-10T10:00:00.000Z', lastUsedAt: null }] });
    expect(await listUploadKeys()).toEqual([{ id: 'ink_1', label: 'iPhone', createdAt: '2026-10-10T10:00:00.000Z', lastUsedAt: null }]);
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('/api/intake/tokens');
    respond(503, { error: 'not_configured' });
    expect(await listUploadKeys()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await listUploadKeys()).toBeNull();
  });

  it('makes a key, handing back the secret once, and explains a refusal', async () => {
    const spy = respond(201, { id: 'ink_2', label: 'Ray’s iPhone', token: 'frk_secret' });
    const made = await createUploadKey('Ray’s iPhone');
    expect(made).toMatchObject({ ok: true, token: 'frk_secret', key: { id: 'ink_2', label: 'Ray’s iPhone', lastUsedAt: null } });
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ label: 'Ray’s iPhone' });
    respond(409, { error: 'too_many' });
    expect(await createUploadKey('x')).toEqual({ ok: false, error: 'too_many' });
    respond(500, {});
    expect(await createUploadKey('x')).toEqual({ ok: false, error: 'failed' });
  });

  it('removes a key by id', async () => {
    const spy = respond(200, { ok: true });
    expect(await revokeUploadKey('ink_1/../x')).toBe(true);
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('/api/intake/tokens/ink_1%2F..%2Fx');
    expect((spy.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('DELETE');
    respond(404, {});
    expect(await revokeUploadKey('ink_9')).toBe(false);
  });
});
