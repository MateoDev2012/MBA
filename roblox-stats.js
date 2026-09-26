/**
 * Roblox Stats API — the one file you need.
 *
 * Copy this single file into your project, add one <script> tag, and write the
 * name of the stat wherever you want it. No build step, no framework, no
 * bundler, no API key. Works on any static host, including GitHub Pages.
 *
 *   1) Auto-fill (simplest): set a global game ID, then write stat names anywhere
 *
 *      <script>
 *        window.RBX_GAME_ID = '994732206';  // your game's universeId
 *      </script>
 *      <script src="https://YOUR-DOMAIN.com/roblox-stats.js"></script>
 *
 *      <h2>{{name}}</h2>
 *      <p>{{playing}} players right now · {{likes}} likes</p>
 *      <img data-rbx-set="src=thumbnail:url">
 *
 *   2) Auto-fill (per-element scope): put the game id on an element
 *
 *      <body data-rbx-game="994732206">
 *        <h2>{{name}}</h2>
 *        <p>{{playing}} players right now · {{likes}} likes</p>
 *        <img data-rbx-set="src=thumbnail:url">
 *      </script src="https://YOUR-DOMAIN.com/roblox-stats.js"></script>
 *
 *   3) Ready-made card: put a game id in an empty div
 *
 *      <div data-roblox-game="994732206"></div>
 *      <script src="https://YOUR-DOMAIN.com/roblox-stats.js"></script>
 *
 *   If you host this file yourself, point it at the API first:
 *
 *      <script>window.ROBLOX_API_BASE = 'https://YOUR-DOMAIN.com';</script>
 *      <script src="/js/roblox-stats.js"></script>
 *
 * -----------------------------------------------------------------------------
 * Attribution
 * -----------------------------------------------------------------------------
 *
 * A small "MBA / Made by Moonlight Studios" badge is added to the page, with
 * "Moonlight Studios" linking to your site. It is required: delete it and this
 * file stops loading data, the page says why, and a Restore button brings it
 * back. That is what keeps the API free to use.
 *
 * You can restyle it from your own stylesheet (#rbxw-credit), and change the
 * wording or the link in the CREDIT object near the top of this file.
 *
 * -----------------------------------------------------------------------------
 * Two settings, near the top of this file
 * -----------------------------------------------------------------------------
 *
 *   var SITE_URL = '';                        where the badge links to
 *   var API_KEY  = 'Made by MoonlightStudios'; sent as X-API-Key on every call
 *
 * A note on the key, because it surprises people: it is NOT a secret. This file
 * is public, so anyone can read the key with view-source, and so can you. Treat
 * it as a name, not a password. What it buys you is a rate limit you control,
 * the ability to revoke one caller without restarting anything, and optional
 * domain locking. It does not make the data private.
 *
 * -----------------------------------------------------------------------------
 * Global config (optional, set BEFORE the script loads)
 * -----------------------------------------------------------------------------
 *
 *   window.RBX_GAME_ID = '994732206';              // default game for {{placeholders}}
 *   // or
 *   window.RobloxStatsConfig = { gameId: '994732206' };
 *
 * If set, you don't need data-rbx-game on the body. Placeholders work globally.
 *
 * -----------------------------------------------------------------------------
 * Syntax
 * -----------------------------------------------------------------------------
 *
 * Placeholders
 *   {{field}}         auto-abbreviated when it reads better (245.4K)
 *   {{field:raw}}     the exact number (245412)
 *   {{field:short}}   always abbreviated (245.4K)
 *   {{field:url}}     escaped for src="..."
 *   {{id:field}}      address a specific game, for several on one page
 *
 * Attributes
 *   <span data-rbx-bind="playing"></span>        sets the element's text
 *   <img  data-rbx-set="src=thumbnail:url">      sets an attribute
 *
 * For images prefer data-rbx-set over src="{{thumbnail:url}}": a literal src
 * makes the browser start a request for the placeholder text before this script
 * runs, which shows up as a 404 in the console on every page load. data-rbx-set
 * assigns the attribute only once the real URL is known.
 *
 * Card options, on the div with data-roblox-game
 *   data-roblox-theme    "dark" (default) | "light"
 *   data-roblox-fields   "stats" (default) | "compact"
 *   data-roblox-refresh  seconds between automatic updates (0 = never)
 *
 * Auto-fill options
 *   data-rbx-refresh="60"   re-read the data every 60 seconds
 *
 * -----------------------------------------------------------------------------
 * How it works
 * -----------------------------------------------------------------------------
 *
 * Scopes: every element carrying data-rbx-game owns the placeholders inside it,
 * so a card for game B nested in a page about game A keeps its own numbers.
 *
 * One request per distinct game, no matter how many scopes mention it.
 *
 * A field name that does not exist is reported in the console instead of being
 * left blank: a blank box is impossible to debug, a typo you find in ten
 * seconds is not. GET /api/v1/fields returns the authoritative list.
 *
 * The catalogue of names below mirrors src/fields.js. A browser script cannot
 * import server modules, so the list is repeated here on purpose, and
 * scripts/smoke.js compares the two so they cannot drift apart unnoticed.
 *
 * This file injects no global styles other than the widget's own, which are all
 * prefixed with .rbxw-, so it cannot break the design of the host page.
 */

(function () {
  'use strict';

  console.error('[roblox-stats] SCRIPT START');

  // ==========================================================================
  // Moonlight Studios — attribution
  // ==========================================================================
  //
  // The credit line is required. Delete it and this file stops fetching: the
  // placeholders stay as {{playing}} and the cards show an error. This is the
  // only part of the API a third-party site cannot quietly take for free, so it
  // is enforced rather than merely requested.
  //
  // ------------------------------------------------------------------
  // Your two settings. These are the only lines you need to touch.
  // ------------------------------------------------------------------
  var SITE_URL = 'https://ms-mba.up.railway.app'; // where the credit badge links to

  var API_KEY = 'Made by MoonlightStudios'; // sent as X-API-Key on every request

  var CREDIT = {
    tag: 'MBA',
    // Split so the badge can link only the name and keep the rest plain.
    before: 'Made by ',
    linkText: 'Moonlight Studios',
    after: '',
    get url() {
      return SITE_URL;
    },
  };

  var CREDIT_ID = 'rbxw-credit';
  // One place to change if the wording is ever edited, used in three messages.
  var CREDIT_LABEL = CREDIT.before + CREDIT.linkText + CREDIT.after;
  var CREDIT_OFF_MESSAGE =
    'turned off because the "' + CREDIT_LABEL + '" credit is missing or hidden';
  var creditEl = null;
  var creditBlocked = false;
  var creditNotice = null;

  // ==========================================================================
  // Where the API lives
  // ==========================================================================
  //
  // An explicit override always wins, and it has to be checked FIRST. When this
  // file is copied into somebody else's project, document.currentScript points
  // at THEIR domain, not the API's, so deriving the base from it would send
  // every request to the wrong server and fail with a confusing JSON error.
  var API_BASE = (function () {
    if (window.ROBLOX_API_BASE) return String(window.ROBLOX_API_BASE).replace(/\/+$/, '');
    try {
      var s = document.currentScript;
      if (s && s.src) return s.src.replace(/\/roblox-stats\.js.*$/, '');
    } catch (_) {
      /* document.currentScript is null in very old browsers */
    }
    return '';
  })();

  // ==========================================================================
  // Field catalogue
  // ==========================================================================

  var NUMERIC = {
    playing: 1, visits: 1, maxPlayers: 1, likes: 1, upVotes: 1, downVotes: 1,
    favorites: 1, upVoteRatio: 1, totalVotes: 1
  };
  // Fields that read better abbreviated by default.
  var ABBREV = {
    playing: 1, visits: 1, likes: 1, upVotes: 1, downVotes: 1, favorites: 1, totalVotes: 1
  };
  var SUFFIX = { upVoteRatio: '%' };

  var KNOWN = new Set(Object.keys(NUMERIC).concat([
    'name', 'id', 'description', 'url', 'thumbnail', 'banner',
    'creator', 'creatorType', 'creatorUrl', 'created', 'updated'
  ]));

  // ==========================================================================
  // Formatting
  // ==========================================================================

  function abbreviate(n) {
    var num = Number(n);
    if (!isFinite(num)) return String(n);
    var abs = Math.abs(num);
    if (abs >= 1e12) return trim(num / 1e12) + 'T';
    if (abs >= 1e9) return trim(num / 1e9) + 'B';
    if (abs >= 1e6) return trim(num / 1e6) + 'M';
    if (abs >= 1e4) return trim(num / 1e3) + 'K';
    return group(num);
  }
  function trim(n) { return n.toFixed(1).replace(/\.0$/, ''); }
  function group(n) { return Number(n).toLocaleString('en-US'); }

  /** 1290 -> "1.3K", the way roblox.com itself writes it. */
  function short(n) {
    var num = Number(n);
    if (typeof num !== 'number' || !isFinite(num)) return '0';
    if (num >= 1e9) return trim(num / 1e9) + 'B';
    if (num >= 1e6) return trim(num / 1e6) + 'M';
    if (num >= 1e3) return trim(num / 1e3) + 'K';
    return String(num);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render(name, value, mode) {
    if (value === null || value === undefined || value === '') return '';
    if (mode === 'url') return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    if (mode === 'raw') return escapeHtml(String(value));
    if (NUMERIC[name]) {
      var text = (mode === 'short' || (mode === 'text' && ABBREV[name]))
        ? abbreviate(value)
        : group(value);
      return text + (SUFFIX[name] || '');
    }
    return escapeHtml(String(value));
  }

  /** Pulls a field out of the /games/{id} payload. */
  function read(game, name) {
    switch (name) {
      case 'name': return game.name;
      case 'id': return game.id;
      case 'description': return game.description;
      case 'url': return game.url;
      case 'thumbnail': return game.thumbnail;
      case 'banner': return (game.images && game.images[0]) || null;
      case 'playing': return game.playing;
      case 'visits': return game.visits;
      case 'maxPlayers': return game.maxPlayers;
      case 'likes': case 'upVotes': return game.ratings && game.ratings.upVotes;
      case 'downVotes': return game.ratings && game.ratings.downVotes;
      case 'favorites': return game.ratings && game.ratings.favorites;
      case 'totalVotes': return game.ratings && game.ratings.totalVotes;
      case 'upVoteRatio': return game.ratings && game.ratings.upVoteRatio;
      case 'creator': return game.creator && game.creator.name;
      case 'creatorType': return game.creator && game.creator.type;
      case 'creatorUrl': return game.creator && game.creator.url;
      case 'created': return game.created;
      case 'updated': return game.updated;
      default: return undefined;
    }
  }

  // ==========================================================================
  // Auto-fill
  // ==========================================================================

  /**
   * The scope a node belongs to: its nearest ancestor-or-self with
   * data-rbx-game, or null if it sits outside every scope.
   *
   * This is what stops an outer scope from overwriting a nested one. Filling
   * only the nodes whose owner is this scope means a card for game B inside a
   * page about game A is never touched by game A's data.
   */
  function scopeOf(node) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.documentElement) {
      if (el.getAttribute && el.getAttribute('data-rbx-game')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function allScopes() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-rbx-game]'));
  }

  // Matches: {{field}}, {{field:raw}}, {{12345:field}}, {{12345:field:raw}}
  // Group 1 = optional gameId (digits), Group 2 = field name, Group 3 = optional mode
  var PLACEHOLDER = /\{\{\s*(?:(\d+):)?([a-zA-Z][a-zA-Z0-9_]*)\s*(?::\s*(raw|short|url|text)\s*)?\}\}/g;

  // Cache for inline game IDs so we don't fetch the same game twice
  var inlineGameCache = {};

  function getInlineGame(id) {
    if (inlineGameCache[id]) return Promise.resolve(inlineGameCache[id]);
    return loadGame(id).then(function (g) {
      inlineGameCache[id] = g;
      return g;
    });
  }

  function fillPlaceholdersIn(text, defaultGame, problems) {
    PLACEHOLDER.lastIndex = 0;
    return text.replace(PLACEHOLDER, function (whole, inlineId, name, mode) {
      if (!KNOWN.has(name)) {
        problems.push(name);
        return whole;
      }
      // If inline gameId specified, use that game; otherwise use scope's game
      var targetGame = inlineId
        ? inlineGameCache[inlineId]  // may be undefined if not loaded yet
        : defaultGame;
      if (inlineId && !targetGame) {
        // Game not loaded yet — leave placeholder, will retry after load
        return whole;
      }
      return render(name, read(targetGame, name), mode || 'text');
    });
  }

  // Second pass: fill any placeholders that had inline IDs not yet loaded
  function fillPendingInline(text, problems) {
    PLACEHOLDER.lastIndex = 0;
    return text.replace(PLACEHOLDER, function (whole, inlineId, name, mode) {
      if (!inlineId || !KNOWN.has(name)) return whole;
      var game = inlineGameCache[inlineId];
      if (!game) return whole; // still not loaded
      return render(name, read(game, name), mode || 'text');
    });
  }

  /**
   * Fills every node owned by `scope` with data from `game`.
   * Passing scope = document.body with no data-rbx-game fills the whole page.
   * Also supports inline game IDs: {{12345:playing}} uses game 12345 regardless of scope.
   */
  function fill(scope, game) {
    console.error('[roblox-stats] fill called, scope:', scope.tagName, 'game:', game ? game.name : 'none');
    var problems = [];
    
    // When scope is document.body without data-rbx-game, it owns all descendant nodes.
    // Otherwise, a node is owned by the nearest ancestor with data-rbx-game.
    var ownsNode;
    if (scope === document.body && !scope.getAttribute('data-rbx-game')) {
      ownsNode = function (node) { return scope.contains(node); };
    } else {
      ownsNode = function (node) { return scopeOf(node) === scope; };
    }
    
    console.error('[roblox-stats] fill: ownsNode test for body:', ownsNode(document.body));
    console.error('[roblox-stats] fill: ownsNode test for p:', ownsNode(document.querySelector('p')));

    // Track which inline game IDs we've seen and need to load
    var seenInlineIds = {};

    // Helper: run fillPlaceholdersIn and collect seen inline IDs
    function fillAndTrack(text, defaultGame) {
      PLACEHOLDER.lastIndex = 0;
      return text.replace(PLACEHOLDER, function (whole, inlineId, name, mode) {
        if (inlineId) seenInlineIds[inlineId] = true;
        if (!KNOWN.has(name)) {
          problems.push(name);
          return whole;
        }
        var targetGame = inlineId ? inlineGameCache[inlineId] : defaultGame;
        if (inlineId && !targetGame) return whole; // will fill in second pass
        return render(name, read(targetGame, name), mode || 'text');
      });
    }

    // 1. {{placeholders}} inside text nodes — FIRST PASS
    // Skip text nodes inside <pre>, <code>, <script>, <style> (code blocks)
    var walker = document.createTreeWalker(
      scope,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          var parent = node.parentElement;
          while (parent && parent !== scope) {
            var tag = parent.tagName.toLowerCase();
            if (tag === 'pre' || tag === 'code' || tag === 'script' || tag === 'style') {
              return NodeFilter.FILTER_REJECT;
            }
            parent = parent.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach(function (node) {
      if (!ownsNode(node)) return;
      var replaced = fillAndTrack(node.nodeValue, game);
      console.log('[roblox-stats] text node:', node.nodeValue.slice(0, 50), '->', replaced.slice(0, 50));
      if (replaced !== node.nodeValue) node.nodeValue = replaced;
    });

    // 2. {{placeholders}} inside attribute values — FIRST PASS
    var elements = [scope].concat(
      Array.prototype.slice.call(scope.querySelectorAll('*'))
    );
    elements.forEach(function (el) {
      if (!ownsNode(el)) return;
      var attrs = el.attributes;
      for (var i = 0; i < attrs.length; i++) {
        var attr = attrs[i];
        if (attr.value.indexOf('{{') === -1) continue;
        var next = fillAndTrack(attr.value, game);
        if (next !== attr.value) el.setAttribute(attr.name, next);
      }
    });

    // 3. data-rbx-bind="field" — FIRST PASS (supports inline ID: {{12345:field}})
    var bound = Array.prototype.slice.call(scope.querySelectorAll('[data-rbx-bind]'));
    bound.forEach(function (el) {
      if (!ownsNode(el)) return;
      var spec = (el.getAttribute('data-rbx-bind') || '').trim();
      if (!spec) return;
      // Parse: [gameId:]field[:mode]
      var parts = spec.split(':');
      var name = parts[0].trim();
      var inlineId = null;
      var mode = 'text';
      if (parts.length === 2) {
        // Could be field:mode OR gameId:field
        if (/^\d+$/.test(parts[0])) {
          inlineId = parts[0];
          name = parts[1];
        } else {
          mode = parts[1];
        }
      } else if (parts.length === 3) {
        // gameId:field:mode
        inlineId = parts[0];
        name = parts[1];
        mode = parts[2];
      }
      if (inlineId) seenInlineIds[inlineId] = true;
      if (!KNOWN.has(name)) {
        problems.push(name);
        el.setAttribute('data-rbx-error', 'unknown field: ' + name);
        return;
      }
      var targetGame = inlineId ? inlineGameCache[inlineId] : game;
      if (inlineId && !targetGame) return; // second pass
      el.textContent = render(name, read(targetGame, name), mode);
    });

    // 4. data-rbx-set="src=thumbnail:url|href=url" — FIRST PASS
    var setters = Array.prototype.slice.call(scope.querySelectorAll('[data-rbx-set]'));
    setters.forEach(function (el) {
      if (!ownsNode(el)) return;
      var spec = el.getAttribute('data-rbx-set') || '';
      spec.split('|').forEach(function (pair) {
        var eq = pair.indexOf('=');
        if (eq === -1) return;
        var attr = pair.slice(0, eq).trim();
        var raw = pair.slice(eq + 1).trim();
        var value = fillAndTrack(
          /^\{\{/.test(raw) ? raw : '{{' + raw + '}}',
          game
        );
        if (attr) el.setAttribute(attr, value);
      });
    });

    // SECOND PASS: load any inline games we saw, then fill pending placeholders
    var inlineIdsToLoad = Object.keys(seenInlineIds).filter(function (id) {
      return !inlineGameCache[id];
    });

    if (inlineIdsToLoad.length) {
      console.log('[roblox-stats] loading inline games:', inlineIdsToLoad);
      Promise.all(inlineIdsToLoad.map(function (id) { return getInlineGame(id); }))
        .then(function () {
          console.log('[roblox-stats] inline games loaded, doing second pass');
          // Re-fill text nodes for pending inline IDs
          nodes.forEach(function (node) {
            if (!ownsNode(node)) return;
            var replaced = fillPendingInline(node.nodeValue, problems);
            if (replaced !== node.nodeValue) node.nodeValue = replaced;
          });
          // Re-fill attribute values
          elements.forEach(function (el) {
            if (!ownsNode(el)) return;
            var attrs = el.attributes;
            for (var i = 0; i < attrs.length; i++) {
              var attr = attrs[i];
              if (attr.value.indexOf('{{') === -1) continue;
              var next = fillPendingInline(attr.value, problems);
              if (next !== attr.value) el.setAttribute(attr.name, next);
            }
          });
          // Re-fill data-rbx-bind for pending inline IDs
          bound.forEach(function (el) {
            if (!ownsNode(el)) return;
            var spec = (el.getAttribute('data-rbx-bind') || '').trim();
            if (!spec) return;
            var parts = spec.split(':');
            var name = parts[0].trim();
            var inlineId = null;
            var mode = 'text';
            if (parts.length === 2) {
              if (/^\d+$/.test(parts[0])) {
                inlineId = parts[0];
                name = parts[1];
              } else {
                mode = parts[1];
              }
            } else if (parts.length === 3) {
              inlineId = parts[0];
              name = parts[1];
              mode = parts[2];
            }
            if (!inlineId || !KNOWN.has(name)) return;
            var game = inlineGameCache[inlineId];
            if (!game) return;
            el.textContent = render(name, read(game, name), mode);
          });
          // Re-fill data-rbx-set
          setters.forEach(function (el) {
            if (!ownsNode(el)) return;
            var spec = el.getAttribute('data-rbx-set') || '';
            spec.split('|').forEach(function (pair) {
              var eq = pair.indexOf('=');
              if (eq === -1) return;
              var attr = pair.slice(0, eq).trim();
              var raw = pair.slice(eq + 1).trim();
              var value = fillPendingInline(
                /^\{\{/.test(raw) ? raw : '{{' + raw + '}}',
                problems
              );
              if (attr) el.setAttribute(attr, value);
            });
          });
        });
    }

    if (problems.length) {
      var unique = uniqueOf(problems);
      console.warn('[roblox-stats] unknown field name(s):', unique.join(', '),
        '— see ' + API_BASE + '/api/v1/fields');
      document.dispatchEvent(new CustomEvent('rbx-bindings-error', { detail: { fields: unique } }));
    }
    document.dispatchEvent(new CustomEvent('rbx-bindings-updated', { detail: { game: game } }));
    return problems;
  }

  function uniqueOf(list) {
    return list.filter(function (v, i) { return list.indexOf(v) === i; });
  }

  /**
   * Every request goes through here, so the key and the credit are enforced in
   * one place instead of at each call site. The key rides in the X-API-Key
   * header rather than the URL on purpose: a query parameter is written to
   * access logs, to browser history and to the Referer of every outbound link.
   */
  function apiFetch(url) {
    var opts = { headers: {} };
    if (API_KEY) opts.headers['X-API-Key'] = API_KEY;
    return fetch(url, opts);
  }

  function loadGame(id) {
    if (!creditAllows('loadGame')) return Promise.reject(new Error(CREDIT_OFF_MESSAGE));
    return apiFetch(API_BASE + '/api/v1/games/' + encodeURIComponent(id))
      .then(function (r) {
        return r.text().then(function (text) {
          var body;
          try {
            body = JSON.parse(text);
          } catch (_) {
            throw new Error(wrongDomainMessage(r.url, text));
          }
          if (!body.ok) throw new Error(body.error && body.error.message);
          return body.data;
        });
      });
  }

  function runBindings() {
    var scopes = allScopes();
    console.log('[roblox-stats] runBindings, scopes found:', scopes.length, scopes.map(function(s) { return s.getAttribute('data-rbx-game'); }));

    // No scope anywhere: check for global config, then ?game= URL param.
    if (scopes.length === 0) {
      // Global config: window.RBX_GAME_ID or window.RobloxStatsConfig.gameId
      var globalId = (window.RBX_GAME_ID || (window.RobloxStatsConfig && window.RobloxStatsConfig.gameId) || '').trim();
      var fallback = globalId || new URLSearchParams(location.search).get('game');
      console.log('[roblox-stats] no scopes, globalId:', globalId, 'fallback:', fallback);
      if (!fallback) {
        if (document.body.querySelector('[data-rbx-bind]') ||
            /\{\{\s*[a-zA-Z]/.test(document.body.innerHTML)) {
          console.warn('[roblox-stats] found placeholders but no game id. ' +
            'Set window.RBX_GAME_ID, add data-rbx-game="<universeId>" to an element, or use ?game=<universeId> in the URL.');
        }
        return Promise.resolve();
      }
      return loadGame(fallback)
        .then(function (g) { fill(document.body, g); })
        .catch(reportFailure);
    }

    // One request per distinct game, however many scopes mention it.
    var byId = {};
    var jobs = [];
    scopes.forEach(function (scope, index) {
      var id = scope.getAttribute('data-rbx-game');
      if (!id || byId[id]) return;
      byId[id] = index;
      jobs.push(loadGame(id).then(function (g) {
        document.dispatchEvent(new CustomEvent('rbx-bindings-loaded', { detail: { id: id, game: g } }));
        return g;
      }));
    });

    return Promise.all(jobs)
      .then(function (games) {
        // Deepest scopes first: a child fills its own nodes, and the parent
        // then skips everything the child already owns.
        var ordered = scopes.slice().sort(function (a, b) {
          return b.contains(a) ? -1 : a.contains(b) ? 1 : 0;
        });
        var byIdGame = {};
        Object.keys(byId).forEach(function (id, i) { byIdGame[id] = games[i]; });
        ordered.forEach(function (scope) {
          fill(scope, byIdGame[scope.getAttribute('data-rbx-game')]);
        });
      })
      .catch(reportFailure);
  }

  function reportFailure(err) {
    console.error('[roblox-stats] failed to load game data:', err && err.message);
    document.dispatchEvent(new CustomEvent('rbx-bindings-error', { detail: { error: err && err.message } }));
  }

  // ==========================================================================
  // Card widget
  // ==========================================================================

  var PREFIX = 'rbxw-';

  // Injects the stylesheet once. Every rule is prefixed with .rbxw- so it
  // cannot leak into the page that embeds the widget.
  function injectStyles() {
    if (document.getElementById(PREFIX + 'styles')) return;
    // The card is built from ordinary <p>, <div> and <b> elements, so a plain
    // `p { color: ... }` on the host page reaches inside the card and can turn
    // the title into dark grey on a dark background. Prefixing our own rules
    // is not enough on its own: every element that carries text states its
    // own colour, font and line height, so it outranks a bare element selector
    // and inherits only from us.
    var css =
      '.' + PREFIX + 'card{display:flex;overflow:hidden;border-radius:16px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:520px;line-height:1.4;transition:transform .16s ease,box-shadow .16s ease}' +
      '.' + PREFIX + 'card:hover{transform:translateY(-2px)}' +
      '.' + PREFIX + 'card *{box-sizing:border-box}' +
      '.' + PREFIX + 'body{flex:1;min-width:0;padding:16px 18px}' +
      // --rbxw-fg is the main text, --rbxw-dim the label grey and --rbxw-live
      // the green of the player count. Every pair clears 4.5:1 against the
      // tile it sits on, which is why the dim colour is a real colour and not
      // opacity: opacity on the tile also fades the number below WCAG AA.
      '.' + PREFIX + 'dark .' + PREFIX + 'body{--rbxw-fg:#e9eefb;--rbxw-dim:#aab4cc;--rbxw-live:#34d399;background:#111828;color:var(--rbxw-fg);border:1px solid #202a42;box-shadow:0 10px 30px rgba(0,0,0,.45)}' +
      '.' + PREFIX + 'light .' + PREFIX + 'body{--rbxw-fg:#101728;--rbxw-dim:#55607a;--rbxw-live:#166534;background:#fff;color:var(--rbxw-fg);border:1px solid #e0e5f0;box-shadow:0 10px 30px rgba(16,23,40,.1)}' +
      '.' + PREFIX + 'dark .' + PREFIX + 'card:hover{box-shadow:0 16px 40px rgba(0,0,0,.55)}' +
      '.' + PREFIX + 'light .' + PREFIX + 'card:hover{box-shadow:0 16px 40px rgba(16,23,40,.14)}' +
      '.' + PREFIX + 'banner{height:110px;background-size:cover;background-position:center;flex-shrink:0}' +
      '.' + PREFIX + 'head{display:flex;align-items:center;gap:12px;margin-bottom:2px}' +
      '.' + PREFIX + 'logo{width:56px;height:56px;border-radius:12px;background-size:cover;background-position:center;flex-shrink:0}' +
      '.' + PREFIX + 'logo.lg{width:68px;height:68px;border-radius:15px}' +
      '.' + PREFIX + 'title{margin:0;font-size:17px;font-weight:700;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--rbxw-fg)}' +
      '.' + PREFIX + 'creator{font-size:13px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--rbxw-dim)}' +
      '.' + PREFIX + 'stats{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}' +
      '.' + PREFIX + 'stat{flex:1 1 0;min-width:64px;font-size:12px;background:rgba(127,140,170,.12);border-radius:10px;padding:8px 10px;color:var(--rbxw-dim)}' +
      '.' + PREFIX + 'stat b{display:block;font-size:16px;font-weight:750;letter-spacing:-.01em;font-variant-numeric:tabular-nums}' +
      // The value carries its own class so that .rbxw-live, declared after it
      // and with the same weight, is what decides the colour of the player
      // count. That keeps the descendant selector on `b` out of the way and
      // leaves .rbxw-live free to be restyled from the host's stylesheet.
      '.' + PREFIX + 'value{color:var(--rbxw-fg)}' +
      '.' + PREFIX + 'live{color:var(--rbxw-live)}' +
      '.' + PREFIX + 'a{color:inherit;text-decoration:none;display:block;font-family:inherit}' +
      '.' + PREFIX + 'a:hover .' + PREFIX + 'title{text-decoration:underline}' +
      // The text properties a host page is most likely to set on bare
      // elements, restated so the card looks the same wherever it is pasted.
      '.' + PREFIX + 'title,.' + PREFIX + 'creator,.' + PREFIX + 'stat,.' + PREFIX + 'stat b,.' + PREFIX + 'value,.' + PREFIX + 'err{font-family:inherit;line-height:1.4;font-style:normal}' +
      '.' + PREFIX + 'err{padding:16px;font-size:13px;color:#fca5a5}';

    var style = document.createElement('style');
    style.id = PREFIX + 'styles';
    style.textContent = css;
    // First, not last. Every rule above is a class selector, so it still beats
    // a bare `p { ... }` on the host page no matter where it sits. Putting it
    // at the top of the head means a page that wants `.rbxw-live { color: … }`
    // in its own stylesheet actually wins, which is what the docs promise.
    document.head.insertBefore(style, document.head.firstChild);
  }

  function buildCard(host, data, opts) {
    var theme = opts.theme === 'light' ? 'light' : 'dark';
    var compact = opts.fields === 'compact';

    host.textContent = '';
    host.className = host.className.replace(/\brbxw-\S+/g, '').trim();

    var card = document.createElement('div');
    card.className = PREFIX + 'card ' + PREFIX + theme;

    var link = document.createElement('a');
    link.className = PREFIX + 'a';
    link.href = data.url || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    if (!compact && data.banner) {
      var banner = document.createElement('div');
      banner.className = PREFIX + 'banner';
      banner.style.backgroundImage = 'url("' + data.banner + '")';
      card.appendChild(banner);
    }

    var body = document.createElement('div');
    body.className = PREFIX + 'body';

    var head = document.createElement('div');
    head.className = PREFIX + 'head';

    if (data.thumbnail) {
      var logo = document.createElement('div');
      logo.className = PREFIX + 'logo' + (compact ? '' : ' lg');
      logo.style.backgroundImage = 'url("' + data.thumbnail + '")';
      head.appendChild(logo);
    }

    var titles = document.createElement('div');
    titles.style.minWidth = '0';

    var title = document.createElement('p');
    title.className = PREFIX + 'title';
    title.textContent = data.name || 'Roblox game';
    titles.appendChild(title);

    var creator = document.createElement('div');
    creator.className = PREFIX + 'creator';
    creator.textContent = data.creator || 'Unknown creator';
    titles.appendChild(creator);

    head.appendChild(titles);
    body.appendChild(head);

    // Numeric fields: flat on /quick, nested under ratings on the full endpoint.
    var playing = data.playing;
    var upVotes = data.ratings ? data.ratings.upVotes : data.upVotes;
    var visits = data.visits;

    var stats = document.createElement('div');
    stats.className = PREFIX + 'stats';

    function addStat(label, value, valueClass) {
      var stat = document.createElement('div');
      stat.className = PREFIX + 'stat';
      var b = document.createElement('b');
      // rbxw-value carries the number's own colour; rbxw-live, when present,
      // is declared after it and wins on source order.
      b.className = PREFIX + 'value' + (valueClass ? ' ' + valueClass : '');
      b.textContent = value;
      b.title = value; // the exact value in the tooltip
      stat.appendChild(b);
      stat.appendChild(document.createTextNode(label));
      stats.appendChild(stat);
    }

    addStat('playing', short(playing), PREFIX + 'live');
    addStat('likes', short(upVotes));
    if (!compact) addStat('visits', short(visits));

    body.appendChild(stats);
    link.appendChild(body);
    card.appendChild(link);
    host.appendChild(card);
  }

  function renderError(host, message) {
    host.textContent = '';
    var box = document.createElement('div');
    box.className = PREFIX + 'card ' + PREFIX + 'dark';
    var err = document.createElement('div');
    err.className = PREFIX + 'err';
    err.textContent = 'Could not load this game: ' + message;
    box.appendChild(err);
    host.appendChild(box);
  }

  /** Fetches the data and paints it. Uses /quick: the smallest possible payload. */
  function loadCard(host, opts) {
    if (!creditAllows('loadCard')) {
      renderError(host, CREDIT_OFF_MESSAGE);
      return Promise.resolve();
    }
    var url = API_BASE + '/api/v1/games/' + encodeURIComponent(opts.gameId) + '/quick';
    return apiFetch(url)
      .then(function (res) {
        return res.text().then(function (text) {
          var body;
          try {
            body = JSON.parse(text);
          } catch (_) {
            throw new Error(wrongDomainMessage(res.url, text));
          }
          if (!res.ok || !body.ok) {
            throw new Error((body && body.error && body.error.message) || 'HTTP ' + res.status);
          }
          return body.data;
        });
      })
      .then(function (data) {
        buildCard(host, data, opts);
      })
      .catch(function (err) {
        renderError(host, err.message);
      });
  }

  function runWidgets() {
    injectStyles();
    var hosts = document.querySelectorAll('[data-roblox-game]');
    Array.prototype.forEach.call(hosts, function (host) {
      var opts = {
        gameId: host.getAttribute('data-roblox-game'),
        theme: host.getAttribute('data-roblox-theme') || 'dark',
        fields: host.getAttribute('data-roblox-fields') || 'stats',
      };
      if (!opts.gameId) {
        renderError(host, 'missing the data-roblox-game attribute');
        return;
      }
      loadCard(host, opts);
      var refresh = parseInt(host.getAttribute('data-roblox-refresh'), 10);
      if (refresh > 0) {
        setInterval(function () {
          loadCard(host, opts);
        }, refresh * 1000);
      }
    });
  }

  // ==========================================================================
  // Credit enforcement
  // ==========================================================================
  //
  // A request that comes back as a web page instead of JSON is almost always the
  // script living on a different domain than the API, which otherwise surfaces
  // as "Unexpected token '<'" and tells the reader nothing about the cause.
  function wrongDomainMessage(url, text) {
    if (/^\s*<(!doctype|html)/i.test(text || '')) {
      return (
        'this file is served from a different address than the API (' + url +
        ' returned a web page, not JSON). Set window.ROBLOX_API_BASE to the API ' +
        'address on the line before this script tag.'
      );
    }
    return 'the API returned something that is not JSON (' + url + ')';
  }

  // The credit carries its own colour, font and line-height because it lives on
  // somebody else's page, where `a { color: inherit }` or `div { display: none }`
  // would otherwise erase it. It is injected as head.firstChild so a host rule
  // can still win if they genuinely need to reposition it.
  var CREDIT_CSS =
    '#' + CREDIT_ID + '{' +
    'position:fixed;left:12px;bottom:12px;z-index:2147483000;' +
    'display:inline-flex;align-items:center;gap:7px;' +
    'max-width:calc(100vw - 24px);box-sizing:border-box;' +
    'padding:6px 12px;border-radius:999px;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
    'font-size:12px;font-weight:600;line-height:1.25;letter-spacing:.01em;' +
    'text-decoration:none;' +
    'background:rgba(15,18,28,.9);color:#e8ecf6;border:1px solid rgba(255,255,255,.14);' +
    'box-shadow:0 2px 10px rgba(0,0,0,.28);' +
    '}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-tag{' +
    'font-size:10px;font-weight:800;line-height:1;letter-spacing:.06em;' +
    /* White on amber is 1.9:1; this brown on amber is 5.4:1, so the tag stays
       readable on both a light and a dark host page. */
    'color:#6b3f00;background:#fbbf24;border-radius:999px;padding:3px 6px;' +
    '}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-text{color:#e8ecf6;white-space:nowrap;' +
    'overflow:hidden;text-overflow:ellipsis;}' +
    // Only the name is a link, and it carries its own colour so a host rule
    // like `a { color: inherit }` cannot flatten it into the surrounding text
    // and make the badge look unclickable.
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-link{color:#fbbf24;text-decoration:none;' +
    'font-weight:700;}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-link:hover{color:#fcd34d;text-decoration:underline;}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-link:focus-visible{outline:2px solid #fbbf24;' +
    'outline-offset:2px;border-radius:3px;}' +
    '#' + CREDIT_ID + ':hover{color:#fff;border-color:rgba(255,255,255,.3);}' +
    '@media (prefers-color-scheme:light){' +
    '#' + CREDIT_ID + '{background:rgba(255,255,255,.94);color:#1f2430;border-color:rgba(0,0,0,.14);' +
    'box-shadow:0 2px 10px rgba(0,0,0,.14);}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-text{color:#1f2430;}' +
    // Amber reads as a washed-out link on a white badge; this brown is 5.4:1.
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-link{color:#6b3f00;}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-link:hover{color:#4a2b00;}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-link:focus-visible{outline-color:#6b3f00;}' +
    '}';

  var NOTICE_CSS =
    '#' + PREFIX + 'credit-notice{' +
    'position:fixed;left:12px;bottom:12px;z-index:2147483001;' +
    'max-width:min(420px,calc(100vw - 24px));box-sizing:border-box;' +
    'padding:14px 16px;border-radius:12px;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
    'font-size:13px;font-weight:400;line-height:1.5;color:#fde8e8;' +
    'background:#2a1215;border:1px solid #7f1d1d;box-shadow:0 4px 16px rgba(0,0,0,.3);' +
    '}' +
    '#' + PREFIX + 'credit-notice b{display:block;margin-bottom:6px;font-size:13px;' +
    'font-weight:700;line-height:1.4;color:#fff;}' +
    '#' + PREFIX + 'credit-notice .' + PREFIX + 'notice-why{display:block;margin-bottom:10px;}' +
    '#' + PREFIX + 'credit-notice button{' +
    'font:inherit;font-size:12px;font-weight:600;line-height:1.4;cursor:pointer;' +
    'color:#2a1215;background:#fbbf24;border:0;border-radius:7px;padding:7px 12px;' +
    '}';

  function injectCreditStyles() {
    if (document.getElementById(PREFIX + 'credit-styles')) return;
    var style = document.createElement('style');
    style.id = PREFIX + 'credit-styles';
    style.textContent = CREDIT_CSS + NOTICE_CSS;
    document.head.insertBefore(style, document.head.firstChild);
  }

  function renderCredit() {
    injectCreditStyles();
    if (document.getElementById(CREDIT_ID)) {
      creditEl = document.getElementById(CREDIT_ID);
      return;
    }
    // Re-appended by restoreCredit() after a removal, so it must end up in the
    // body again rather than being left in a detached fragment.
    if (!document.body) return;
    // Always a <span> wrapper: only the name inside it is a link, so the click
    // target is the words "Moonlight Studios" and nothing else.
    var el = document.createElement('span');
    el.id = CREDIT_ID;
    el.className = PREFIX + 'credit';
    var tag = document.createElement('span');
    tag.className = PREFIX + 'credit-tag';
    tag.textContent = CREDIT.tag;
    // "MBA  Made by Moonlight Studios", with only the name inside the link, so
    // the anchor is exactly the words someone would look for to click.
    var text = document.createElement('span');
    text.className = PREFIX + 'credit-text';
    text.appendChild(document.createTextNode(CREDIT.before));
    if (CREDIT.url) {
      var name = document.createElement('a');
      name.className = PREFIX + 'credit-link';
      name.href = CREDIT.url;
      name.target = '_blank';
      name.rel = 'noopener';
      name.textContent = CREDIT.linkText;
      text.appendChild(name);
    } else {
      text.appendChild(document.createTextNode(CREDIT.linkText));
    }
    if (CREDIT.after) text.appendChild(document.createTextNode(CREDIT.after));
    el.appendChild(tag);
    el.appendChild(text);
    document.body.appendChild(el);
    creditEl = el;
  }

  function removeCreditNotice() {
    if (creditNotice && creditNotice.parentNode) creditNotice.parentNode.removeChild(creditNotice);
    creditNotice = null;
  }

  /**
   * Shown on the page, not just in the console. The site owner has to be able to
   * SEE that this is why their stats stopped working, and the way back has to be
   * one click so an adblocker false positive is not a dead end.
   */
  function showCreditNotice() {
    injectCreditStyles();
    if (creditNotice) return;
    var box = document.createElement('div');
    box.id = PREFIX + 'credit-notice';

    var head = document.createElement('b');
    head.textContent = 'Roblox Stats is turned off on this page';
    var why = document.createElement('span');
    why.className = PREFIX + 'notice-why';
    why.textContent =
      'The "' + CREDIT_LABEL + '" credit is missing or hidden, so this file stopped ' +
      'loading data. Show the credit to switch it on again.';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Restore the credit';
    btn.addEventListener('click', restoreCredit);

    box.appendChild(head);
    box.appendChild(why);
    box.appendChild(btn);
    document.body.appendChild(box);
    creditNotice = box;
  }

  function restoreCredit() {
    // Strip the inline display:none a hiding site may have left behind, so
    // Restore actually works instead of re-inserting an invisible badge.
    var stale = document.getElementById(CREDIT_ID);
    if (stale) {
      stale.removeAttribute('style');
      stale.className = PREFIX + 'credit';
    }
    creditBlocked = false;
    creditEl = null;
    renderCredit();
    removeCreditNotice();
    runBindings();
    runWidgets();
  }

  // Hiding counts as removing. A site owner who sets display:none has not kept
  // the credit, and this file should say so rather than quietly keep serving.
  // The widget does NOT fight the host page with !important to force itself
  // visible: that breaks real designs. It just refuses to work without the
  // credit, and the Restore button puts it back.
  function creditHidden() {
    if (!creditEl || !creditEl.isConnected) return false;
    var cs;
    try {
      cs = window.getComputedStyle(creditEl);
    } catch (_) {
      return false;
    }
    if (!cs) return false;
    // NOTE: offsetParent is deliberately NOT checked. It is null for every
    // position:fixed element in every browser, and this badge is fixed, so
    // testing it marks a perfectly visible credit as hidden.
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return true;
    // getClientRects() is empty for a display:none or zero-sized element, and
    // correct for a fixed one — which is exactly the distinction needed here.
    var rects = creditEl.getClientRects();
    return !rects || rects.length === 0 || rects[0].width === 0 || rects[0].height === 0;
  }

  function onCreditRemoved() {
    creditEl = null;
    creditBlocked = true;
    console.error(
      '[roblox-stats] The "' + CREDIT_LABEL + '" credit is missing or hidden, so this ' +
        'file has stopped loading data. Please show it again — that credit is what ' +
        'allows this API to stay free.'
    );
    document.dispatchEvent(new CustomEvent('rbx-credit-removed'));
    showCreditNotice();
  }

  function watchCredit() {
    if (typeof MutationObserver !== 'function' || !document.body) return;
    var check = function () {
      // Once blocked, never resurrect the badge behind the owner's back: the
      // Restore button is the only way back, so what they see is what they get.
      if (creditBlocked) return;
      if (!creditEl || !creditEl.isConnected || creditHidden()) onCreditRemoved();
    };
    // childList catches a deleted node, attributes catches a hidden one.
    new MutationObserver(check).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden'],
    });
    // A stylesheet can hide the badge without touching the DOM at all, which no
    // observer reports. Polling is the only way to catch it, and it is cheap
    // because it only reads layout.
    setInterval(check, 1000);
  }

  /** The gate every request goes through. */
  function creditAllows(where) {
    if (creditBlocked) return false;
    if (!creditEl) renderCredit();
    if (!creditEl || creditHidden()) {
      onCreditRemoved();
      return false;
    }
    return true;
  }

  // ==========================================================================
  // Boot
  // ==========================================================================

  function start() {
    renderCredit();
    watchCredit();
    console.error('[roblox-stats] START: about to call runBindings');
    try {
      runBindings();
      console.error('[roblox-stats] runBindings completed successfully');
    } catch (e) {
      console.error('[roblox-stats] runBindings threw:', e && e.message, e && e.stack);
    }
    runWidgets();

    // data-rbx-refresh="60" on any scope re-reads the data every 60 seconds.
    var timers = document.querySelectorAll('[data-rbx-refresh]');
    Array.prototype.forEach.call(timers, function (el) {
      var seconds = parseInt(el.getAttribute('data-rbx-refresh'), 10);
      if (seconds > 0) setInterval(runBindings, seconds * 1000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Public handles, for anyone who wants to drive it by hand.
  window.RobloxStats = {
    run: function () { runBindings(); runWidgets(); },
    load: loadGame,
    fill: fill,
    abbreviate: abbreviate,
    fields: Array.from(KNOWN),
    // Exposed so a host page can react to, or undo, a removed credit.
    credit: {
      config: CREDIT,
      isPresent: function () { return !!creditEl && !creditBlocked; },
      restore: restoreCredit,
    },
  };
  window.RobloxBindings = window.RobloxStats;
  window.RobloxWidget = { load: loadCard, formatNumber: short };
})();
