/**
 * Disk-backed cache with TTL, single-flight deduplication, a stale grace period
 * and an upstream cooldown.
 *
 * The memory part is the same as it was. What is new is that entries are also
 * written to a file, because the whole resilience story depends on having
 * something to serve when Roblox says no — and Railway wipes memory on every
 * deploy and every restart. A cold cache after a deploy means the first
 * visitor pays for it, and if Roblox happens to be refusing us at that moment,
 * they get the error that all the rest of this file exists to prevent.
 *
 * The file is a single JSON snapshot, written at most once every few seconds
 * and never blocking a request. Losing the last few seconds of it costs
 * nothing: the values are re-fetched, which is what the cache does anyway.
 *
 * The four behaviours, and the failure each one exists for:
 *
 *  1. Per-namespace TTL. The active player count changes every second and the
 *     logo never changes.
 *  2. Single-flight. Fifty people asking for the same cold game is one call to
 *     Roblox, not fifty.
 *  3. A stale grace period, so a 429 produces a slightly old answer instead of
 *     an error page.
 *  4. A cooldown after a refusal, so a run of visitors does not turn one
 *     refusal into a stream of them. Without it, every visitor during a 429
 *     fires a fresh request at an endpoint that is already refusing us, which
 *     is how a soft limit turns into a hard one.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RobloxError } from './errors.js';

const SNAPSHOT_PATH =
  process.env.CACHE_SNAPSHOT_PATH || join(process.cwd(), '.cache', 'snapshot.json');
const SNAPSHOT_INTERVAL_MS = 5000;
/** How long a restored value is still worth serving, as an absolute age. */
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const store = new Map(); // key -> { value, expiresAt, staleUntil }
const inflight = new Map(); // key -> Promise
const cooling = new Map(); // key -> timestamp until which upstream is off-limits

let dirty = false;
let snapshotTimer = null;

// --------------------------------------------------------------- snapshot

function restore() {
  if (!existsSync(SNAPSHOT_PATH)) return 0;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  } catch {
    // A truncated file from a kill mid-write is not worth failing a boot over.
    return 0;
  }
  const now = Date.now();
  let n = 0;
  for (const [key, entry] of Object.entries(parsed.entries || {})) {
    if (now - entry.at > SNAPSHOT_MAX_AGE_MS) continue;
    // Restored as already-stale: it was written before a restart, so its age
    // includes the time the process was down. Expires at once, servable for the
    // grace window, which is exactly the state it deserves.
    store.set(key, {
      value: entry.value,
      expiresAt: now,
      staleUntil: now + (entry.staleSeconds ?? 0) * 1000,
    });
    n++;
  }
  return n;
}

function writeSnapshot() {
  const now = Date.now();
  const entries = {};
  for (const [key, entry] of store) {
    // Only keep things that are still servable, and record how much longer.
    const remaining = entry.staleUntil - now;
    if (remaining <= 0) continue;
    entries[key] = {
      at: now,
      value: entry.value,
      staleSeconds: Math.floor(remaining / 1000),
    };
  }
  const payload = JSON.stringify({ at: now, entries });
  // Written to a sibling then renamed: a process killed during the write leaves
  // the previous snapshot intact instead of a half-written one.
  const tmp = SNAPSHOT_PATH + '.tmp';
  try {
    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
    writeFileSync(tmp, payload);
    renameSync(tmp, SNAPSHOT_PATH);
    dirty = false;
  } catch {
    // A read-only filesystem is a reason to run without persistence, not a
    // reason to take the API down.
  }
}

function scheduleSnapshot() {
  dirty = true;
  if (snapshotTimer) return;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    if (dirty) writeSnapshot();
  }, SNAPSHOT_INTERVAL_MS);
  // Never hold the process open for this.
  if (typeof snapshotTimer.unref === 'function') snapshotTimer.unref();
}

// ------------------------------------------------------------------ sweep

const refillQueue = new Map(); // key -> { ttlSeconds, producer, options, tries }
let refillTimer = null;
const REFILL_BASE_MS = 2000;
const REFILL_MAX_MS = 30000;

/**
 * Queue a key to be retried once Roblox stops refusing us.
 *
 * A visitor who hits a cold cache during a refusal still gets an error, because
 * there is genuinely nothing to give them. But they should not have to come
 * back: the value they wanted is fetched as soon as the cooldown allows, so the
 * next request, theirs or anyone else's, is answered normally. That is the
 * difference between an error that resolves itself and an outage.
 */
function scheduleRefill(key, ttlSeconds, producer, options) {
  if (refillQueue.has(key)) return;
  refillQueue.set(key, { ttlSeconds, producer, options: options || {}, tries: 0 });
  if (refillTimer) return;
  armRefill(REFILL_BASE_MS);
}

function armRefill(delayMs) {
  refillTimer = setTimeout(drainRefills, delayMs);
  // Never hold the process open for this.
  if (typeof refillTimer.unref === 'function') refillTimer.unref();
}

function drainRefills() {
  refillTimer = null;
  const now = Date.now();
  for (const [key, job] of [...refillQueue]) {
    if ((cooling.get(key) || 0) > now) continue; // still refusing us
    refillQueue.delete(key);
    cache
      .wrapResilient(key, job.ttlSeconds, job.producer, job.options)
      .catch(() => {
        // The refill failed too. Back off, and give up after a few tries so a
        // key that can never be filled does not spin for the life of the
        // process.
        const tries = (job.tries || 0) + 1;
        if (tries > 6) return;
        refillQueue.set(key, { ...job, tries });
      });
  }
  if (refillQueue.size) armRefill(Math.min(REFILL_MAX_MS, REFILL_BASE_MS * 4));
}

function sweep(now) {
  if (store.size < 500) return;
  for (const [key, entry] of store) {
    if (entry.staleUntil <= now) store.delete(key);
  }
}

const restored = restore();

export const cache = {
  restoredFromDisk: restored,
  pendingRefills: () => refillQueue.size,
  snapshotPath: SNAPSHOT_PATH,

  /**
   * Fresh value, or null if missing or expired.
   *
   * It does NOT delete on expiry, which it used to. That made a read destroy the
   * stale copy: asking whether a value was fresh threw away the fallback that
   * only exists for the case where it is not. Expiry is sweep()'s job; this
   * reports and leaves the entry alone.
   */
  get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) return null;
    return entry.value;
  },

  /** Expired, but still worth showing. */
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
    scheduleSnapshot();
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
   * In order of preference: a fresh value, a stale one inside the grace period,
   * a refusal. Before refusing it checks the cooldown, so a run of visitors does
   * not turn one refusal into a stream of them.
   */
  async wrapResilient(
    key,
    ttlSeconds,
    producer,
    { staleSeconds = 900, cooldownSeconds = 45 } = {}
  ) {
    // The raw entry, not get(): get() deletes on expiry, which would throw away
    // the very thing this function falls back on.
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

    if ((cooling.get(key) || 0) > now) {
      if (staleValue !== null) {
        return { value: staleValue, cached: true, stale: true, cooled: true };
      }
      scheduleRefill(key, ttlSeconds, producer, { staleSeconds, cooldownSeconds });
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
        // Nothing cached and we were refused. Queue the value so the next
        // visitor is served normally instead of finding the same wall. This is
        // the case the refill exists for, and it is reached here rather than
        // only from the cooldown branch, because a cold cache with an upstream
        // that is currently refusing us is the common one.
        scheduleRefill(key, ttlSeconds, producer, { staleSeconds, cooldownSeconds });
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  },

  isCooling(key) {
    return (cooling.get(key) || 0) > Date.now();
  },

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
    scheduleSnapshot();
  },

  clear() {
    store.clear();
    inflight.clear();
    cooling.clear();
    scheduleSnapshot();
  },

  /** Force a write now. Called on shutdown, where a debounce would lose it. */
  flush() {
    if (dirty) writeSnapshot();
  },

  stats() {
    let stale = 0;
    const now = Date.now();
    for (const entry of store.values()) if (entry.expiresAt <= now) stale++;
    return {
      entries: store.size,
      inflight: inflight.size,
      cooling: cooling.size,
      stale,
      restored: restored,
    };
  },
};
