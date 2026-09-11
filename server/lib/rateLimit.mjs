/**
 * Fixed-window rate limiter kept in memory. Enough for this deployment —
 * one server process, three users — where a dependency and a shared store
 * would be more machinery than the problem warrants. Counts are per key
 * (an IP, a username, a session) and reset after the window.
 *
 * Buckets are swept lazily on the next request after a window elapses, so
 * the map never grows past the number of distinct keys seen in one window.
 */
export function createRateLimiter({ windowMs, max, keyFor, name = 'rate_limited' }) {
  const buckets = new Map();
  let nextSweep = Date.now() + windowMs;

  function sweep(now) {
    if (now < nextSweep) return;
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    nextSweep = now + windowMs;
  }

  function limiter(req, res, next) {
    const now = Date.now();
    sweep(now);
    const key = keyFor(req);
    // No key (e.g. a request without the field being limited) is not this limiter's concern.
    if (key == null || key === '') return next();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: name });
    }
    next();
  }

  /** Test hook — forget every bucket. */
  limiter.reset = () => buckets.clear();
  return limiter;
}
