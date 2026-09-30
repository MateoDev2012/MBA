/**
 * MoonBlox API — the one file you need.
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
  var PLACEHOLDER = /\{\{\s*(?:(\d+):)?([a-zA-Z][a-zA-Z0-9_]*)\s*(?::\s*(raw|short|full|url|text)\s*)?\}\}/g;

  // Cache for inline game IDs so we don't fetch the same game twice
  var inlineGameCache = {};
  var inlineGamePromises = {};

  // Request an inline game once, even when several placeholders use it. A failed
  // lookup resolves to null so one bad id cannot block every other game.
  function ensureInlineGame(id) {
    if (inlineGameCache[id]) return Promise.resolve(inlineGameCache[id]);
    if (!inlineGamePromises[id]) {
      inlineGamePromises[id] = loadGame(id).then(
        function (game) {
          inlineGameCache[id] = game;
          return game;
        },
        function () {
          return null;
        }
      );
    }
    return inlineGamePromises[id];
  }

  // Nodes inside pre/code/script/style are examples, not content to fill.
  function isCodeElement(el) {
    var node = el;
    while (node && node !== document.documentElement) {
      var tag = node.tagName ? node.tagName.toLowerCase() : '';
      if (tag === 'pre' || tag === 'code' || tag === 'script' || tag === 'style') return true;
      node = node.parentElement;
    }
    return false;
  }

  function noteInlineIds(text, ids) {
    PLACEHOLDER.lastIndex = 0;
    var match;
    while ((match = PLACEHOLDER.exec(text)) !== null) {
      if (match[1]) ids[match[1]] = true;
    }
  }

  // data-rbx-bind="playing", "playing:raw", "12345:playing", "12345:playing:raw"
  function parseBinding(spec) {
    var parts = String(spec || '').split(':').map(function (part) { return part.trim(); });
    var inlineId = null;
    var name = parts[0] || '';
    var mode = 'text';

    if (parts.length === 2) {
      if (/^\d+$/.test(parts[0])) {
        inlineId = parts[0];
        name = parts[1] || '';
      } else {
        mode = parts[1] || 'text';
      }
    } else if (parts.length === 3) {
      inlineId = parts[0];
      name = parts[1] || '';
      mode = parts[2] || 'text';
    }

    return { inlineId: inlineId, name: name, mode: mode };
  }

  // Find every {{12345:field}} used outside examples, in text, attributes,
  // bindings and setters. Fetching them before the first fill lets a page use
  // inline ids without a global game or an ancestor scope.
  function collectInlineIds(root) {
    var ids = {};
    var walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          return isCodeElement(node.parentElement)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    var textNode;
    while ((textNode = walker.nextNode())) {
      noteInlineIds(textNode.nodeValue, ids);
    }

    var elements = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
    elements.forEach(function (el) {
      if (isCodeElement(el)) return;
      var i, attr, pair, eq, raw, parsed;

      for (i = 0; i < el.attributes.length; i++) {
        attr = el.attributes[i];
        if (attr.value.indexOf('{{') !== -1) noteInlineIds(attr.value, ids);
      }

      if (el.hasAttribute('data-rbx-bind')) {
        parsed = parseBinding(el.getAttribute('data-rbx-bind'));
        if (parsed.inlineId) ids[parsed.inlineId] = true;
      }

      if (el.hasAttribute('data-rbx-set')) {
        el.getAttribute('data-rbx-set').split('|').forEach(function (candidate) {
          eq = candidate.indexOf('=');
          if (eq === -1) return;
          raw = candidate.slice(eq + 1).trim();
          noteInlineIds(/^\{\{/.test(raw) ? raw : '{{' + raw + '}}', ids);
        });
      }
    });

    return Object.keys(ids);
  }

  function preloadInlineGames(root) {
    var ids = collectInlineIds(root);
    return Promise.all(
      ids.map(function (id) { return ensureInlineGame(id); })
    ).then(function () { return ids; });
  }

  // Placeholders shown in <pre>/<code> are documentation, not content to fill.
  function hasVisiblePlaceholders(root) {
    var walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          return isCodeElement(node.parentElement)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    var textNode;
    while ((textNode = walker.nextNode())) {
      if (textNode.nodeValue.indexOf('{{') !== -1) return true;
    }

    var elements = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (isCodeElement(el)) continue;
      if (el.hasAttribute('data-rbx-bind') || el.hasAttribute('data-rbx-set')) return true;
      for (var j = 0; j < el.attributes.length; j++) {
        if (el.attributes[j].value.indexOf('{{') !== -1) return true;
      }
    }
    return false;
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
    var problems = [];
    
    // When scope is document.body without data-rbx-game, it owns all descendant nodes.
    // Otherwise, a node is owned by the nearest ancestor with data-rbx-game.
    var ownsNode;
    if (scope === document.body && !scope.getAttribute('data-rbx-game')) {
      ownsNode = function (node) { return scope.contains(node); };
    } else {
      ownsNode = function (node) { return scopeOf(node) === scope; };
    }
    
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
        if (!targetGame) return whole; // missing game, or inline game not loaded yet
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
      var parsed = parseBinding(el.getAttribute('data-rbx-bind'));
      if (!parsed.name) return;
      if (parsed.inlineId) seenInlineIds[parsed.inlineId] = true;
      if (!KNOWN.has(parsed.name)) {
        problems.push(parsed.name);
        el.setAttribute('data-rbx-error', 'unknown field: ' + parsed.name);
        return;
      }
      var targetGame = parsed.inlineId ? inlineGameCache[parsed.inlineId] : game;
      if (!targetGame) return; // missing game, or inline game not loaded yet
      el.textContent = render(parsed.name, read(targetGame, parsed.name), parsed.mode);
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
      Promise.all(inlineIdsToLoad.map(function (id) { return ensureInlineGame(id); }))
        .then(function () {
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
            var parsed = parseBinding(el.getAttribute('data-rbx-bind'));
            if (!parsed.name) return;
            var inlineId = parsed.inlineId;
            var name = parsed.name;
            var mode = parsed.mode;
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
  /** How long one attempt may take before it is abandoned. */
  var REQUEST_TIMEOUT_MS = 8000;
  /** How many extra attempts after the first. Two, not five: a widget is on
   *  somebody's page, and a page that keeps retrying a dead network is worse
   *  than a page that shows what it has. */
  var REQUEST_RETRIES = 2;

  /** Statuses worth trying again. 429 because we rate-limit deliberately and
   *  say when to come back, 5xx because that is somebody having a moment. 4xx
   *  other than 429 is an answer: a 404 game will still be a 404 in a second. */
  function isRetryable(status) {
    return status === 429 || status === 408 || status >= 500;
  }

  /** How long Roblox, or any proxy, asked us to wait. */
  function retryAfterMs(res) {
    var raw = res.headers && res.headers.get('retry-after');
    if (!raw) return null;
    var seconds = Number(raw);
    if (isFinite(seconds)) return Math.min(Math.max(0, seconds * 1000), 15000);
    var at = Date.parse(raw);
    if (isFinite(at)) return Math.min(Math.max(0, at - Date.now()), 15000);
    return null;
  }

  /** One attempt, with a timeout that actually aborts the request. */
  function fetchOnce(url) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    }
    var opts = { headers: {}, credentials: 'omit' };
    if (API_KEY) opts.headers['X-API-Key'] = API_KEY;
    if (controller) opts.signal = controller.signal;
    return fetch(url, opts).then(
      function (res) {
        if (timer) clearTimeout(timer);
        return res;
      },
      function (err) {
        if (timer) clearTimeout(timer);
        // Distinguishable from a refusal, because it is: the request never got
        // an answer, which is the visitor's network rather than our server.
        if (err && err.name === 'AbortError') {
          var timeout = new Error('The request took too long.');
          timeout.code = 'RBX_TIMEOUT';
          throw timeout;
        }
        throw err;
      }
    );
  }

  /**
   * Every request goes through here, so the key and the credit are enforced in
   * one place instead of at each call site. The key rides in the X-API-Key
   * header rather than the URL on purpose: a query parameter is written to
   * access logs, to browser history and to the Referer of every outbound link.
   *
   * Retries are here rather than at the call sites because a page can ask for
   * twenty placeholders on one game, and twenty independent retry loops is
   * twenty times the traffic for the same single request.
   */
  function apiFetch(url) {
    var attempt = 0;
    function run() {
      return fetchOnce(url).then(function (res) {
        if (!isRetryable(res.status) || attempt >= REQUEST_RETRIES) return res;
        var wait = retryAfterMs(res);
        attempt++;
        var pause = wait !== null ? wait : 300 * 2 ** (attempt - 1);
        return new Promise(function (resolve) {
          setTimeout(resolve, Math.min(pause, 5000));
        }).then(run);
      }, function (err) {
        // A network failure is worth one more try. Giving up on the first
        // packet is how a card ends up broken by nothing at all.
        if (attempt >= REQUEST_RETRIES) throw err;
        attempt++;
        return new Promise(function (resolve) {
          setTimeout(resolve, Math.min(300 * 2 ** (attempt - 1), 3000));
        }).then(run);
      });
    }
    return run();
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
    // Global game, if any. No-scope pages can also work purely from
    // {{12345:field}} placeholders.
    var globalId = (window.RBX_GAME_ID || (window.RobloxStatsConfig && window.RobloxStatsConfig.gameId) || '').trim();
    var fallback = globalId || new URLSearchParams(location.search).get('game');

    // Fetch inline ids first, so inline placeholders can fill on the first pass.
    return preloadInlineGames(document.body).then(function (inlineIds) {
      if (scopes.length === 0) {
        if (!fallback && !inlineIds.length) {
          if (hasVisiblePlaceholders(document.body)) {
            console.warn('[roblox-stats] found placeholders but no game id. ' +
              'Use {{12345:field}}, set window.RBX_GAME_ID, add data-rbx-game="<universeId>" to an element, or use ?game=<universeId> in the URL.');
          }
          return Promise.resolve();
        }
        if (!fallback) {
          fill(document.body, null);
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
    });
  }

  function reportFailure(err) {
    console.error('[roblox-stats] failed to load game data:', err && err.message);
    document.dispatchEvent(new CustomEvent('rbx-bindings-error', { detail: { error: err && err.message } }));
  }

  // ==========================================================================
  // Card widget
  // ==========================================================================

  var PREFIX = 'rbxw-';

  // Bumped whenever the rules below change, so a page that somehow runs this
  // file twice gets the new stylesheet instead of keeping the first one.
  var STYLE_BUILD = '2';

  // Injects the stylesheet once. Every rule is prefixed with .rbxw- so it
  // cannot leak into the page that embeds the widget.
  function injectStyles() {
    // Re-written rather than skipped when it is already there. A page that
    // includes the file twice, or a soft navigation that re-runs it, would
    // otherwise keep the first version's rules forever, because the id is the
    // only thing that says "already injected".
    var existing = document.getElementById(PREFIX + 'styles');
    if (existing && existing.getAttribute('data-rbxw-build') === STYLE_BUILD) return;
    // The card is built from ordinary <p>, <div> and <b> elements, so a plain
    // `p { color: ... }` on the host page reaches inside the card and can turn
    // the title into dark grey on a dark background. Prefixing our own rules
    // is not enough on its own: every element that carries text states its
    // own colour, font and line height, so it outranks a bare element selector
    // and inherits only from us.
    var css =
      // The card is a COLUMN. As a row the banner became a zero-width strip and
      // simply vanished, because a background image gives a flex item no width.
      // `width:100%` with `max-width` means the card fills whatever box the host
      // gave it instead of hugging its content inside a wide column.
      '.' + PREFIX + 'card{display:flex;flex-direction:column;position:relative;overflow:hidden;width:100%;max-width:520px;border-radius:18px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.4;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}' +
      '.' + PREFIX + 'card:hover{transform:translateY(-2px)}' +
      '.' + PREFIX + 'card *{box-sizing:border-box}' +
      '.' + PREFIX + 'body{flex:1;min-width:0;padding:16px 18px 18px}' +
      // --rbxw-fg is the main text, --rbxw-dim the label grey and --rbxw-live
      // the green of the player count. Every pair clears 4.5:1 against the
      // tile it sits on, which is why the dim colour is a real colour and not
      // opacity: opacity on the tile also fades the number below WCAG AA.
      // The theme colours now live on the card itself, not on the body, so the
      // banner and the head inherit them too. Indigo and violet rather than
      // blue-grey, so the card still reads as MoonBlox on somebody's page.
      '.' + PREFIX + 'dark{--rbxw-fg:#f4f4f5;--rbxw-dim:#a1a1aa;--rbxw-live:#3ddc97;--rbxw-tile:rgba(255,255,255,.04);--rbxw-line:rgba(255,255,255,.09);--rbxw-shadow:0 8px 24px rgba(0,0,0,.5);--rbxw-shadow-hi:0 16px 40px rgba(0,0,0,.62);background:#101113;color:var(--rbxw-fg);border:1px solid rgba(255,255,255,.09);box-shadow:var(--rbxw-shadow)}' +
      '.' + PREFIX + 'light{--rbxw-fg:#0a0a0a;--rbxw-dim:#6e6e78;--rbxw-live:#0b7a45;--rbxw-tile:rgba(0,0,0,.03);--rbxw-line:rgba(0,0,0,.09);--rbxw-shadow:0 10px 28px rgba(26,20,54,.11);--rbxw-shadow-hi:0 18px 40px rgba(26,20,54,.17);background:#fff;color:var(--rbxw-fg);border:1px solid rgba(0,0,0,.09);box-shadow:var(--rbxw-shadow)}' +
      '.' + PREFIX + '.rbxw-dark:hover{box-shadow:var(--rbxw-shadow-hi);border-color:rgba(255,255,255,.2)}' +
      '.' + PREFIX + '.rbxw-light:hover{box-shadow:var(--rbxw-shadow-hi);border-color:rgba(0,0,0,.18)}' +
      // A gradient scrim under the banner, so the logo that overlaps it and any
      // pale artwork both keep their contrast. Dark enough at the bottom to keep
      // white text legible over a light banner: game banners are frequently pale
      // and the title sits right on the seam.
      '.' + PREFIX + 'banner{position:relative;height:124px;flex-shrink:0;background-size:cover;background-position:center;background-color:#17181b}' +
      '.' + PREFIX + 'banner::after{content:"";position:absolute;left:0;right:0;bottom:0;height:96px;background:linear-gradient(to bottom,rgba(0,0,0,0),rgba(0,0,0,.5) 55%,rgba(0,0,0,.8))}' +
      // Pulled up over the banner's bottom edge, the way game cards do it - but
      // only on the dark theme. On a light card the strip below the banner is
      // white, so a title hanging over that seam in white is invisible, and
      // game banners are often pale enough that dark text over the artwork is
      // no better. The light card simply puts the head under the banner.
      '.' + PREFIX + 'head{position:relative;display:flex;align-items:flex-end;gap:13px}' +
      '.' + PREFIX + 'padbanner .' + PREFIX + 'head{margin-top:-34px;padding:0 18px}' +
      // Both of these classes sit on the card itself, so they have to be joined
      // with a dot. Written as descendants they matched nothing at all, which is
      // why the light card kept the pull-up and hung an unreadable title across
      // the seam.
      '.rbxw-light.rbxw-padbanner .rbxw-head{margin-top:0;padding:16px 18px 0}' +
      '.rbxw-light.rbxw-padbanner .rbxw-titles{padding-bottom:3px;text-shadow:none}' +
      '.' + PREFIX + 'logo{width:58px;height:58px;border-radius:14px;background-size:cover;background-position:center;flex-shrink:0;background-color:var(--rbxw-tile);transition:transform .18s ease}' +
      '.rbxw-dark .rbxw-logo{box-shadow:0 0 0 3px #101113,0 6px 16px rgba(0,0,0,.45)}' +
      '.rbxw-light .rbxw-logo{box-shadow:0 0 0 3px #fff,0 6px 16px rgba(0,0,0,.18)}' +
      '.rbxw-light .rbxw-logo{box-shadow:0 0 0 3px #fff,0 6px 16px rgba(0,0,0,.18)}' +
      '.' + PREFIX + 'a:hover .rbxw-logo{transform:scale(1.04)}' +
      '.' + PREFIX + 'titles{flex:1;min-width:0;padding-bottom:3px}' +
      '.' + PREFIX + 'title{margin:0;font-size:17.5px;font-weight:750;letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--rbxw-fg)}' +
      '.' + PREFIX + 'creator{margin-top:3px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--rbxw-dim)}' +
      // On top of artwork the title is white, not the theme foreground: the dark
      // card's own background is nearly black and would swallow the name. The
      // light card keeps its normal colours because it does not overlap.
      '.rbxw-dark.rbxw-padbanner .rbxw-title{color:#fff}' +
      '.rbxw-dark.rbxw-padbanner .rbxw-creator{color:rgba(255,255,255,.9)}' +
      '.rbxw-dark.rbxw-padbanner .rbxw-titles{text-shadow:0 1px 14px rgba(0,0,0,.6)}' +
      // An equal-width grid, so the tiles line up across every card on the page
      // instead of each one sizing itself to its own numbers.
      '.' + PREFIX + 'stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px;margin-top:16px}' +
      '.' + PREFIX + 'stat{min-width:0;padding:10px 11px;border-radius:12px;background:var(--rbxw-tile);border:1px solid var(--rbxw-line);color:var(--rbxw-dim);font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;line-height:1.3}' +
      // The label is its own block, so it can never end up on the same line as
      // the number, and the number keeps tabular figures so a card that refreshes
      // does not shuffle sideways while it counts.
      '.' + PREFIX + 'cap{display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.' + PREFIX + 'val{display:block;font-size:17px;font-weight:780;letter-spacing:-.02em;font-variant-numeric:tabular-nums;text-transform:none;color:var(--rbxw-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      // The value carries its own class so that .rbxw-live, declared after it
      // and with the same weight, is what decides the colour of the player
      // count. That keeps the descendant selector on `b` out of the way and
      // leaves .rbxw-live free to be restyled from the host's stylesheet.
      '.' + PREFIX + 'live{color:var(--rbxw-live)}' +
      // A breathing dot next to the player count, so "live" is visible without
      // reading the number. Suppressed for visitors who asked for less motion.
      '.' + PREFIX + 'livewrap{display:flex;align-items:center;gap:6px;min-width:0}' +
      '.' + PREFIX + 'livewrap .rbxw-val{min-width:0}' +
      '.' + PREFIX + 'dot{width:6px;height:6px;border-radius:50%;background:var(--rbxw-live);flex-shrink:0;animation:rbxw-pulse 2s ease-out infinite}' +
      '@keyframes rbxw-pulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.5)}70%{box-shadow:0 0 0 7px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}' +
      '.' + PREFIX + 'a{color:inherit;text-decoration:none;display:block;font-family:inherit}' +
      '.' + PREFIX + 'a:hover .' + PREFIX + 'title{text-decoration:underline;text-underline-offset:2px}' +
      // The text properties a host page is most likely to set on bare
      // elements, restated so the card looks the same wherever it is pasted.
      '.' + PREFIX + 'title,.' + PREFIX + 'creator,.' + PREFIX + 'stat,.' + PREFIX + 'val,.' + PREFIX + 'cap,.' + PREFIX + 'live,.' + PREFIX + 'err,.' + PREFIX + 'foot{font-family:inherit;line-height:1.4;font-style:normal}' +
      '.' + PREFIX + 'foot [data-stale]{color:#fbbf24;cursor:help}' +
      '.' + PREFIX + 'light .foot [data-stale]{color:#a16207}' +
      '.' + PREFIX + 'foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid var(--rbxw-line);font-size:12px;font-weight:600;color:var(--rbxw-dim)}' +
      '.' + PREFIX + 'go{display:inline-flex;align-items:center;gap:5px;color:var(--rbxw-fg)}' +
      '.' + PREFIX + 'go svg{width:13px;height:13px;flex-shrink:0;transition:transform .18s ease}' +
      '.' + PREFIX + 'a:hover .rbxw-go svg{transform:translateX(3px)}' +
      '.' + PREFIX + 'err{padding:18px;font-size:13px;line-height:1.55;color:#fca5a5}' +
      '.' + PREFIX + 'err b{display:block;margin-bottom:5px;font-size:14px;font-weight:700;color:#fff}' +
      // Painted between the script tag running and the answer arriving, so the
      // space the card will take is already reserved and nothing jumps.
      '.' + PREFIX + 'sk{width:100%;max-width:520px;border-radius:18px;overflow:hidden;background:var(--rbxw-tile);border:1px solid var(--rbxw-line)}' +
      '.' + PREFIX + 'skbar{height:124px;background:var(--rbxw-line)}' +
      '.' + PREFIX + 'skbody{padding:16px 18px 18px}' +
      '.' + PREFIX + 'skrow{height:13px;border-radius:7px;background:var(--rbxw-line);margin-bottom:10px;animation:rbxw-fade 1.4s ease-in-out infinite}' +
      '.' + PREFIX + 'skrow.w70{width:70%}' +
      '.' + PREFIX + 'skrow.w40{width:40%}' +
      '.' + PREFIX + 'sktiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px;margin-top:16px}' +
      '.' + PREFIX + 'sktile{height:56px;border-radius:12px;background:var(--rbxw-line);animation:rbxw-fade 1.4s ease-in-out infinite}' +
      '@keyframes rbxw-fade{0%,100%{opacity:1}50%{opacity:.4}}' +
      '@media (prefers-reduced-motion:reduce){' +
      '.' + PREFIX + 'dot,' + '.' + PREFIX + 'skrow,' + '.' + PREFIX + 'sktile{animation:none}' +
      '.' + PREFIX + 'card{transition:none}' +
      '.' + PREFIX + 'card:hover{transform:none}' +
      '}';

    var style = existing || document.createElement('style');
    style.id = PREFIX + 'styles';
    style.setAttribute('data-rbxw-build', STYLE_BUILD);
    style.textContent = css;
    if (!existing) {
      // First, not last. Every rule above is a class selector, so it still beats
      // a bare `p { ... }` on the host page no matter where it sits. Putting it
      // at the top of the head means a page that wants `.rbxw-live { color: … }`
      // in its own stylesheet actually wins, which is what the docs promise.
      document.head.insertBefore(style, document.head.firstChild);
    }
  }

  /** Paints the placeholder shape, so the layout does not jump on arrival. */
  function buildSkeleton(host, theme, compact) {
    host.textContent = '';
    host.className = host.className.replace(/\brbxw-\S+/g, '').trim();

    var sk = document.createElement('div');
    sk.className = PREFIX + 'sk ' + PREFIX + (theme === 'light' ? 'light' : 'dark');
    sk.setAttribute('aria-hidden', 'true');

    if (!compact) {
      var bar = document.createElement('div');
      bar.className = PREFIX + 'skbar';
      sk.appendChild(bar);
    }

    var body = document.createElement('div');
    body.className = PREFIX + 'skbody';

    var r1 = document.createElement('div');
    r1.className = PREFIX + 'skrow w70';
    var r2 = document.createElement('div');
    r2.className = PREFIX + 'skrow w40';
    body.appendChild(r1);
    body.appendChild(r2);

    var tiles = document.createElement('div');
    tiles.className = PREFIX + 'sktiles';
    var n = compact ? 2 : 3;
    for (var i = 0; i < n; i++) {
      var t = document.createElement('div');
      t.className = PREFIX + 'sktile';
      tiles.appendChild(t);
    }
    body.appendChild(tiles);

    sk.appendChild(body);
    host.appendChild(sk);
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

    // The logo only overlaps the banner when there is a banner to overlap, and
    // only when the card is wide enough for the pull-up to read as intentional.
    var hasBanner = !compact && !!data.banner;
    if (hasBanner) {
      var banner = document.createElement('div');
      banner.className = PREFIX + 'banner';
      banner.style.backgroundImage = 'url("' + data.banner + '")';
      card.appendChild(banner);
      card.className += ' ' + PREFIX + 'padbanner';
    }

    var body = document.createElement('div');
    body.className = PREFIX + 'body';

    var head = document.createElement('div');
    head.className = PREFIX + 'head';

    if (data.thumbnail) {
      var logo = document.createElement('div');
      logo.className = PREFIX + 'logo';
      logo.style.backgroundImage = 'url("' + data.thumbnail + '")';
      logo.setAttribute('role', 'img');
      logo.setAttribute('aria-label', (data.name || 'Game') + ' logo');
      head.appendChild(logo);
    } else if (!hasBanner) {
      // Without a banner to sit against, the head needs its own top spacing.
      head.className += ' ' + PREFIX + 'headnoimg';
    }

    var titles = document.createElement('div');
    titles.className = PREFIX + 'titles';

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

    function addStat(label, value, opts) {
      opts = opts || {};
      var stat = document.createElement('div');
      stat.className = PREFIX + 'stat';

      // The value and the label are separate block-level elements. As a bare
      // text node the label landed on the same line as the number, because
      // anything inside the inline-flex live wrapper is a flex item and stops
      // being a block.
      var val = document.createElement(opts.live ? 'span' : 'b');
      val.className = PREFIX + 'val' + (opts.live ? ' ' + PREFIX + 'live' : '');

      if (opts.live) {
        // The dot is a sibling of the number rather than a background on it, so
        // it keeps its size whatever font-size the host page gives the value.
        var wrap = document.createElement('span');
        wrap.className = PREFIX + 'livewrap';
        var dot = document.createElement('span');
        dot.className = PREFIX + 'dot';
        dot.setAttribute('aria-hidden', 'true');
        wrap.appendChild(dot);
        val.textContent = value;
        wrap.appendChild(val);
        stat.appendChild(wrap);
      } else {
        val.textContent = value;
        stat.appendChild(val);
      }

      val.title = value; // the exact value in the tooltip

      var cap = document.createElement('span');
      cap.className = PREFIX + 'cap';
      cap.textContent = label;
      stat.appendChild(cap);

      stats.appendChild(stat);
    }

    addStat('playing', short(playing), { live: true });
    addStat('likes', short(upVotes));
    if (!compact) addStat('visits', short(visits));

    body.appendChild(stats);

    var foot = document.createElement('div');
    foot.className = PREFIX + 'foot';

    var tag = document.createElement('span');
    tag.textContent = compact ? 'Live from Roblox' : 'Stats update live';
    foot.appendChild(tag);

    var go = document.createElement('span');
    go.className = PREFIX + 'go';
    go.appendChild(document.createTextNode('Open on Roblox'));
    // An inline arrow, so the card needs no icon font and no extra request.
    var arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 24 24');
    arrow.setAttribute('fill', 'none');
    arrow.setAttribute('stroke', 'currentColor');
    arrow.setAttribute('stroke-width', '2.5');
    arrow.setAttribute('stroke-linecap', 'round');
    arrow.setAttribute('stroke-linejoin', 'round');
    arrow.setAttribute('aria-hidden', 'true');
    var p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p1.setAttribute('d', 'M5 12h14');
    var p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p2.setAttribute('d', 'M13 6l6 6-6 6');
    arrow.appendChild(p1);
    arrow.appendChild(p2);
    go.appendChild(arrow);
    foot.appendChild(go);

    body.appendChild(foot);

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
    var b = document.createElement('b');
    b.textContent = 'Could not load this game';
    err.appendChild(b);
    err.appendChild(document.createTextNode(message));
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
        // A refresh that arrives after the credit was pulled must not wipe the
        // card that is already on screen and replace it with an error.
        if (creditBlocked) {
          renderError(host, CREDIT_OFF_MESSAGE);
          return;
        }
        buildCard(host, data, opts);
      })
      .catch(function (err) {
        // If a card is already on screen it was real a moment ago, and one
        // lost packet is not a reason to take it away from somebody reading
        // it. The numbers are a few seconds old; the card is still true.
        if (host.querySelector('.' + PREFIX + 'card')) {
          markStale(host);
          return;
        }
        renderError(host, describeError(err));
      });
  }

  /**
   * Two different failures with two different words, because the action a
   * visitor can take is different. A timeout is our server or the path to it;
   * an offline browser is theirs.
   */
  function describeError(err) {
    if (err && err.code === 'RBX_TIMEOUT') return 'The server did not answer in time. This usually clears on its own.';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 'This device appears to be offline.';
    }
    var message = (err && err.message) || '';
    if (!message) return 'The request failed.';
    return message;
  }

  /**
   * Marks a card as showing older numbers rather than replacing it. The
   * timestamp going quiet is the whole signal: it stops being a live counter,
   * which is the difference between "this is current" and "this is when we last
   * heard".
   */
  function markStale(host) {
    // The card says "Stats update live" in the first cell of its foot, and that
    // is the claim that becomes untrue. It is a <span> with no class of its own,
    // so it is found by position rather than by name.
    var foot = host.querySelector('.' + PREFIX + 'foot');
    if (!foot) return;
    var stamp = foot.firstElementChild;
    if (!stamp) return;
    if (stamp.getAttribute('data-stale') === 'true') return;
    stamp.setAttribute('data-stale', 'true');
    var was = stamp.textContent;
    stamp.textContent = 'Last update failed';
    stamp.title =
      'Showing the last successful update' + (was ? ' (' + was.toLowerCase() + ')' : '') +
      '. These numbers are a few seconds old, not wrong.';
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
      // Reserve the card's footprint before the request goes out, so the page
      // does not jump once the numbers land.
      buildSkeleton(host, opts.theme, opts.fields === 'compact');
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
    'position:fixed;left:14px;bottom:14px;z-index:2147483000;' +
    'display:inline-flex;align-items:center;gap:8px;' +
    'max-width:calc(100vw - 28px);box-sizing:border-box;' +
    'padding:7px 14px 7px 8px;border-radius:999px;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
    'font-size:12.5px;font-weight:600;line-height:1.25;letter-spacing:.005em;' +
    'text-decoration:none;cursor:pointer;' +
    // A blurred backdrop rather than a flat fill: the badge floats over somebody
    // else's photography, and a solid block over artwork reads as a mistake.
    'background:rgba(16,17,19,.88);color:#f4f4f5;border:1px solid rgba(255,255,255,.14);' +
    'box-shadow:0 4px 16px rgba(0,0,0,.4),0 1px 2px rgba(0,0,0,.24);' +
    'backdrop-filter:blur(10px) saturate(1.3);-webkit-backdrop-filter:blur(10px) saturate(1.3);' +
    'transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease;' +
    '}' +
    '#' + CREDIT_ID + ':hover{transform:translateY(-1px);color:#fff;border-color:rgba(255,255,255,.32);' +
    'box-shadow:0 8px 22px rgba(0,0,0,.4),0 1px 2px rgba(0,0,0,.2);}' +
    '#' + CREDIT_ID + ':active{transform:translateY(0)}' +
    // The tag doubles as the badge's icon, so the badge reads as branded even
    // when the text next to it has been truncated away on a narrow phone.
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-tag{' +
    'font-size:10px;font-weight:800;line-height:1;letter-spacing:.07em;' +
    /* White on amber is 1.9:1; this brown on amber is 5.4:1, so the tag stays
       readable on both a light and a dark host page. */
    'color:#6b3f00;background:#fbbf24;border-radius:999px;padding:4px 7px;flex-shrink:0;}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-text{color:#f4f4f5;white-space:nowrap;' +
    'overflow:hidden;text-overflow:ellipsis;}' +
    // Only the name is a link, and it carries its own colour so a host rule
    // like `a { color: inherit }` cannot flatten it into the surrounding text
    // and make the badge look unclickable.
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-link{color:#a78bfa;text-decoration:none;' +
    'font-weight:700;}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-link:hover{color:#c4b5fd;text-decoration:underline;}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-link:focus-visible{outline:2px solid #a78bfa;' +
    'outline-offset:2px;border-radius:3px;}' +
    '@media (prefers-color-scheme:light){' +
    '#' + CREDIT_ID + '{background:rgba(255,255,255,.9);color:#0a0a0a;border-color:rgba(91,52,232,.28);' +
    'box-shadow:0 4px 16px rgba(0,0,0,.14),0 1px 2px rgba(0,0,0,.07);}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-text{color:#0a0a0a;}' +
    // Amber reads as a washed-out link on a white badge; this brown is 5.4:1.
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-link{color:#5b34e8;}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-link:hover{color:#4a24c9;}' +
    '#' + CREDIT_ID + ' .' + PREFIX + 'credit-link:focus-visible{outline-color:#5b34e8;}' +
    '}';

  var NOTICE_CSS =
    '#' + PREFIX + 'credit-notice{' +
    'position:fixed;left:14px;bottom:14px;z-index:2147483001;' +
    'max-width:min(420px,calc(100vw - 28px));box-sizing:border-box;' +
    'padding:16px 18px;border-radius:14px;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
    'font-size:13px;font-weight:400;line-height:1.55;color:#fde8e8;' +
    'background:#2a1215;border:1px solid #7f1d1d;box-shadow:0 10px 30px rgba(0,0,0,.42);' +
    '}' +
    '#' + PREFIX + 'credit-notice b{display:block;margin-bottom:6px;font-size:14px;' +
    'font-weight:700;line-height:1.4;color:#fff;letter-spacing:-.01em;}' +
    '#' + PREFIX + 'credit-notice .' + PREFIX + 'notice-why{display:block;margin-bottom:14px;}' +
    '#' + PREFIX + 'credit-notice button{' +
    'font:inherit;font-size:12.5px;font-weight:700;line-height:1.4;cursor:pointer;' +
    'color:#2a1215;background:#fbbf24;border:0;border-radius:9px;padding:9px 16px;' +
    'box-shadow:0 1px 2px rgba(0,0,0,.2);}' +
    '#' + PREFIX + 'credit-notice button:hover{background:#fcd34d;}' +
    '#' + PREFIX + 'credit-notice button:focus-visible{outline:2px solid #fbbf24;outline-offset:2px;}';

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
    head.textContent = 'MoonBlox is turned off on this page';
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
    runBindings();
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
