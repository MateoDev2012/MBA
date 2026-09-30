/**
 * Roblox HTTP client.
 *
 * Endpoints verified against the live Roblox API (they change without notice,
 * which is why every call lives here instead of being scattered across routes):
 *   - games.roblox.com/v1/games?universeIds=            -> game data
 *   - games.roblox.com/v1/games/votes?universeIds=       -> up/down votes
 *   - games.roblox.com/v1/games/{id}/favorites/count     -> favorites (singular!)
 *   - thumbnails.roblox.com/v1/games/icons?...           -> thumbnail (logo)
 *   - thumbnails.roblox.com/v1/games/multiget/thumbnails -> banners (requires size)
 *   - games.roblox.com/v2/games/{id}/media               -> game media items
 *   - develop.roblox.com/v1/universes/{id}               -> developer info
 *   - apis.roblox.com/universes/v1/places/{id}/universe  -> place -> universe
 *   - apis.roblox.com/search-api/omni-search?vertical=games -> game search
 *   - apis.roblox.com/game-passes/v1/universes/{id}/game-passes -> game passes
 *   - badges.roblox.com/v1/universes/{id}/badges?limit=10&sortOrder=Asc
 */

import { RobloxError } from './errors.js';

/**
 * Local to this module, and deliberately not the shared src/config.js: the
 * fetch path needs no Express settings. The consequence, learned the hard way,
 * is that a key added to one of the two is NOT added to the other. A gate built
 * from a key that existed only in the shared config got a NaN capacity and
 * looped forever instead of making a request.
 */
const config = {
  userAgent: process.env.USER_AGENT || 'RobloxStatsAPI/1.0',
  timeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS || 10000),
  // Our own budget towards Roblox. A burst of simultaneous requests is a
  // reliable way to be refused, so the outbound side is capped and smoothed.
  upstreamPerMinute: Number(process.env.UPSTREAM_PER_MINUTE || 90),
  upstreamBurst: Number(process.env.UPSTREAM_BURST || 12),
};

/** A finite positive number, or the fallback. The gate must never see NaN. */
function positive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// RobloxError lives in errors.js now, so the cache can raise the same error on its
// cooldown path without importing this module. Re-exported here because every
// caller has always imported it from here.
export { RobloxError };

/**
 * GET request to Roblox with timeout, retries and typed errors.
 */
/**
 * Outbound rate gate, one per upstream host.
 *
 * A token bucket, so bursts are smoothed rather than blocked: a bucket that
 * refills continuously allows a short spike up to its capacity and then holds
 * the steady rate. Without it, forty visitors arriving together became forty
 * simultaneous requests to Roblox, and the endpoint that refused us was one we
 * had asked too hard.
 *
 * Waits are queued rather than rejected, so this adds latency instead of
 * errors — which is the right trade for a public free API.
 */
const gates = new Map();

function gateFor(host) {
  let g = gates.get(host);
  if (!g) {
    g = {
      capacity: positive(config.upstreamBurst, 12),
      tokens: positive(config.upstreamBurst, 12),
      refillPerMs: positive(config.upstreamPerMinute, 90) / 60000,
      last: Date.now(),
      queue: Promise.resolve(),
    };
    gates.set(host, g);
  }
  return g;
}

async function takeToken(host) {
  const g = gateFor(host);
  // Serialised, so a hundred callers cannot all read the same token count and
  // all decide there is one available.
  const turn = g.queue.then(async () => {
    // Bounded. With correct arithmetic this never trips, but a bucket that
    // cannot be satisfied must cost latency, not the whole process.
    for (let guard = 0; guard < 500; guard++) {
      const now = Date.now();
      g.tokens = Math.min(g.capacity, g.tokens + (now - g.last) * g.refillPerMs);
      g.last = now;
      if (g.tokens >= 1) {
        g.tokens -= 1;
        return;
      }
      const waitMs = Math.max(20, Math.ceil((1 - g.tokens) / g.refillPerMs));
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 1000)));
    }
    // Out of patience: let the request through rather than refusing it. A slow
    // answer beats an error, and the cache's cooldown covers the case where
    // Roblox is refusing us regardless.
  });
  // Keep the chain alive even if a caller goes away mid-wait.
  g.queue = turn.then(
    () => undefined,
    () => undefined
  );
  return turn;
}

/** How long Roblox asked us to wait, in ms, or null. */
function retryAfterMs(res) {
  const raw = res.headers?.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 10000);
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.min(Math.max(0, at - Date.now()), 10000);
  return null;
}


let lastRateLimitAt = 0;
let lastRateLimitPause = 0;

/** When we were last refused, and how long Roblox said to wait. For /health. */
export function lastRateLimit() {
  return { at: lastRateLimitAt, pauseMs: lastRateLimitPause };
}

export async function robloxFetch(url, { retries = 2, signal } = {}) {
  let lastError;

  // One host per URL for our purposes, and Roblox spreads across four
  // subdomains, so the gate is per host rather than global.
  let host = '';
  try { host = new URL(url).host; } catch { /* relative or malformed */ }

  // A 429 gets its own budget of one, separate from the generic retry
  // count. Retrying it three times is not caution, it is three more requests at
  // an endpoint that has already said no, which is how a soft limit becomes a
  // hard one.
  let rateLimitRetried = false;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (host) await takeToken(host);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    // If the caller goes away, abort the upstream request too.
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': config.userAgent, Accept: 'application/json' },
        signal: controller.signal,
      });

      if (res.status === 429) {
        // Respect Retry-After, and retry once. Roblox tells us how long to
        // wait, so the previous behaviour of refusing to try again at all was
        // not caution, it was giving up on a refusal that lasts a second.
        const wait = retryAfterMs(res);
        if (!rateLimitRetried) {
          rateLimitRetried = true;
          const pause = wait !== null ? wait : 400 * 2 ** attempt;
          lastRateLimitAt = Date.now();
          lastRateLimitPause = pause;
          await new Promise((r) => setTimeout(r, Math.min(pause, 5000)));
          continue;
        }
        throw new RobloxError('Roblox is rate limiting requests (429)', {
          status: 429,
          code: 'UPSTREAM_RATE_LIMITED',
          retryAfterMs: wait ?? 1000,
        });
      }
      if (res.status === 404) {
        throw new RobloxError('Resource not found on Roblox (404)', {
          status: 404,
          code: 'NOT_FOUND',
        });
      }
      if (!res.ok) {
        // Roblox explains what it disliked in the body, e.g.
        // {"errors":[{"code":0,"message":"Allowed values: 10, 25, 50, 100","field":"limit"}]}
        // A bare "400" costs a debugging round trip every single time, so the
        // reason gets read out and passed along.
        let detail = '';
        try {
          const text = await res.text();
          if (text) {
            const parsed = JSON.parse(text);
            const msg = parsed?.errors?.[0]?.message || parsed?.message;
            detail = msg ? ` — ${msg}` : '';
          }
        } catch {
          /* body was not JSON, the status alone will have to do */
        }
        throw new RobloxError(`Roblox responded with ${res.status}${detail}`, {
          status: res.status >= 500 ? 502 : res.status,
          code: 'UPSTREAM_ERROR',
        });
      }

      return await res.json();
    } catch (err) {
      lastError = err;
      const isClientAbort = err?.name === 'AbortError';
      // A 429 is no longer treated as definitive, because it is retried at
      // the point where it is raised. Leaving it in this list would have thrown
      // it out of the catch before the backoff below ever ran.
      // A 429 has already spent its single retry above. Letting the generic
      // budget re-drive it produced three requests against an endpoint that had
      // just refused, which is the opposite of what a rate limit needs.
      if (err?.code === 'UPSTREAM_RATE_LIMITED') throw err;
      const isDefinitive = err instanceof RobloxError && err.code === 'NOT_FOUND';

      if (isDefinitive) throw err;
      // The caller cancelled: don't retry on their behalf.
      if (isClientAbort && signal?.aborted) throw err;

      if (attempt === retries) break;
      // Short exponential backoff.
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  throw lastError instanceof RobloxError
    ? lastError
    : new RobloxError('Could not reach Roblox', { code: 'UPSTREAM_UNREACHABLE', cause: lastError });
}

/** Turns "1,234,567" into 1234567. */
export function parseCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^0-9-]/g, ''));
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

export function parseIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Public Roblox game URL. */
export function gameUrl(universeId) {
  return `https://www.roblox.com/games/${universeId}`;
}

/** Base game data from games.roblox.com. */
export async function fetchGame(universeId, opts) {
  const data = await robloxFetch(
    `https://games.roblox.com/v1/games?universeIds=${universeId}`,
    opts
  );
  const game = data?.data?.[0];
  if (!game) {
    throw new RobloxError(`The universeId ${universeId} is not a valid game`, {
      status: 404,
      code: 'NOT_FOUND',
    });
  }
  return game;
}

/** Votes (likes / dislikes). */
export async function fetchVotes(universeId, opts) {
  const data = await robloxFetch(
    `https://games.roblox.com/v1/games/votes?universeIds=${universeId}`,
    opts
  );
  const entry = data?.data?.[0];
  return {
    upVotes: parseCount(entry?.upVotes),
    downVotes: parseCount(entry?.downVotes),
  };
}

/**
 * Favorite count.
 * NOTE: the path is /favorites/count in the singular, not /favorites.
 */
export async function fetchFavoritesCount(universeId, opts) {
  const data = await robloxFetch(
    `https://games.roblox.com/v1/games/${universeId}/favorites/count`,
    opts
  );
  return parseCount(data?.favoritesCount);
}

/** Game thumbnail (logo). */
export async function fetchIcon(universeId, opts) {
  const size = '512x512';
  const data = await robloxFetch(
    `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}` +
      `&size=${size}&format=Png&isCircular=false`,
    opts
  );
  const entry = data?.data?.[0];
  return entry?.state === 'Completed' ? entry.imageUrl : null;
}

/**
 * Game banners. Roblox returns an array of thumbnails (the game's media
 * images); the first one is the main banner.
 */
export async function fetchBanners(universeId, opts) {
  const size = '768x432';
  const data = await robloxFetch(
    `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${universeId}` +
      `&size=${size}&format=Png&isCircular=false`,
    opts
  );
  const entry = data?.data?.[0];
  if (!entry || entry.error) return [];
  return (entry.thumbnails || [])
    .filter((t) => t.state === 'Completed' && t.imageUrl)
    .map((t) => t.imageUrl);
}

/**
 * Icons (logos) for many games in one call.
 *
 * Roblox answers with one entry per requested id and echoes the id back as
 * targetId, so results are matched by id and never by position.
 *
 * @returns {Promise<Record<string, string>>} universeId -> image URL
 */
export async function fetchIconsFor(universeIds, opts) {
  const ids = universeIds.join(',');
  if (!ids) return {};
  const data = await robloxFetch(
    `https://thumbnails.roblox.com/v1/games/icons?universeIds=${ids}` +
      `&size=512x512&format=Png&isCircular=false`,
    opts
  );
  const out = {};
  for (const entry of data?.data || []) {
    if (entry?.state === 'Completed' && entry.imageUrl) out[entry.targetId] = entry.imageUrl;
  }
  return out;
}

/**
 * Main banner for many games in one call. Same shape as fetchIconsFor.
 * @returns {Promise<Record<string, string>>} universeId -> image URL
 */
export async function fetchBannersFor(universeIds, opts) {
  const ids = universeIds.join(',');
  if (!ids) return {};
  const data = await robloxFetch(
    `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${ids}` +
      `&size=768x432&format=Png&isCircular=false`,
    opts
  );
  const out = {};
  for (const entry of data?.data || []) {
    // The outer entry carries the universeId; the thumbnails nested inside it
    // carry the asset id instead, which is why the id is read from here.
    const first = (entry?.thumbnails || []).find((t) => t.state === 'Completed' && t.imageUrl);
    if (first && entry.universeId) out[entry.universeId] = first.imageUrl;
  }
  return out;
}

/**
 * Base game data for many games in one call.
 *
 * The search endpoint that feeds /trending deliberately withholds the creator
 * (it returns creatorName:"" and creatorId:0), so the only way to show who
 * made a trending game is to ask games.roblox.com. This is also where visits
 * and likes come from, which search does not publish either.
 *
 * @returns {Promise<Record<string, object>>} universeId -> raw game object
 */
export async function fetchDetailsFor(universeIds, opts) {
  const ids = universeIds.join(',');
  if (!ids) return {};
  const data = await robloxFetch(`https://games.roblox.com/v1/games?universeIds=${ids}`, opts);
  const out = {};
  for (const game of data?.data || []) {
    if (game?.id != null) out[game.id] = game;
  }
  return out;
}

/** Images and videos uploaded by the creator (game media). */
export async function fetchMedia(universeId, opts) {
  const data = await robloxFetch(`https://games.roblox.com/v2/games/${universeId}/media`, opts);
  return (data?.data || []).map((m) => ({
    type: m.assetType || 'Unknown',
    imageId: m.imageId ?? null,
    videoHash: m.videoHash ?? null,
    title: m.videoTitle || null,
    altText: m.altText || null,
  }));
}

/** Developer/creator data (develop.roblox.com). */
export async function fetchDeveloperInfo(universeId, opts) {
  const data = await robloxFetch(`https://develop.roblox.com/v1/universes/${universeId}`, opts);
  return {
    isActive: data?.isActive ?? null,
    isArchived: data?.isArchived ?? null,
    privacyType: data?.privacyType ?? null,
    creatorType: data?.creatorType ?? null,
    creatorTargetId: data?.creatorTargetId ?? null,
    creatorName: data?.creatorName ?? null,
    audiences: data?.audiences ?? null,
  };
}

/**
 * Game passes.
 *
 * NOTE: the list endpoint does NOT include prices. A price lives in
 * /game-passes/{id}/product-info, i.e. one extra request per game pass.
 * Set `includePrices: true` to pay for that; it is off by default because
 * 100 extra calls per listing is not worth it.
 */
export async function fetchGamePasses(universeId, opts) {
  const includePrices = opts?.includePrices === true;
  const data = await robloxFetch(
    `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?limit=100&sortOrder=Asc`,
    opts
  );
  const passes = (data?.gamePasses || []).map((p) => ({
    id: p.id,
    name: p.displayName || p.name,
    description: p.displayDescription || null,
    isForSale: p.isForSale ?? null,
    iconImageId: p.displayIconImageAssetId ?? p.iconImageAssetId ?? null,
    productId: p.productId ?? null,
    priceInRobux: null,
    created: parseIsoDate(p.created),
    updated: parseIsoDate(p.updated),
  }));

  if (!includePrices) return passes;

  // Fill prices in parallel, tolerating a failure per game pass.
  return Promise.all(
    passes.map(async (p) => {
      try {
        const info = await robloxFetch(
          `https://apis.roblox.com/game-passes/v1/game-passes/${p.id}/product-info`,
          opts
        );
        return { ...p, priceInRobux: parseCount(info?.PriceInRobux) || null };
      } catch {
        return p; // If the price lookup fails, still return the game pass itself.
      }
    })
  );
}

/** Badges. This endpoint requires an even `limit`. */
export async function fetchBadges(universeId, opts) {
  const data = await robloxFetch(
    `https://badges.roblox.com/v1/universes/${universeId}/badges?limit=100&sortOrder=Asc`,
    opts
  );
  return (data?.data || []).map((b) => ({
    id: b.id,
    name: b.displayName || b.name,
    description: b.displayDescription || b.description || null,
    rarity: b.rarity ?? null,
    enabled: b.enabled ?? null,
  }));
}

/** placeId -> universeId */
export async function resolveUniverseFromPlace(placeId, opts) {
  const data = await robloxFetch(
    `https://apis.roblox.com/universes/v1/places/${placeId}/universe`,
    opts
  );
  return data?.universeId ?? null;
}

/** Game search. */
export async function searchGames(query, limit, opts) {
  const sessionId = crypto.randomUUID();
  const data = await robloxFetch(
    `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(query)}` +
      `&vertical=games&pageLimit=${limit}&pageType=all&sessionId=${sessionId}&pageToken=`,
    opts
  );
  const group = (data?.searchResults || []).find((r) => r.contentGroupType === 'Game');
  return (group?.contents || []).map((g) => ({
    universeId: g.universeId,
    name: g.name,
    description: g.description,
    playing: parseCount(g.playerCount),
    upVotes: parseCount(g.totalUpVotes),
    downVotes: parseCount(g.totalDownVotes),
  }));
}

/** Roblox group info. */
export async function fetchGroup(groupId, opts) {
  const data = await robloxFetch(`https://groups.roblox.com/v1/groups/${groupId}`, opts);
  return {
    id: data?.id,
    name: data?.name,
    description: data?.description,
    memberCount: parseCount(data?.memberCount),
    hasVerifiedBadge: data?.hasVerifiedBadge ?? null,
    url: `https://www.roblox.com/groups/${groupId}`,
  };
}
