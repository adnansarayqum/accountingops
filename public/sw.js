/*
 * The app's service worker. It does one job: catch what Android shares into
 * the installed app (the manifest's share_target POSTs here), park the files
 * in Cache Storage, and open /share to send them on. Handling the POST here,
 * not on the server, means a share works without a round trip, whatever the
 * session cookie's SameSite rules make of a launch from another app.
 *
 * Nothing else is intercepted or cached: the app always loads fresh from
 * the network, so a deploy is never hidden behind a stale copy.
 */
const SHARE_CACHE = 'shared-into-app';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share-target') {
    event.respondWith(stashShare(event.request));
  }
});

async function stashShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((value) => typeof value !== 'string');
    // A mail app often sends the subject as the title and the body as the
    // text, a browser the page title and a URL — keep each distinct piece once.
    const pieces = [];
    for (const key of ['title', 'text', 'url']) {
      const value = form.get(key);
      if (typeof value === 'string' && value.trim() && !pieces.includes(value.trim())) pieces.push(value.trim());
    }
    const id = self.crypto.randomUUID();
    const cache = await caches.open(SHARE_CACHE);
    await Promise.all(files.map((file, index) => cache.put(`/__shared/${id}/${index}`, new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } }))));
    const meta = { files: files.map((file) => ({ name: file.name, type: file.type })), text: pieces.join('\n\n'), sharedAt: new Date().toISOString() };
    await cache.put(`/__shared/${id}/meta`, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
    return Response.redirect(`/share?id=${id}`, 303);
  } catch {
    return Response.redirect('/share?error=unreadable', 303);
  }
}
