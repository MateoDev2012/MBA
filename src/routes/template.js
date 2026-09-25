/**
 * Template, catalogue and discovery routes.
 */

import { randomUUID } from 'node:crypto';
import express from 'express';
import {
  fetchGame,
  fetchVotes,
  fetchFavoritesCount,
  fetchIcon,
  fetchBanners,
  fetchIconsFor,
  fetchBannersFor,
  fetchDetailsFor,
  robloxFetch,
  gameUrl,
  parseCount,
} from '../roblox.js';
import { cache } from '../cache.js';
import { config } from '../config.js';
import { asyncHandler, badRequest, notFound } from '../errors.js';
import { renderTemplate, renderWithMap } from '../template.js';
import { describeFields, FIELD_NAMES } from '../fields.js';
import { normalizeGame } from '../normalize.js';
import { setCacheControl } from './headers.js';

export const router = express.Router();

async function cached(key, ttl, producer) {
  const { value } = await cache.wrap(key, ttl, producer);
  return value;
}

/**
 * Lists every valid placeholder name.
 * GET /api/v1/fields
 *
 * Exposed so that clients can check a name before rendering, and so nobody has
 * to read the docs to discover what is available.
 */
router.get('/fields', (req, res) => {
  setCacheControl(res, 3600);
  res.json({
    ok: true,
    count: FIELD_NAMES.length,
    syntax: {
      default: '{{playing}}',
      exact: '{{playing:raw}}',
      abbreviated: '{{playing:short}}',
      inAttribute: '<img src="{{thumbnail:url}}">',
      attribute: '<span data-rbx-bind="playing"></span>',
    },
    fields: describeFields(),
  });
});

/**
 * Fills the placeholders in an HTML template with live data.
 * POST /api/v1/render  { "universeId": 994732206, "html": "<h1>{{name}}</h1>" }
 *
 * Also accepts GET with ?template=... for quick testing from a browser.
 * GET /api/v1/render?universeId=...&template=...
 */
const renderHandler = asyncHandler(async (req, res) => {
  const body = req.method === 'GET' ? req.query : req.body || {};
  const rawId = body.universeId ?? body.id;
  if (!rawId) throw badRequest('Missing the universeId field');

  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('universeId must be a positive integer');

  const template = body.html ?? body.template;
  if (typeof template !== 'string') {
    throw badRequest('Missing the html field (a string containing your template)');
  }
  if (template.length > config.renderMaxTemplateChars) {
    throw badRequest(
      `Template is too large (max ${config.renderMaxTemplateChars.toLocaleString('en-US')} characters)`
    );
  }

  const onMissing = body.onMissing === 'empty' ? 'empty' : 'keep';

  const [game, votes, favorites, icon, banners] = await Promise.all([
    cached(`game:${id}`, config.ttl.stats, () => fetchGame(id, { signal: req.signal })),
    cached(`votes:${id}`, config.ttl.votes, () => fetchVotes(id, { signal: req.signal })),
    cached(`fav:${id}`, config.ttl.favorites, () => fetchFavoritesCount(id, { signal: req.signal })),
    cached(`icon:${id}`, config.ttl.media, () => fetchIcon(id, { signal: req.signal })),
    cached(`banners:${id}`, config.ttl.media, () => fetchBanners(id, { signal: req.signal })),
  ]);

  // Same normalizer the JSON endpoint uses, so {{upVoteRatio}} can never come
  // back empty while /games/{id} fills it in fine.
  const normalized = normalizeGame(game, {
    upVotes: votes.upVotes,
    downVotes: votes.downVotes,
    favorites,
    thumbnail: icon,
    images: banners,
  });

  const result = renderTemplate(template, normalized, { onMissing });

  // A partial failure is worth surfacing: a typo should not look like "the
  // game has no data".
  if (result.unknown.length > 0) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'UNKNOWN_FIELDS',
        message: `Unknown placeholder(s): ${result.unknown.join(', ')}. See GET /api/v1/fields for the full list.`,
        unknown: result.unknown,
      },
    });
  }

  setCacheControl(res, config.ttl.stats);
  res.json({ ok: true, data: { html: result.html, used: result.used } });
});

router.post('/render', renderHandler);
router.get('/render', renderHandler);

/**
 * Fills placeholders for several games at once.
 * POST /api/v1/render/multi
 * Body: { "html": "{{1234:playing}}", "universeIds": [1234, 5678] }
 */
router.post(
  '/render/multi',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const template = body.html ?? body.template;
    if (typeof template !== 'string') throw badRequest('Missing the html field');

    const ids = (Array.isArray(body.universeIds) ? body.universeIds : String(body.universeIds || '').split(','))
      .map(Number)
      .filter((n) => Number.isSafeInteger(n) && n > 0)
      .slice(0, 50);

    if (ids.length === 0) throw badRequest('Missing or invalid universeIds');

    const idParam = ids.join(',');

    const [gameData, voteData] = await Promise.all([
      cached(`batch:games:${idParam}`, config.ttl.stats, () =>
        robloxFetch(`https://games.roblox.com/v1/games?universeIds=${idParam}`, { signal: req.signal })
      ),
      cached(`batch:votes:${idParam}`, config.ttl.votes, () =>
        robloxFetch(`https://games.roblox.com/v1/games/votes?universeIds=${idParam}`, { signal: req.signal })
      ),
    ]);

    const voteMap = new Map((voteData?.data || []).map((v) => [v.id, v]));
    const byId = {};
    for (const g of gameData?.data || []) {
      const v = voteMap.get(g.id) || {};
      byId[g.id] = normalizeGame(g, { upVotes: v.upVotes, downVotes: v.downVotes });
    }

    const result = renderWithMap(template, byId);
    if (result.unknown.length > 0) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'UNKNOWN_FIELDS',
          message: `Unknown placeholder(s): ${result.unknown.join(', ')}`,
          unknown: result.unknown,
        },
      });
    }

    setCacheControl(res, config.ttl.stats);
    res.json({ ok: true, data: { html: result.html, used: result.used } });
  })
);

/**
 * The most popular games right now.
 * GET /api/v1/trending?limit=20[&includeMedia=true]
 *
 * Roblox removed its public explore/sort endpoint, so this leans on the same
 * search API the website uses, which still returns live player counts.
 *
 * Search hides the creator (creatorName:"" and creatorId:0) and never returns
 * visits, so one extra call fills both in for the whole list. includeMedia
 * additionally attaches thumbnail and banner: images are the opt-in part,
 * because without them a "top games" list is a wall of text, and two calls
 * cover the whole list. Every cache key is the set of ids, so a ranking that
 * has not changed reuses the creator and the images for the full TTL.
 */
router.get(
  '/trending',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const includeMedia = req.query.includeMedia === 'true';

    const games = await cached(`trending:${limit}`, config.ttl.stats, () =>
      fetchTrending(limit, { signal: req.signal })
    );

    let data = games;
    if (games.length > 0) {
      const ids = games.map((g) => g.id);
      const key = ids.join('-');
      const [details, icons, banners] = await Promise.all([
        cached(`trenddetails:${key}`, config.ttl.stats, () =>
          fetchDetailsFor(ids, { signal: req.signal })
        ),
        includeMedia
          ? cached(`trendicons:${key}`, config.ttl.media, () =>
              fetchIconsFor(ids, { signal: req.signal })
            )
          : null,
        includeMedia
          ? cached(`trendbanners:${key}`, config.ttl.media, () =>
              fetchBannersFor(ids, { signal: req.signal })
            )
          : null,
      ]);
      data = games.map((g) => {
        const d = details[g.id];
        const row = {
          ...g,
          // Search has an empty creatorName; games.roblox.com has the real one.
          creator: g.creator || d?.creator?.name || null,
          visits: d ? parseCount(d.visits) : null,
        };
        if (includeMedia) {
          row.thumbnail = icons?.[g.id] || null;
          row.banner = banners?.[g.id] || null;
        }
        return row;
      });
    }

    setCacheControl(res, config.ttl.stats);
    res.json({ ok: true, count: data.length, data });
  })
);

/**
 * Games published by a group.
 * GET /api/v1/groups/:groupId/games?limit=50[&includeStats=true]
 */
router.get(
  '/groups/:groupId(\\d+)/games',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.groupId);
    if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('groupId must be a positive integer');
    // Returned, not just called: without this the rejection escapes asyncHandler
    // and becomes an unhandled rejection that takes the whole process down.
    return creatorGamesHandler('Group', id, req, res);
  })
);

/**
 * Games published by a user.
 * GET /api/v1/users/:userId/games?limit=50[&includeStats=true]
 */
router.get(
  '/users/:userId(\\d+)/games',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.userId);
    if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('userId must be a positive integer');
    return creatorGamesHandler('User', id, req, res);
  })
);

async function creatorGamesHandler(type, id, req, res) {
  const limit = snapLimit(req.query.limit, 50);
  const includeStats = req.query.includeStats === 'true';
  const key = `creatgames:${type}:${id}:${limit}:${includeStats}`;

  let data;
  try {
    data = await cached(key, config.ttl.stats, () =>
      fetchCreatorGames(type === 'Group' ? 'groups' : 'users', id, limit, includeStats, {
        signal: req.signal,
      })
    );
  } catch (err) {
    // Roblox answers a missing group or user with "400 - Group is invalid or
    // does not exist." That is a 404 to the caller, not a bad request.
    if (err?.code === 'UPSTREAM_ERROR' && /does not exist|is invalid/i.test(err.message)) {
      throw notFound(`No ${type.toLowerCase()} found with id ${id}`);
    }
    throw err;
  }

  setCacheControl(res, config.ttl.stats);
  res.json({
    ok: true,
    creator: { type, id },
    count: data.length,
    // Spelled out so nobody reads a null as "this game has zero players".
    note: includeStats
      ? null
      : 'playing is null because this Roblox endpoint does not provide it. Add ?includeStats=true to fill it in.',
    data,
  });
}

/**
 * Shared helper: /v2/{groups|users}/{id}/games
 *
 * Two things are true of this endpoint that are not obvious:
 *
 *  1. It only accepts a fixed set of page sizes; any other value is a 400 that
 *     says so. Snapping to the nearest allowed size keeps requests valid
 *     without making callers care about Roblox's menu.
 *
 *  2. It returns no live player count at all. Its fields are id, name,
 *     description, creator, rootPlace (an object, not rootPlaceId), created,
 *     updated and placeVisits (not visits). Rather than report a fake 0, the
 *     count stays null unless the caller asks for ?includeStats=true, which
 *     fills every game in with one extra batch call.
 */
const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];

function snapLimit(requested, fallback = 10) {
  const n = Number(requested) || fallback;
  if (n <= 10) return 10;
  return ALLOWED_PAGE_SIZES.find((size) => size >= n) ?? 100;
}

async function fetchCreatorGames(kind, id, limit, includeStats, opts) {
  const size = snapLimit(limit);
  const data = await robloxFetch(
    `https://games.roblox.com/v2/${kind}/${id}/games?accessFilter=Public&sortOrder=Asc&limit=${size}`,
    opts
  );

  const games = data?.data || [];

  let playingById = new Map();
  if (includeStats && games.length > 0) {
    const ids = games.map((g) => g.id).join(',');
    const batch = await robloxFetch(
      `https://games.roblox.com/v1/games?universeIds=${ids}`,
      opts
    );
    playingById = new Map((batch?.data || []).map((g) => [g.id, parseCount(g.playing)]));
  }

  return games.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description || '',
    url: gameUrl(g.id),
    // This endpoint nests it as rootPlace: { id, type }.
    rootPlaceId: g.rootPlace?.id ?? null,
    playing: playingById.has(g.id) ? playingById.get(g.id) : null,
    // Named "placeVisits" upstream.
    visits: parseCount(g.placeVisits),
    created: g.created || null,
    updated: g.updated || null,
  }));
}

/**
 * Trending: the most played games right now.
 *
 * Roblox's public explore/sort API is gone, so this leans on the same search
 * API the website uses. Note the response shape: it returns searchResults as
 * MANY separate groups (one game each), not one group with a contents array.
 * Taking the first group silently yields a single game, so everything is
 * flattened first.
 */
async function fetchTrending(limit, opts) {
  const sessionId = randomUUID();
  const data = await robloxFetch(
    `https://apis.roblox.com/search-api/omni-search?searchQuery=Popular&vertical=games` +
      `&pageLimit=${limit}&pageType=all&sessionId=${sessionId}&pageToken=`,
    opts
  );

  const games = (data?.searchResults || [])
    .filter((r) => r.contentGroupType === 'Game')
    .flatMap((r) => r.contents || []);

  const seen = new Set();
  return games
    .filter((g) => g.universeId && !seen.has(g.universeId) && seen.add(g.universeId))
    .map((g) => ({
      id: g.universeId,
      name: g.name,
      url: gameUrl(g.universeId),
      creator: g.creatorName || null,
      playing: parseCount(g.playerCount),
      upVotes: parseCount(g.totalUpVotes),
      downVotes: parseCount(g.totalDownVotes),
      description: g.description || '',
    }))
    .sort((a, b) => b.playing - a.playing)
    .slice(0, limit);
}
