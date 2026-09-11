import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '../rateLimit.mjs';

function fakeRes() {
  const res = { headers: {}, statusCode: 200, body: undefined };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

function hit(limiter, key) {
  const res = fakeRes();
  const next = vi.fn();
  limiter({ key }, res, next);
  return { res, allowed: next.mock.calls.length === 1 };
}

describe('createRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('allows up to max requests per key in a window, then answers 429 with Retry-After', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 3, keyFor: (req) => req.key, name: 'slow_down' });
    expect(hit(limiter, 'a').allowed).toBe(true);
    expect(hit(limiter, 'a').allowed).toBe(true);
    expect(hit(limiter, 'a').allowed).toBe(true);
    const fourth = hit(limiter, 'a');
    expect(fourth.allowed).toBe(false);
    expect(fourth.res.statusCode).toBe(429);
    expect(fourth.res.body).toEqual({ error: 'slow_down' });
    expect(Number(fourth.res.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
  });

  it('counts each key separately', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, keyFor: (req) => req.key });
    expect(hit(limiter, 'a').allowed).toBe(true);
    expect(hit(limiter, 'b').allowed).toBe(true);
    expect(hit(limiter, 'a').allowed).toBe(false);
  });

  it('forgets a key once its window has elapsed', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, keyFor: (req) => req.key });
    expect(hit(limiter, 'a').allowed).toBe(true);
    expect(hit(limiter, 'a').allowed).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(hit(limiter, 'a').allowed).toBe(true);
  });

  it('ignores requests the key function cannot classify', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, keyFor: (req) => req.key });
    expect(hit(limiter, undefined).allowed).toBe(true);
    expect(hit(limiter, '').allowed).toBe(true);
    expect(hit(limiter, null).allowed).toBe(true);
  });

  it('uses the default error name when none is given', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 0, keyFor: (req) => req.key });
    expect(hit(limiter, 'a').res.body).toEqual({ error: 'rate_limited' });
  });

  it('reset() clears every bucket', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, keyFor: (req) => req.key });
    hit(limiter, 'a');
    expect(hit(limiter, 'a').allowed).toBe(false);
    limiter.reset();
    expect(hit(limiter, 'a').allowed).toBe(true);
  });
});
