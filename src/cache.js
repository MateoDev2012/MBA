/**
 * In-memory cache with TTL, single-flight deduplication, a stale grace period
 * and an upstream cooldown.
 *
 * Four things matter here, and each one exists because of a specific failure:
 *
 *  1. Per-namespace TTL: the active player count changes every second while
 *     the logo never changes. Caching everything equally means serving stale
 *     data; caching nothing means Roblox blocks us.
 *
 *  2. Single-flight: if 50 people request the same game while the cache is
 *     cold, we make ONE call to Roblox, not 50.
 *
 *  3. A stale grace period. Values are kept past their TTL so that a 429 from
 *     Roblox does not have to become an error page. Ninety seconds of real
 *     data beats an error, and on a page whose whole argument is "this is live"
 *     it beats it by a lot. The value is marked stale in the response so nobody
 *     is misled about how fresh it is.
 *
 *  4. A cooldown after a refusal. This is the one that stops a rate limit from
 *     becoming an outage. Without it, every visitor during a 429 window fires a
 *     fresh call at an endpoint that is already refusing us — a thundering herd
 *     aimed at Roblox's own limiter. That is how a soft limit turns into a hard
 *     one and a two-second wobble turns into twenty minutes of errors.
 */

import { RobloxError } from './errors.js';

const store = new Map(); // key -> { value, expiresAt, staleUntil }
const inflight = new Map(); // key -> Promise
const cooling = new Map(); // key -> timestamp until which upstream is off-limits

/** Lazily drop entries that are past even the stale window, on write. */
function sweep(now) {
  if (store.size < 500) return;
  for (const [key, entry] of store) {
    if (entry.staleUntil <= now) store.delete(key);
  }
}

export const cache = {
  /** Fresh value, or null if missing or expired. */
  get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  },

  /**
   * Expired, but still worth showing.
   *
   * get() above deletes on read, which would make this impossible, so callers
   * that want the grace period must use wrapResilient, which never calls get().
   */
  getStale(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.staleUntil <= Date.now()) return null;
    return entry.value;
  },

  set(key, value, ttlSeconds, staleSeconds = 0) {
    const now = Date.now();
    sweep(now);
    store.set(key, {
      value,
      expiresAt: now + ttlSeconds * 1000,
      staleUntil: now + (ttlSeconds + staleSeconds) * 1000,
    });
    return value;
  },

  /**
   * Cache-through with deduplication: if a request for the same key is already
   * in flight, share it instead of firing another one.
   */
  async wrap(key, ttlSeconds, producer) {
    const cached = this.get(key);
    if (cached !== null) return { value: cached, cached: true, stale: false };

    const pending = inflight.get(key);
    if (pending) {
      const value = await pending;
      return { value, cached: true, stale: false };
    }

    const promise = (async () => producer())();
    inflight.set(key, promise);
    try {
      const value = await promise;
      this.set(key, value, ttlSeconds);
      return { value, cached: false, stale: false };
    } finally {
      inflight.delete(key);
    }
  },

  /**
   * Like wrap, but it survives the upstream saying no.
   *
   * In order of preference:
   *   1. a fresh value,
   *   2. a stale one, inside the grace period,
   *   3. a refusal — but only after checking the cooldown, so that a run of
   *      visitors does not turn one refusal into a stream of them.
   *
   * `staleSeconds` is how long past the TTL a value still beats an error.
   * `cooldownSeconds` is how long to stop asking after a refusal.
   */
  async wrapResilient(
    key,
    ttlSeconds,
    producer,
    { staleSeconds = 900, cooldownSeconds = 45 } = {}
  ) {
    // Read the raw entry rather than get(): get() deletes on expiry, which
    // would throw away the very thing this function exists to fall back on.
    const entry = store.get(key);
    const now = Date.now();
    if (entry && entry.expiresAt > now) {
      return { value: entry.value, cached: true, stale: false };
    }

    const pending = inflight.get(key);
    if (pending) {
      const value = await pending;
      return { value, cached: true, stale: false };
    }

    const staleValue = entry && entry.staleUntil > now ? entry.value : null;

    // Upstream is already refusing us. Do not ask again — serve what we have.
    if ((cooling.get(key) || 0) > now) {
      if (staleValue !== null) {
        return { value: staleValue, cached: true, stale: true, cooled: true };
      }
      throw new RobloxError('Roblox is rate limiting requests (429)', {
        status: 429,
        code: 'UPSTREAM_RATE_LIMITED',
      });
    }

    const promise = (async () => producer())();
    inflight.set(key, promise);
    try {
      const value = await promise;
      cooling.delete(key);
      this.set(key, value, ttlSeconds, staleSeconds);
      return { value, cached: false, stale: false };
    } catch (err) {
      if (err?.code === 'UPSTREAM_RATE_LIMITED') {
        cooling.set(key, Date.now() + cooldownSeconds * 1000);
        if (staleValue !== null) {
          return { value: staleValue, cached: true, stale: true };
        }
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  },

  /** Is upstream currently in cooldown for this key? */
  isCooling(key) {
    return (cooling.get(key) || 0) > Date.now();
  },

  /** Seconds left on the cooldown, for a Retry-After header. */
  cooldownRemaining(key) {
    return Math.max(0, Math.ceil(((cooling.get(key) || 0) - Date.now()) / 1000));
  },

  deleteByPrefix(prefix) {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
    for (const key of cooling.keys()) {
      if (key.startsWith(prefix)) cooling.delete(key);
    }
  },

  clear() {
    store.clear();
    inflight.clear();
    cooling.clear();
  },

  stats() {
    let stale = 0;
    const now = Date.now();
    for (const entry of store.values()) {
      if (entry.expiresAt <= now) stale++;
    }
    return {
      entries: store.size,
      inflight: inflight.size,
      cooling: cooling.size,
      stale,
    };
  },
};
