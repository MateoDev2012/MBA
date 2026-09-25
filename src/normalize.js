/**
 * Normalization: turns a raw Roblox game object into this API's response shape.
 *
 * Lives in its own module so the game routes and the template routes cannot
 * drift apart. If they each had their own copy, the template would slowly
 * start returning null for fields the JSON endpoint fills in fine.
 */

import { gameUrl, parseCount, parseIsoDate } from './roblox.js';

/**
 * @param {object} game  raw game from games.roblox.com
 * @param {object} extras { upVotes, downVotes, favorites, thumbnail, images, media }
 */
export function normalizeGame(game, extras = {}) {
  const upVotes = parseCount(extras.upVotes);
  const downVotes = parseCount(extras.downVotes);
  const totalVotes = upVotes + downVotes;
  const favorites = parseCount(extras.favorites);
  const images = extras.images || [];

  return {
    id: game.id,
    name: game.name,
    description: game.description || '',
    url: gameUrl(game.id),
    rootPlaceId: game.rootPlaceId ?? null,
    playing: parseCount(game.playing),
    visits: parseCount(game.visits),
    maxPlayers: parseCount(game.maxPlayers),
    created: parseIsoDate(game.created),
    updated: parseIsoDate(game.updated),
    genre: game.genre ?? null,
    copyingAllowed: game.copyingAllowed ?? null,
    creator: game.creator
      ? {
          id: game.creator.id,
          name: game.creator.name,
          type: game.creator.type, // 'User' | 'Group'
          hasVerifiedBadge: game.creator.hasVerifiedBadge ?? false,
          url:
            game.creator.type === 'Group'
              ? `https://www.roblox.com/groups/${game.creator.id}`
              : `https://www.roblox.com/users/${game.creator.id}/profile`,
        }
      : null,
    ratings: {
      upVotes,
      downVotes,
      totalVotes,
      // Share of positive votes (0-100, one decimal).
      upVoteRatio: totalVotes > 0 ? Math.round((upVotes / totalVotes) * 1000) / 10 : 0,
      favorites,
    },
    thumbnail: extras.thumbnail || null,
    images,
    media: extras.media || [],
  };
}
