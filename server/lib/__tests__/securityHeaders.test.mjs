import { describe, expect, it, vi } from 'vitest';
import { isSecure, securityHeaders } from '../securityHeaders.mjs';

function run(middleware, req = { headers: {} }) {
  const headers = {};
  const res = { setHeader: (k, v) => (headers[k] = v) };
  const next = vi.fn();
  middleware(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  return headers;
}

describe('securityHeaders', () => {
  it('sets the static hardening headers and a Content-Security-Policy by default', () => {
    const headers = run(securityHeaders());
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toContain('camera=()');
    const csp = headers['Content-Security-Policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://fonts.gstatic.com');
  });

  it('never allows inline or remote scripts', () => {
    const csp = run(securityHeaders())['Content-Security-Policy'];
    const scriptSrc = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src'));
    expect(scriptSrc).toBe("script-src 'self'");
  });

  it('can omit the CSP (for the dev server, whose HMR needs inline scripts) but keeps the rest', () => {
    const headers = run(securityHeaders({ csp: false }));
    expect(headers['Content-Security-Policy']).toBeUndefined();
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  it('adds HSTS only when the request arrived over TLS', () => {
    expect(run(securityHeaders(), { headers: {} })['Strict-Transport-Security']).toBeUndefined();
    expect(run(securityHeaders(), { secure: true, headers: {} })['Strict-Transport-Security']).toContain('max-age=');
    expect(run(securityHeaders(), { headers: { 'x-forwarded-proto': 'https' } })['Strict-Transport-Security']).toContain('includeSubDomains');
  });
});

describe('isSecure', () => {
  it('recognises direct TLS and a trusted proxy header, nothing else', () => {
    expect(isSecure({ secure: true, headers: {} })).toBe(true);
    expect(isSecure({ headers: { 'x-forwarded-proto': 'https' } })).toBe(true);
    expect(isSecure({ headers: { 'x-forwarded-proto': 'http' } })).toBe(false);
    expect(isSecure({ headers: {} })).toBe(false);
  });
});
