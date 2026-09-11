/** Minimal cookie parse/set — avoids adding cookie-parser for one cookie. */
export const SESSION_COOKIE = 'practiceops_session';

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/**
 * Secure when we're in production OR the request actually arrived over TLS —
 * so a deployment that forgets NODE_ENV still gets the flag behind Railway's
 * TLS edge, and localhost dev never sets a cookie the browser would then
 * refuse to send back over http.
 */
function secureFlag(res) {
  const req = res.req;
  const overTls = req?.secure === true || req?.headers?.['x-forwarded-proto'] === 'https';
  return process.env.NODE_ENV === 'production' || overTls ? '; Secure' : '';
}

export function setSessionCookie(res, token, expiresAt) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secureFlag(res)}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(res)}`);
}
