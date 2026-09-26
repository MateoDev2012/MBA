/**
 * API routes. Each endpoint returns Roblox data already normalized (numbers as
 * numbers, dates as ISO strings, direct image URLs) so consumers never have to
 * know Roblox's API or its quirks.
 */

import express from 'express';
import {
  fetchGame,
  fetchVotes,
  fetchFavoritesCount,
  fetchIcon,
  fetchBanners,
  fetchMedia,
  fetchDeveloperInfo,
  fetchGamePasses,
  fetchBadges,
  resolveUniverseFromPlace,
  searchGames,
  fetchGroup,
  robloxFetch,
  gameUrl,
  parseCount,
} from '../roblox.js';
import { cache } from '../cache.js';
import { config } from '../config.js';
import { asyncHandler, badRequest, notFound } from '../errors.js';
import { setCacheControl } from './headers.js';
import { normalizeGame } from '../normalize.js';
import { fetchTrending } from './template.js';

export const router = express.Router();

/** Validates and normalizes a universeId. */
function requireUniverseId(raw) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw badRequest('universeId must be a positive integer');
  }
  return id;
}

/** Caches with the configured TTL and returns the value. */
async function cached(key, ttl, producer) {
  const { value } = await cache.wrap(key, ttl, producer);
  return value;
}

/**
 * Tells browsers and any CDN in front of us how long this response may be
 * reused. This is what lets Cloudflare (or nginx, or a browser) answer most
 * requests without us ever calling Roblox, which is the difference between an
 * API that stays up and one that gets rate limited into uselessness.
 *
 * TTL is the shortest of the caches involved, so the header can never claim
 * more freshness than the data actually has.
 */


/**
 * Main endpoint: everything important about a game in one call.
 * GET /api/v1/games/:universeId
 */
router.get(
  '/games/:universeId(\\d+)',
  asyncHandler(async (req, res) => {
    const id = requireUniverseId(req.params.universeId);

    // Fetched in parallel, each with its own cache entry and TTL.
    const [game, votes, favorites, icon, banners, media] = await Promise.all([
      cached(`game:${id}`, config.ttl.stats, () => fetchGame(id, { signal: req.signal })),
      cached(`votes:${id}`, config.ttl.votes, () => fetchVotes(id, { signal: req.signal })),
      cached(`fav:${id}`, config.ttl.favorites, () =>
        fetchFavoritesCount(id, { signal: req.signal })
      ),
      cached(`icon:${id}`, config.ttl.media, () => fetchIcon(id, { signal: req.signal })),
      cached(`banners:${id}`, config.ttl.media, () => fetchBanners(id, { signal: req.signal })),
      cached(`media:${id}`, config.ttl.media, () => fetchMedia(id, { signal: req.signal })),
    ]);

    // Bounded by the stats TTL: active players are the fastest-changing field.
    setCacheControl(res, config.ttl.stats);
    res.json({
      ok: true,
      data: normalizeGame(game, {
        upVotes: votes.upVotes,
        downVotes: votes.downVotes,
        favorites,
        thumbnail: icon,
        images: banners,
        media,
      }),
    });
  })
);

/**
 * Lightweight version: essentials for cards and widgets, without heavy media.
 * GET /api/v1/games/:universeId/quick
 */
router.get(
  '/games/:universeId(\\d+)/quick',
  asyncHandler(async (req, res) => {
    const id = requireUniverseId(req.params.universeId);

    const [game, votes, icon, banners] = await Promise.all([
      cached(`game:${id}`, config.ttl.stats, () => fetchGame(id, { signal: req.signal })),
      cached(`votes:${id}`, config.ttl.votes, () => fetchVotes(id, { signal: req.signal })),
      cached(`icon:${id}`, config.ttl.media, () => fetchIcon(id, { signal: req.signal })),
      cached(`banners:${id}`, config.ttl.media, () => fetchBanners(id, { signal: req.signal })),
    ]);

    setCacheControl(res, config.ttl.stats);
    res.json({
      ok: true,
      data: {
        id: game.id,
        name: game.name,
        url: gameUrl(game.id),
        playing: parseCount(game.playing),
        visits: parseCount(game.visits),
        upVotes: votes.upVotes,
        downVotes: votes.downVotes,
        upVoteRatio:
          votes.upVotes + votes.downVotes > 0
            ? Math.round((votes.upVotes / (votes.upVotes + votes.downVotes)) * 1000) / 10
            : 0,
        creator: game.creator?.name ?? null,
        thumbnail: icon,
        banner: banners[0] || null,
      },
    });
  })
);

/**
 * Several games in one call (up to 50) for listings.
 * GET /api/v1/games/batch?ids=1,2,3
 */
router.get(
  '/games/batch',
  asyncHandler(async (req, res) => {
    const raw = req.query.ids;
    if (!raw) throw badRequest('Missing the ids parameter, e.g. ?ids=1,2,3');

    const list = (Array.isArray(raw) ? raw : String(raw).split(','))
      .map((v) => Number(v))
      .filter((n) => Number.isSafeInteger(n) && n > 0)
      .slice(0, 50);

    if (list.length === 0) throw badRequest('ids does not contain a valid id');

    // games.roblox.com and thumbnails accept several comma-separated ids.
    const idsParam = list.join(',');

    const [gameData, voteData, iconData, bannerData] = await Promise.all([
      cached(`batch:games:${idsParam}`, config.ttl.stats, () =>
        robloxFetch(`https://games.roblox.com/v1/games?universeIds=${idsParam}`, {
          signal: req.signal,
        })
      ),
      cached(`batch:votes:${idsParam}`, config.ttl.votes, () =>
        robloxFetch(`https://games.roblox.com/v1/games/votes?universeIds=${idsParam}`, {
          signal: req.signal,
        })
      ),
      robloxFetch(
        `https://thumbnails.roblox.com/v1/games/icons?universeIds=${idsParam}&size=150x150&format=Png&isCircular=false`,
        { signal: req.signal }
      ),
      robloxFetch(
        `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${idsParam}&size=768x432&format=Png&isCircular=false`,
        { signal: req.signal }
      ),
    ]);

    const voteMap = new Map((voteData?.data || []).map((v) => [v.id, v]));
    const iconMap = new Map(
      (iconData?.data || [])
        .filter((i) => i.state === 'Completed')
        .map((i) => [i.targetId, i.imageUrl])
    );
    const bannerMap = new Map(
      (bannerData?.data || [])
        .filter((b) => !b.error)
        .map((b) => [
          b.universeId,
          (b.thumbnails || []).filter((t) => t.state === 'Completed').map((t) => t.imageUrl),
        ])
    );

    const data = (gameData?.data || []).map((game) => {
      const v = voteMap.get(game.id);
      const upVotes = parseCount(v?.upVotes);
      const downVotes = parseCount(v?.downVotes);
      return {
        id: game.id,
        name: game.name,
        url: gameUrl(game.id),
        playing: parseCount(game.playing),
        visits: parseCount(game.visits),
        upVotes,
        downVotes,
        upVoteRatio:
          upVotes + downVotes > 0 ? Math.round((upVotes / (upVotes + downVotes)) * 1000) / 10 : 0,
        creator: game.creator?.name ?? null,
        thumbnail: iconMap.get(game.id) || null,
        banner: (bannerMap.get(game.id) || [])[0] || null,
      };
    });

    setCacheControl(res, config.ttl.stats);
    res.json({ ok: true, count: data.length, data });
  })
);

/**
 * Resolves a Roblox URL to its universeId.
 * Accepts https://www.roblox.com/games/12345-slug, /games/123, /games/123/Place, ...
 * GET /api/v1/resolve?url=...
 */
router.get(
  '/resolve',
  asyncHandler(async (req, res) => {
    const url = req.query.url;
    if (!url) throw badRequest('Missing the url parameter');

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw badRequest('The url is not valid');
    }
    if (!/(^|\.)roblox\.com$/i.test(parsed.hostname)) {
      throw badRequest('Only roblox.com URLs are allowed');
    }

    // Roblox uses two shapes of URL:
    //   /games/{universeId}/{slug} -> the id already is the universeId
    //   /games/{placeId}/Place    -> the id is a placeId, must be converted
    //   /place/{placeId}          -> same, older form
    const match = parsed.pathname.match(/\/(games|place)\/(\d+)(?:\/([^/]+))?/);
    let universeId = null;
    let placeId = null;

    if (match) {
      const [, kind, idRaw, slug] = match;
      const id = Number(idRaw);

      // The "Place" slug is the tell that the id is a placeId, not a universeId.
      const isPlaceUrl = kind === 'place' || /^place$/i.test(slug || '');

      if (isPlaceUrl) {
        placeId = id;
        universeId = await cached(`place:${id}`, config.ttl.media, () =>
          resolveUniverseFromPlace(id, { signal: req.signal })
        );
        if (!universeId) {
          throw notFound(`The placeId ${id} does not belong to any public game`);
        }
      } else {
        universeId = id;
      }
    }

    if (!universeId) {
      throw notFound('Could not extract a game id from that URL');
    }

    setCacheControl(res, config.ttl.media);
    res.json({ ok: true, data: { universeId, placeId, url: gameUrl(universeId) } });
  })
);

/**
 * Searches for games by name. GET /api/v1/search?q=blox+fruits&limit=10
 *
 * q=* (or q=anything) is treated as "no filter" and answered from /trending,
 * so a front end with an empty search box has one URL to call instead of
 * special-casing an empty string. Roblox has no browse-everything endpoint, so
 * "no filter" can only ever mean "the current popular list".
 */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = req.query.q;
    if (!q || !String(q).trim()) throw badRequest('Missing the q parameter');

    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const query = String(q).trim();

    if (query === '*') {
      const games = await cached(`trending:${limit}`, config.ttl.stats, () =>
        fetchTrending(limit, { signal: req.signal })
      );
      setCacheControl(res, config.ttl.stats);
      res.json({
        ok: true,
        query,
        count: games.length,
        meta: { total: games.length, totalPages: 1, page: 1, limit, sort: 'playing' },
        data: games.map((g) => ({ ...g, url: gameUrl(g.universeId) })),
      });
      return;
    }

    const data = await cached(`search:${query}:${limit}`, config.ttl.votes, () =>
      searchGames(query, limit, { signal: req.signal })
    );

    setCacheControl(res, config.ttl.votes);
    res.json({
      ok: true,
      query,
      count: data.length,
      meta: { total: data.length, totalPages: 1, page: 1, limit, sort: 'relevance' },
      data: data.map((g) => ({ ...g, url: gameUrl(g.universeId) })),
    });
  })
);

/** Game passes. GET /api/v1/games/:universeId/game-passes[?includePrices=true] */
router.get(
  '/games/:universeId(\\d+)/game-passes',
  asyncHandler(async (req, res) => {
    const id = requireUniverseId(req.params.universeId);
    const includePrices = req.query.includePrices === 'true';
    const data = await cached(`passes:${id}:${includePrices}`, config.ttl.media, () =>
      fetchGamePasses(id, { signal: req.signal, includePrices })
    );
    setCacheControl(res, config.ttl.media);
    res.json({ ok: true, count: data.length, data });
  })
);

/** Badges. GET /api/v1/games/:universeId/badges */
router.get(
  '/games/:universeId(\\d+)/badges',
  asyncHandler(async (req, res) => {
    const id = requireUniverseId(req.params.universeId);
    const data = await cached(`badges:${id}`, config.ttl.media, () =>
      fetchBadges(id, { signal: req.signal })
    );
    setCacheControl(res, config.ttl.media);
    res.json({ ok: true, count: data.length, data });
  })
);

/** Developer data. GET /api/v1/games/:universeId/developer */
router.get(
  '/games/:universeId(\\d+)/developer',
  asyncHandler(async (req, res) => {
    const id = requireUniverseId(req.params.universeId);
    const [game, dev] = await Promise.all([
      cached(`game:${id}`, config.ttl.stats, () => fetchGame(id, { signal: req.signal })),
      cached(`dev:${id}`, config.ttl.stats, () => fetchDeveloperInfo(id, { signal: req.signal })),
    ]);

    let group = null;
    if (game.creator?.type === 'Group') {
      group = await cached(`group:${game.creator.id}`, config.ttl.favorites, () =>
        fetchGroup(game.creator.id, { signal: req.signal }).catch(() => null)
      );
    }

    setCacheControl(res, config.ttl.stats);
    res.json({ ok: true, data: { ...dev, group } });
  })
);

/** Group info. GET /api/v1/groups/:groupId */
router.get(
  '/groups/:groupId(\\d+)',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.groupId);
    if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('groupId must be a positive integer');

    const data = await cached(`group:${id}`, config.ttl.favorites, () =>
      fetchGroup(id, { signal: req.signal })
    );
    setCacheControl(res, config.ttl.favorites);
    res.json({ ok: true, data });
  })
);
