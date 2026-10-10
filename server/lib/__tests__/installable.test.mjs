import { describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { noCacheForAppShell, shareTargetFallback } from '../installable.mjs';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public');

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file) {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('noCacheForAppShell', () => {
  it('makes the page, the service worker and the manifest always revalidate, and leaves hashed assets cached', () => {
    for (const file of ['/srv/dist/index.html', '/srv/dist/sw.js', '/srv/dist/manifest.webmanifest']) {
      const res = { setHeader: vi.fn() };
      noCacheForAppShell(res, file);
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    }
    for (const file of ['/srv/dist/assets/index-abc123.js', '/srv/dist/icon-512.png', '/srv/dist/not-sw.js']) {
      const res = { setHeader: vi.fn() };
      noCacheForAppShell(res, file);
      expect(res.setHeader).not.toHaveBeenCalled();
    }
  });
});

describe('shareTargetFallback', () => {
  it('sends a share that missed the service worker to the share screen, as a GET', () => {
    const res = { redirect: vi.fn() };
    shareTargetFallback({}, res);
    expect(res.redirect).toHaveBeenCalledWith(303, '/share?error=not_ready');
  });
});

describe('the web app manifest', () => {
  const manifest = JSON.parse(readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));

  it('is installable: standalone, with a start URL and 192/512 icons including a maskable one', () => {
    expect(manifest).toMatchObject({ display: 'standalone', start_url: '/', scope: '/' });
    const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
  });

  it('ships every icon it names, at the size it claims', () => {
    for (const icon of manifest.icons) {
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(path.join(publicDir, icon.src))).toEqual([w, h]);
    }
    expect(pngSize(path.join(publicDir, 'apple-touch-icon.png'))).toEqual([180, 180]);
  });

  it('accepts exactly what the intake server can read, posted where the service worker catches it', () => {
    expect(manifest.share_target).toMatchObject({ action: '/share-target', method: 'POST', enctype: 'multipart/form-data', params: { text: 'text', title: 'title' } });
    const accepted = manifest.share_target.params.files[0].accept.filter((a) => a.includes('/'));
    expect(accepted.sort()).toEqual(['application/pdf', 'image/gif', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']);
    const sw = readFileSync(path.join(publicDir, 'sw.js'), 'utf8');
    expect(sw).toContain(`url.pathname === '${manifest.share_target.action}'`);
    expect(sw).toContain(`form.getAll('${manifest.share_target.params.files[0].name}')`);
    expect(existsSync(path.join(publicDir, 'sw.js'))).toBe(true);
  });
});
