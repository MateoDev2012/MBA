/**
 * Per-IP rate limit, in memory and dependency-free.
 *
 * Goal: stop a script from burning our Roblox quota. This is not a substitute
 * for a distributed rate limiter (across several instances each one counts
 * separately) but it is enough for a single instance and adds no dependency.
 */

import { config } from './config.js';
import { rateLimitCeiling } from './apikey.js';

const buckets = new Map(); // ip -> { count, resetAt }

export function rateLimit({ windowMs, max } = config.rateLimit) {
  return function (req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    // A valid key earns a higher ceiling, decided by apiKeyGuard which runs
    // first. `max` stays the fallback so this module works unchanged on its own.
    const ceiling = rateLimitCeiling(req) || max;

    // Keyed callers are counted per key as well as per IP. One shared key on a
    // busy site is a lot of traffic from a single address, and the key is the
    // thing that can actually be revoked, so it needs its own budget.
    const id = req.apiKeyInfo?.key ? `${ip}|key:${req.apiKeyInfo.key}` : ip;

    let bucket = buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, ceiling - bucket.count);
    res.setHeader('RateLimit-Limit', ceiling);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', Math.ceil((bucket.resetAt - now) / 1000));

    if (bucket.count > ceiling) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Limit is ${ceiling} per ${Math.round(windowMs / 1000)}s.`,
        },
      });
    }

    next();
  };
}

// Periodically drop expired buckets so the map cannot grow without bound.
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(ip);
  }
}, config.rateLimit.windowMs);
cleanup.unref?.();
