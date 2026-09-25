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

const config = {
  userAgent: process.env.USER_AGENT || 'RobloxStatsAPI/1.0',
  timeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS || 10000),
};

/** Error raised for a failed Roblox response. */
export class RobloxError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message);
    this.name = 'RobloxError';
    this.status = status ?? 502;
    this.code = code ?? 'UPSTREAM_ERROR';
    this.cause = cause;
  }
}

/**
 * GET request to Roblox with timeout, retries and typed errors.
 */
export async function robloxFetch(url, { retries = 2, signal } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
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
        throw new RobloxError('Roblox is rate limiting requests (429)', {
          status: 429,
          code: 'UPSTREAM_RATE_LIMITED',
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
      const isDefinitive =
        err instanceof RobloxError &&
        (err.code === 'NOT_FOUND' || err.code === 'UPSTREAM_RATE_LIMITED');

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
