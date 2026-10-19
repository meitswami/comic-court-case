// Minimal in-memory, per-user sliding-window rate limiter.
// Suitable for the single-process Express deployment on the VPS.

export function createRateLimiter({ windowMs, max, keyFn = (req) => req.userId || req.ip, message }) {
  const hits = new Map();

  function prune(now) {
    if (hits.size < 5000) return;
    for (const [key, stamps] of hits) {
      if (!stamps.length || now - stamps[stamps.length - 1] > windowMs) hits.delete(key);
    }
  }

  const middleware = (req, res, next) => {
    const now = Date.now();
    prune(now);
    const key = keyFn(req);
    const stamps = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (stamps.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - stamps[0])) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message || 'Too many requests. Please wait and try again.', code: 'RATE_LIMITED', retryAfter });
    }
    stamps.push(now);
    hits.set(key, stamps);
    next();
  };
  middleware.reset = () => hits.clear();
  return middleware;
}
