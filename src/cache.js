/**
 * In-memory cache with TTL and in-flight request deduplication.
 *
 * Two things matter here:
 *  1. Per-namespace TTL: the active player count changes every second while
 *     the logo never changes. Caching everything equally means serving stale
 *     data; caching nothing means Roblox blocks us.
 *  2. Single-flight: if 50 people request the same game while the cache is
 *     cold, we make ONE call to Roblox, not 50.
 */

const store = new Map(); // key -> { value, expiresAt }
const inflight = new Map(); // key -> Promise

/** Lazily drop expired entries on write. */
function sweep(now) {
  // Only sweep once the map is big enough, to avoid walking it on every set.
  if (store.size < 500) return;
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

export const cache = {
  /** Cached value, or null if missing or expired. */
  get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  },

  set(key, value, ttlSeconds) {
    const now = Date.now();
    sweep(now);
    store.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
    return value;
  },

  /**
   * Cache-through with deduplication: if a request for the same key is already
   * in flight, share it instead of firing another one.
   */
  async wrap(key, ttlSeconds, producer) {
    const cached = this.get(key);
    if (cached !== null) return { value: cached, cached: true };

    const pending = inflight.get(key);
    if (pending) {
      const value = await pending;
      return { value, cached: true };
    }

    const promise = (async () => producer())();
    inflight.set(key, promise);
    try {
      const value = await promise;
      this.set(key, value, ttlSeconds);
      return { value, cached: false };
    } finally {
      inflight.delete(key);
    }
  },

  deleteByPrefix(prefix) {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
  },

  clear() {
    store.clear();
  },

  stats() {
    return { entries: store.size, inflight: inflight.size };
  },
};
