import { describe, expect, it, vi } from 'vitest';
import { clearSessionCookie, parseCookies, SESSION_COOKIE, setSessionCookie } from '../cookies.mjs';

describe('parseCookies', () => {
  it('parses a single cookie', () => {
    expect(parseCookies(`${SESSION_COOKIE}=abc123`)).toEqual({ [SESSION_COOKIE]: 'abc123' });
  });

  it('parses multiple cookies separated by "; "', () => {
    expect(parseCookies('foo=bar; baz=qux')).toEqual({ foo: 'bar', baz: 'qux' });
  });

  it('decodes URL-encoded values', () => {
    expect(parseCookies('token=a%2Fb%3Dc')).toEqual({ token: 'a/b=c' });
  });

  it('returns an empty object for a missing header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it('ignores malformed segments without a value', () => {
    expect(parseCookies('valid=1; garbage; also=2')).toEqual({ valid: '1', also: '2' });
  });
});

describe('setSessionCookie / clearSessionCookie', () => {
  it('sets an HttpOnly, SameSite=Lax cookie with the given token and expiry', () => {
    const res = { setHeader: vi.fn() };
    setSessionCookie(res, 'my-token', new Date('2026-01-01T00:00:00.000Z'));
    const [name, value] = res.setHeader.mock.calls[0];
    expect(name).toBe('Set-Cookie');
    expect(value).toContain(`${SESSION_COOKIE}=my-token`);
    expect(value).toContain('HttpOnly');
    expect(value).toContain('SameSite=Lax');
    expect(value).toContain('Expires=');
  });

  it('marks the cookie Secure when the request arrived over TLS, even without NODE_ENV=production', () => {
    const plain = { setHeader: vi.fn(), req: { headers: {} } };
    setSessionCookie(plain, 't', new Date());
    expect(plain.setHeader.mock.calls[0][1]).not.toContain('Secure');

    const forwarded = { setHeader: vi.fn(), req: { headers: { 'x-forwarded-proto': 'https' } } };
    setSessionCookie(forwarded, 't', new Date());
    expect(forwarded.setHeader.mock.calls[0][1]).toContain('; Secure');

    const direct = { setHeader: vi.fn(), req: { secure: true, headers: {} } };
    clearSessionCookie(direct);
    expect(direct.setHeader.mock.calls[0][1]).toContain('; Secure');
  });

  it('clears the cookie with Max-Age=0', () => {
    const res = { setHeader: vi.fn() };
    clearSessionCookie(res);
    const [, value] = res.setHeader.mock.calls[0];
    expect(value).toContain('Max-Age=0');
  });
});
