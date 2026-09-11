/**
 * Security headers for every response — API and static alike. Mounted
 * before any router in both the production server and the Vite preview
 * middleware, so the e2e console sweep exercises the real CSP.
 *
 * The CSP is strict for scripts (no inline, no eval) because a stored
 * string in the shared practice snapshot is rendered by every user's
 * browser — this header is the backstop if React's escaping is ever
 * bypassed. Styles allow inline because React sets style attributes and
 * the Google Fonts stylesheet is external; that's a far smaller surface.
 *
 * HSTS is only sent on a request that actually arrived over TLS (Railway
 * terminates TLS at its edge and forwards the scheme), never on plain-HTTP
 * localhost, where it would pin the browser to an https origin that
 * doesn't exist.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const HSTS = 'max-age=31536000; includeSubDomains';

/** @param {{ csp?: boolean }} [opts] csp=false for the Vite dev server, whose HMR websocket and refresh preamble a strict policy would block. */
export function securityHeaders({ csp = true } = {}) {
  return function setSecurityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (csp) res.setHeader('Content-Security-Policy', CSP);
    if (isSecure(req)) res.setHeader('Strict-Transport-Security', HSTS);
    next();
  };
}

/** True when the request reached us over TLS, directly or via a proxy that forwarded the original scheme. */
export function isSecure(req) {
  return req.secure === true || req.headers['x-forwarded-proto'] === 'https';
}
