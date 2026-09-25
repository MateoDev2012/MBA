/**
 * roblox-stats-sdk
 *
 * Node client for the Roblox Stats API. Zero dependencies.
 *
 *   import { getGame, search } from 'roblox-stats-sdk';
 *   const game = await getGame(994732206);
 *   console.log(game.name, game.playing, game.ratings.upVotes);
 *
 * Point it at a different server with:
 *   createClient({ baseUrl: 'https://your-api.com' })
 */

const DEFAULT_BASE_URL = 'https://your-domain.com'; // change to your deployment

export class RobloxApiError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message);
    this.name = 'RobloxApiError';
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

function joinUrl(base, path) {
  const cleanBase = base.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  return cleanBase + cleanPath;
}

function buildUrl(baseUrl, path, params) {
  const url = new URL(joinUrl(baseUrl, path));
  for (const key of Object.keys(params || {})) {
    const value = params[key];
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/**
 * Creates a client. One method per endpoint.
 */
export function createClient(options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs || 15000;
  // Only needed if the server you point at has API_KEY_MODE=required; harmless
  // otherwise. Read from the environment too, so a server-side app does not
  // have to hardcode it in source.
  const apiKey = options.apiKey || process.env.ROBLOX_API_KEY || '';
  // Content-Type is needed for the POST endpoints (render, renderMulti).
  const headers = Object.assign(
    { Accept: 'application/json', 'Content-Type': 'application/json' },
    apiKey ? { 'X-API-Key': apiKey } : null,
    options.headers || {}
  );

  async function request(path, opts) {
    const settings = opts || {};
    const url = buildUrl(baseUrl, path, settings.params);
    const externalSignal = settings.signal;
    const method = (settings.method || 'GET').toUpperCase();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const forwardAbort = () => controller.abort();
    if (externalSignal) {
      externalSignal.addEventListener('abort', forwardAbort, { once: true });
    }

    // Only attach a body when there is one, otherwise fetch rejects a GET
    // that carries a body.
    const init = { method, headers, signal: controller.signal };
    if (settings.body !== undefined) {
      init.body = JSON.stringify(settings.body);
    }

    try {
      const res = await fetch(url, init);
      const text = await res.text();

      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch (parseErr) {
        throw new RobloxApiError('The response is not JSON (HTTP ' + res.status + ')', {
          status: res.status,
          code: 'INVALID_RESPONSE',
          cause: parseErr,
        });
      }

      if (!res.ok || body.ok === false) {
        const info = body && body.error ? body.error : {};
        throw new RobloxApiError(info.message || 'HTTP ' + res.status, {
          status: res.status,
          code: info.code,
        });
      }
      return body.data !== undefined ? body.data : body;
    } catch (err) {
      if (err instanceof RobloxApiError) throw err;
      if (err && err.name === 'AbortError') {
        throw new RobloxApiError('The request to ' + url.pathname + ' took longer than ' + timeoutMs + 'ms', {
          code: 'TIMEOUT',
        });
      }
      throw new RobloxApiError('Could not reach the API: ' + err.message, {
        code: 'NETWORK_ERROR',
        cause: err,
      });
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', forwardAbort);
      }
    }
  }

  return {
    baseUrl,

    /** Full game: stats, creator, votes, favorites, logo, banners and media. */
    getGame(universeId, opts) {
      return request('/api/v1/games/' + universeId, opts);
    },

    /** Lighter version: the essentials for cards and listings. */
    getGameQuick(universeId, opts) {
      return request('/api/v1/games/' + universeId + '/quick', opts);
    },

    /** Several games in one call (up to 50). */
    batch(universeIds, opts) {
      const settings = opts || {};
      const ids = Array.isArray(universeIds) ? universeIds.join(',') : String(universeIds);
      return request('/api/v1/games/batch', {
        signal: settings.signal,
        params: Object.assign({ ids: ids }, settings.params || {}),
      });
    },

    /** Search for games by name. */
    search(query, opts) {
      const settings = opts || {};
      return request('/api/v1/search', {
        signal: settings.signal,
        params: Object.assign({ q: query, limit: settings.limit || 10 }, settings.params || {}),
      });
    },

    /** Turns a Roblox URL into its universeId. */
    resolve(url, opts) {
      const settings = opts || {};
      return request('/api/v1/resolve', {
        signal: settings.signal,
        params: Object.assign({ url: url }, settings.params || {}),
      });
    },

    /** Game passes. includePrices costs one extra call per pass. */
    getGamePasses(universeId, opts) {
      const settings = opts || {};
      return request('/api/v1/games/' + universeId + '/game-passes', {
        signal: settings.signal,
        params: Object.assign(
          { includePrices: settings.includePrices === true },
          settings.params || {}
        ),
      });
    },

    /** Badges / achievements. */
    getBadges(universeId, opts) {
      return request('/api/v1/games/' + universeId + '/badges', opts);
    },

    /** Creator and group data, when the owner is a group. */
    getDeveloper(universeId, opts) {
      return request('/api/v1/games/' + universeId + '/developer', opts);
    },

    /** Details about a Roblox group. */
    getGroup(groupId, opts) {
      return request('/api/v1/groups/' + groupId, opts);
    },

    /**
     * Games published by a group.
     *
     * Roblox's own endpoint does not report live player counts, so `playing`
     * is null unless includeStats is true, which fills it in with one extra
     * batch call. A null means "not provided", never "zero players".
     *
     * Roblox only accepts page sizes of 10, 25, 50 or 100; other values are
     * rounded up to the next allowed one.
     */
    getGroupGames(groupId, opts) {
      const settings = opts || {};
      return request('/api/v1/groups/' + groupId + '/games', {
        signal: settings.signal,
        params: Object.assign(
          {
            limit: settings.limit || 50,
            includeStats: settings.includeStats === true,
          },
          settings.params || {}
        ),
      });
    },

    /** Games published by a user. Same options as getGroupGames. */
    getUserGames(userId, opts) {
      const settings = opts || {};
      return request('/api/v1/users/' + userId + '/games', {
        signal: settings.signal,
        params: Object.assign(
          {
            limit: settings.limit || 50,
            includeStats: settings.includeStats === true,
          },
          settings.params || {}
        ),
      });
    },

    /** The most played games right now, sorted by live player count. */
    trending(opts) {
      const settings = opts || {};
      return request('/api/v1/trending', {
        signal: settings.signal,
        params: Object.assign({ limit: settings.limit || 20 }, settings.params || {}),
      });
    },

    /**
     * Every valid placeholder name, with its type and whether it abbreviates.
     * Useful for validating user input before rendering a template.
     */
    fields(opts) {
      return request('/api/v1/fields', opts);
    },

    /**
     * Fills {{placeholders}} in an HTML string with live data.
     *
     *   render({ html: '<b>{{playing}}</b> in {{name}}' }, { universeId })
     *   -> '<b>248.3K</b> in Blox Fruits'
     *
     * Throws RobloxApiError with code UNKNOWN_FIELDS if a name is not valid,
     * so a typo surfaces instead of leaving a blank gap on the page.
     */
    render(universeId, html, opts) {
      const settings = opts || {};
      return request('/api/v1/render', {
        method: 'POST',
        signal: settings.signal,
        body: {
          universeId: universeId,
          html: html,
          onMissing: settings.onMissing,
        },
      });
    },

    /**
     * Same, for several games at once. Address a specific game with
     * "{{universeId:field}}", e.g. '{{994732206:playing:short}}'.
     */
    renderMulti(html, universeIds, opts) {
      const settings = opts || {};
      return request('/api/v1/render/multi', {
        method: 'POST',
        signal: settings.signal,
        body: { html: html, universeIds: universeIds },
      });
    },

    /** Service status. */
    health(opts) {
      return request('/health', opts);
    },
  };
}

/** Default client, so you can import without configuring anything. */
const defaultClient = createClient();

export const getGame = (id, opts) => defaultClient.getGame(id, opts);
export const getGameQuick = (id, opts) => defaultClient.getGameQuick(id, opts);
export const batch = (ids, opts) => defaultClient.batch(ids, opts);
export const search = (q, opts) => defaultClient.search(q, opts);
export const resolve = (url, opts) => defaultClient.resolve(url, opts);
export const getGamePasses = (id, opts) => defaultClient.getGamePasses(id, opts);
export const getBadges = (id, opts) => defaultClient.getBadges(id, opts);
export const getDeveloper = (id, opts) => defaultClient.getDeveloper(id, opts);
export const getGroup = (id, opts) => defaultClient.getGroup(id, opts);
export const getGroupGames = (id, opts) => defaultClient.getGroupGames(id, opts);
export const getUserGames = (id, opts) => defaultClient.getUserGames(id, opts);
export const trending = (opts) => defaultClient.trending(opts);
export const fields = (opts) => defaultClient.fields(opts);
export const render = (id, html, opts) => defaultClient.render(id, html, opts);
export const renderMulti = (html, ids, opts) => defaultClient.renderMulti(html, ids, opts);

export default defaultClient;
