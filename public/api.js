/**
 * The documentation site's own API client.
 *
 * The site is served by the same server as the API, so it talks to its own
 * /api/v1 endpoints. That would normally be a problem: if the operator turns
 * API_KEY_MODE on with `required`, this site would lock itself out and every
 * button on the docs page would show a 401.
 *
 * So the first call asks /api/v1/keys/me for the public key and sends it from
 * then on. That is not a secret being handled properly; it is the same key that
 * sits in plain text inside the public roblox-stats.js every embedder already
 * downloads. The endpoint only hands it over when the server is in `required`
 * mode and exactly one key is configured, which is exactly the case where the
 * site would otherwise be broken.
 *
 * In the default mode there is no key at all and none of this runs.
 */

(function () {
  'use strict';

  var key = null;

  function learnKey() {
    if (key) return Promise.resolve(key);
    return fetch('/api/v1/keys/me')
      .then(function (r) { return r.json(); })
      .then(function (body) { key = body.publicKey || null; return key; })
      .catch(function () {
        // The endpoint is unreachable. Keep going without a key: correct for
        // the default mode, and otherwise the caller gets a readable 401.
        key = null;
        return null;
      });
  }

  /** fetch() against our own API, with the key header when there is one. */
  function apiFetch(url, opts) {
    var o = opts || {};
    return learnKey().then(function () {
      var headers = Object.assign({}, o.headers);
      if (key) headers['X-API-Key'] = key;
      o.headers = headers;
      return fetch(url, o);
    });
  }

  /** 245412 -> "245.4K". Matches what the embeddable file shows. */
  function abbr(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '\u2014';
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  /** Pretty-print any response body for a <pre>, whatever came back. */
  function show(target, value) {
    var el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;
    el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }

  window.RbxApi = { fetch: apiFetch, abbr: abbr, show: show };
})();
