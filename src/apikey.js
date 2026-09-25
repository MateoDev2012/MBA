/**
 * API keys.
 *
 * A key is checked in three places, in this order:
 *   1. the X-API-Key request header
 *   2. Authorization: Bearer <key>
 *   3. the ?key= query parameter
 *
 * The header is the one to prefer. A query parameter ends up in access logs,
 * in browser history and in the Referer header of every outbound link on the
 * page, so a key sent that way leaks into places the header does not.
 *
 * Keys live in the API_KEYS environment variable, never in code, so a leaked
 * git history cannot hand out working keys. There are three modes:
 *
 *   off        no API_KEYS set, or API_KEY_MODE=off. Every request is allowed,
 *              which is what an unconfigured local checkout should do.
 *   optional   a valid key raises the rate limit and unlocks the per-key
 *              counters; a request with no key or a wrong key still works.
 *   required   a valid key is mandatory. Every endpoint answers 401 without one.
 *
 * optional is the default once keys exist, because flipping to required also
 * takes down this project's own documentation page and demo, which call the
 * API without a key. Set API_KEY_MODE=required deliberately, not by accident.
 *
 * A note on what a key can and cannot do: these keys travel inside a public
 * .js file, so anyone can read one with view-source. A key is not a secret
 * and must not be treated as one. What it does buy is a rate limit you can
 * lower, a key you can revoke without restarting anything, an optional
 * domain lock, and a per-key request count.
 */

import { config } from './config.js';

const CLOCK = () => Date.now();

/** Parses one "key:name:domain,domain" entry. Everything after the key is optional. */
function parseEntry(raw) {
  const [key, name = '', domains = ''] = String(raw).split(':');
  const id = (key || '').trim();
  if (!id) return null;
  return {
    id,
    name: name.trim(),
    // Empty means "any origin", which is the default so a fresh key is usable
    // immediately instead of failing with a 403 nobody can explain.
    domains: domains
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** Keys configured for this instance, as a Map for lookup. */
const keys = new Map();
let keyIndex = 0;
for (const entry of String(process.env.API_KEYS || '').split(';')) {
  if (!entry.trim()) continue;
  const parsed = parseEntry(entry);
  if (parsed) {
    keyIndex += 1;
    // An unnamed key is identified by its position, not by itself. Defaulting
    // the name to the key would put the key in every /keys/me response, and
    // redacting it to "key 24:Ma..." is worse than useless: it still leaks the
    // length and the first two characters, and it reads like a bug to anyone
    // who sees it. The position leaks nothing at all.
    parsed.label = parsed.name || `key ${keyIndex}`;
    keys.set(parsed.id, parsed);
  }
}

export const apikey = {
  /** off | optional | required */
  mode: (() => {
    const declared = String(process.env.API_KEY_MODE || '').toLowerCase();
    if (['off', 'optional', 'required'].includes(declared)) return declared;
    // Keys present but no explicit mode: do not break the docs page on deploy.
    return keys.size > 0 ? 'optional' : 'off';
  })(),
  configured: keys.size > 0,
  // Rate limits, per minute. Keyed requests get more because they can be
  // revoked and attributed; anonymous ones get less because they cannot.
  anonMax: Number(process.env.RATE_LIMIT_ANON_MAX || 30),
  keyedMax: Number(process.env.RATE_LIMIT_KEYED_MAX || 600),
};

/**
 * Length-independent comparison. A plain `===` leaks, through timing, how many
 * leading characters matched, which turns brute-forcing a key from hopeless
 * into incremental. Cheap to do properly, so it is done properly.
 */
/**
 * Length-independent, content constant-time comparison.
 *
 * The awkward part is that JS cannot early-return on the first differing byte
 * without leaking how many matched. So the loop always runs over the longer of
 * the two strings, folding in a length mismatch as extra noise rather than
 * returning early. Result: a wrong key of the right length and a wrong key of
 * the wrong length take the same time.
 */
function safeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    // charCodeAt out of range is NaN, and NaN coerces to 0 in a bitwise op, so a
    // short string compares as 0 against the real character: a mismatch, which
    // is exactly right.
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Pulls a key out of wherever the caller put it. Returns '' when absent. */
export function extractKey(req) {
  const header = req.get('x-api-key');
  if (header) return header.trim();
  const auth = req.get('authorization');
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  const query = req.query?.key;
  if (typeof query === 'string' && query) return query.trim();
  return '';
}

/** The hostname of the caller, or '' for a non-browser client. */
function originOf(req) {
  const raw = req.get('origin') || '';
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * A listed domain also covers its subdomains, because "example.com" in a lock
 * almost always means the whole site and listing every subdomain by hand is a
 * trap. An exact host, or a suffix after a dot, but never a bare suffix match:
 * "notexample.com" must not pass a lock on "example.com".
 */
function matchesDomain(allowed, host) {
  return allowed.some((d) => host === d || host.endsWith('.' + d));
}

/**
 * Decides who is calling.
 * @returns {{ok: boolean, key: string|null, name: string|null, reason: string|null}}
 *   reason is one of: 'missing' | 'unknown' | 'domain' — safe to echo back,
 *   and deliberately not saying "unknown" vs "missing" would help nobody.
 */
export function checkKey(req) {
  const provided = extractKey(req);

  if (!provided) {
    return { ok: apikey.mode !== 'required', key: null, name: null, reason: 'missing' };
  }

  // Walks every key rather than a Map lookup, so the time taken does not
  // reveal WHICH key matched or how far a guess got. With a handful of keys the
  // cost is irrelevant next to the network round trip that preceded it.
  let entry = null;
  let found = false;
  for (const candidate of keys.values()) {
    if (safeEqual(candidate.id, provided)) {
      entry = candidate;
      found = true;
    }
  }

  if (!found) {
    return { ok: apikey.mode !== 'required', key: null, name: null, reason: 'unknown' };
  }

  if (entry.domains.length > 0) {
    const host = originOf(req);
    // A key locked to domains is a browser key. A server-to-server caller
    // sends no Origin at all, and failing those would break curl and the SDK,
    // so an absent Origin is allowed and only a WRONG one is refused.
    if (host && !matchesDomain(entry.domains, host)) {
      return { ok: false, key: provided, name: entry.label, reason: 'domain' };
    }
  }

  return { ok: true, key: provided, name: entry.label, reason: null };
}

/** Per-key request counters, for GET /api/v1/keys/me and /health. */
const usage = new Map(); // key -> { count, firstSeen, lastSeen }

function record(key, now) {
  let row = usage.get(key);
  if (!row) {
    row = { count: 0, firstSeen: now, lastSeen: now };
    usage.set(key, row);
  }
  row.count += 1;
  row.lastSeen = now;
  return row;
}

/**
 * Attaches req.apiKeyInfo and enforces `required`. Runs after CORS and before
 * the rate limiter, so a bad key is answered with 401 and never consumes quota.
 */
export function apiKeyGuard() {
  return function (req, res, next) {
    const result = checkKey(req);
    const now = CLOCK();

    req.apiKeyInfo = result;
    if (result.key) record(result.key, now);

    // Echoed so a browser can tell a valid key from an invalid one without
    // having to provoke an error. Reports whether a key was actually CHECKED,
    // not whether the request was allowed: in optional mode a request with no
    // key is happily served, and answering "valid" there would be a lie.
    res.setHeader(
      'X-RBX-Key',
      result.reason === 'domain' ? 'wrong-domain' : result.key ? 'valid' : 'none'
    );

    if (result.ok) return next();

    const message =
      {
        missing: 'This endpoint needs an API key. Send it in the X-API-Key header.',
        unknown: 'That API key is not valid.',
        domain: 'That API key is not allowed on this domain.',
      }[result.reason] || 'Invalid API key.';

    return res.status(401).json({
      ok: false,
      error: { code: 'UNAUTHORIZED', message },
    });
  };
}

/**
 * The number the rate limiter should charge this request against, or null when
 * no key system is in play at all.
 *
 * Returning null rather than a number in `off` mode is deliberate: it is what
 * lets the limiter fall back to RATE_LIMIT_MAX. Returning a default here
 * instead would make that setting unreachable, and a configuration variable
 * that silently does nothing is worse than one that is absent.
 */
export function rateLimitCeiling(req) {
  if (apikey.mode === 'off') return null;
  return req.apiKeyInfo?.ok && req.apiKeyInfo.key ? apikey.keyedMax : apikey.anonMax;
}

/**
 * The first configured key, for the documentation page to use on itself.
 *
 * Only meaningful in `required` mode, and only a convenience: the key is
 * already readable in the public .js file, so this discloses nothing. If there
 * is no key, or there are several, returns null and the docs page simply goes
 * unauthenticated, which is correct for the default `optional` mode.
 */
export function firstKey() {
  if (keys.size !== 1) return null;
  return [...keys.keys()][0];
}

/** Snapshot for GET /api/v1/keys/me. Never echoes the key itself. */
export function describe(req) {
  // The route for this sits ABOVE the key guard, so on that request
  // req.apiKeyInfo was never set. Computing it here is what makes `reason`
  // meaningful, and `reason` is the entire reason this endpoint exists: without
  // it the answer to "why am I not authenticated" is a shrug.
  const info = req.apiKeyInfo || checkKey(req);
  const row = info.key ? usage.get(info.key) : null;
  return {
    ok: true,
    mode: apikey.mode,
    authenticated: !!info.ok && !!info.key,
    name: info.name || null,
    reason: info.reason || null,
    limits: { anonymousPerMinute: apikey.anonMax, keyedPerMinute: apikey.keyedMax },
    // Enough to debug a site, not enough to be a tracking beacon.
    usage: row ? { requests: row.count, firstSeen: row.firstSeen, lastSeen: row.lastSeen } : null,
  };
}

export const _internal = { parseEntry, safeEqual, matchesDomain, keys };
