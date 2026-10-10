/**
 * What the installable (phone) app needs from the server.
 *
 * Every hashed asset can be cached for a year, but index.html, the service
 * worker and the manifest must always be revalidated: a cached sw.js would
 * keep an old worker alive past a deploy, and a cached manifest would hide
 * a changed share target until the browser happened to look again.
 */
const ALWAYS_REVALIDATE = ['index.html', 'sw.js', 'manifest.webmanifest'];

export function noCacheForAppShell(res, filePath) {
  if (ALWAYS_REVALIDATE.some((name) => filePath.endsWith(`/${name}`) || filePath === name)) {
    res.setHeader('Cache-Control', 'no-cache');
  }
}

/** A share that reached the server instead of the service worker: say so on the share page rather than with a JSON 404. */
export function shareTargetFallback(_req, res) {
  res.redirect(303, '/share?error=not_ready');
}
