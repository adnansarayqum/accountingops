import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearParkedShare, fileBytes, prepareFiles, readParkedShare, sendableType, SHARE_CACHE } from '../sharedFiles';

/** A minimal Cache Storage, enough for what public/sw.js writes and the page reads. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    const key = (req: string | Request) => new URL(typeof req === 'string' ? req : req.url, 'https://app.test').pathname;
    return {
      match: async (req: string) => store.get(key(req))?.clone(),
      put: async (req: string, res: Response) => void store.set(key(req), res),
      keys: async () => [...store.keys()].map((path) => new Request(`https://app.test${path}`)),
      delete: async (req: Request) => store.delete(key(req)),
    };
  };
  vi.stubGlobal('caches', { open });
  return { open, stores };
}

/** Writes a share the way public/sw.js does. */
async function park(open: (name: string) => Promise<{ put: (req: string, res: Response) => Promise<void> }>, id: string, files: { name: string; type: string; body: string }[], text: string) {
  const cache = await open(SHARE_CACHE);
  await Promise.all(files.map((f, i) => cache.put(`/__shared/${id}/${i}`, new Response(f.body, { headers: { 'Content-Type': f.type } }))));
  await cache.put(`/__shared/${id}/meta`, new Response(JSON.stringify({ files: files.map((f) => ({ name: f.name, type: f.type })), text })));
}

afterEach(() => vi.unstubAllGlobals());

describe('sendableType', () => {
  it('takes the declared type when the server can read it', () => {
    expect(sendableType(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBe('image/jpeg');
    expect(sendableType(new File(['x'], 'a', { type: 'application/pdf; charset=binary' }))).toBe('application/pdf');
  });

  it('falls back to the extension when the sharing app gave no useful type', () => {
    expect(sendableType(new File(['x'], 'Statement.PDF', { type: '' }))).toBe('application/pdf');
    expect(sendableType(new File(['x'], 'photo.jpeg', { type: 'application/octet-stream' }))).toBe('image/jpeg');
  });

  it('refuses anything the server cannot read', () => {
    expect(sendableType(new File(['x'], 'note.opus', { type: 'audio/ogg' }))).toBeNull();
    expect(sendableType(new File(['x'], 'IMG.HEIC', { type: 'image/heic' }))).toBeNull();
    expect(sendableType(new File(['x'], 'sheet.xlsx', { type: '' }))).toBeNull();
  });
});

describe('prepareFiles', () => {
  it('base64-encodes what can be sent, byte for byte, and names what was left out', async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    const { ready, skipped } = await prepareFiles([new File([bytes], 'scan.pdf', { type: 'application/pdf' }), new File(['hi'], 'voice.opus', { type: 'audio/ogg' })]);
    expect(skipped).toEqual(['voice.opus']);
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ fileName: 'scan.pdf', contentType: 'application/pdf' });
    expect(Uint8Array.from(atob(ready[0].contentBase64), (c) => c.charCodeAt(0))).toEqual(bytes);
  });
});

describe('parked shares', () => {
  it('reads back what the service worker parked, then clears only that share', async () => {
    const { open, stores } = fakeCaches();
    await park(open, 'one', [{ name: 'p1.jpg', type: 'image/jpeg', body: 'jpeg-bytes' }, { name: 'p2.pdf', type: 'application/pdf', body: 'pdf-bytes' }], 'Hello');
    await park(open, 'two', [{ name: 'other.jpg', type: 'image/jpeg', body: 'x' }], '');

    const share = await readParkedShare('one');
    expect(share!.text).toBe('Hello');
    expect(share!.files.map((f) => [f.name, f.type])).toEqual([
      ['p1.jpg', 'image/jpeg'],
      ['p2.pdf', 'application/pdf'],
    ]);
    expect(new TextDecoder().decode(await fileBytes(share!.files[1]))).toBe('pdf-bytes');

    await clearParkedShare('one');
    expect(await readParkedShare('one')).toBeNull();
    expect([...stores.get(SHARE_CACHE)!.keys()].sort()).toEqual(['/__shared/two/0', '/__shared/two/meta']);
  });

  it('finds nothing for an unknown share, or where Cache Storage does not exist', async () => {
    fakeCaches();
    expect(await readParkedShare('nope')).toBeNull();
    vi.unstubAllGlobals();
    vi.stubGlobal('caches', undefined);
    expect(await readParkedShare('nope')).toBeNull();
  });
});
