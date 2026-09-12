import path from 'node:path';

/**
 * Which unmatched paths are a client-side route (answer with index.html so
 * the SPA router takes over) and which are a missing file (answer 404).
 * Without the distinction a stale build's `/assets/app-abc123.js` would be
 * served as HTML with a 200, which the browser reports as a syntax error
 * in the "script" rather than the missing file it is — and a caching
 * proxy could hold on to it.
 */
const ASSET_PREFIX = /^\/assets\//;
const ASSET_EXTENSION = /\.(?:m?js|css|map|json|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|txt|xml|webmanifest)$/i;

export function isAssetRequest(requestPath) {
  return ASSET_PREFIX.test(requestPath) || ASSET_EXTENSION.test(requestPath);
}

/** Express handler: index.html for client routes, `next()` (→ the JSON 404) for API paths and missing files. */
export function spaFallback(dist) {
  return (req, res, next) => {
    if (req.path.startsWith('/api/') || isAssetRequest(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  };
}
