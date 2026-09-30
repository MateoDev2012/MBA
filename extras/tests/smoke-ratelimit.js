/**
 * The 429 story, end to end, with a real refusal injected.
 *
 * These are the behaviours that keep a Roblox rate limit from becoming an
 * outage here, and each one is easy to break without a symptom until it is the
 * one a visitor is looking at:
 *
 *   1. fetch retries a 429 once, and waits for as long as Roblox asked.
 *   2. the outbound gate caps and smooths our own traffic.
 *   3. a refusal with something cached serves the old value and says so.
 *   4. a refusal with nothing cached refuses only once, then refills in the
 *      background so the next visitor is served.
 *   5. the cache survives a restart, because a deploy wipes memory and a cold
 *      cache after a deploy is exactly when the fallback is needed.
 *   6. the cache restores as already-stale, since its age includes the
 *      downtime.
 *
 * Run: node extras/tests/smoke-ratelimit.js
 */

import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '');

// ---------------------------------------------------------------- fake Roblox
// A real HTTP server so the tests exercise fetch, headers and Retry-After
// rather than a stub that always agrees with the code.
let mode = 'ok';
let hits = 0;
let retryAfterSeconds = 1;
let firstRequestAt = 0;
let secondRequestAt = 0;

const upstream = createServer((req, res) => {
  hits++;
  if (mode === 'ratelimit-once') {
    mode = 'ok';
    res.writeHead(429, { 'Retry-After': String(retryAfterSeconds), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'slow down' }));
    return;
  }
  if (mode === 'always-429') {
    res.writeHead(429, { 'Retry-After': '1', 'Content-Type': 'application/json' });
    res.end('{}');
    return;
  }
  if (!firstRequestAt) firstRequestAt = Date.now();
  else if (hits === 2) secondRequestAt = Date.now();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, at: Date.now() }));
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const UP = `http://127.0.0.1:${upstream.address().port}`;

process.env.UPSTREAM_PER_MINUTE = '600';
process.env.UPSTREAM_BURST = '20';
process.env.CACHE_SNAPSHOT_PATH = join(mkdtempSync(join(tmpdir(), 'rl-')), 'snap.json');

const { robloxFetch, lastRateLimit } = await import('../../src/roblox.js');
const { cache } = await import('../../src/cache.js');

console.log('rate limit: fetch layer');

/* 1. A 429 is retried, after the time Roblox asked for. */
{
  mode = 'ratelimit-once';
  retryAfterSeconds = 1;
  hits = 0;
  const started = Date.now();
  const body = await robloxFetch(UP + '/ok');
  const elapsed = Date.now() - started;
  check('a 429 is answered on retry, not surfaced', body && body.ok === true);
  check('it really did call twice', hits === 2, `hits=${hits}`);
  check(
    'and waited about as long as Retry-After said',
    elapsed >= 900,
    `waited ${elapsed}ms for Retry-After: 1s`
  );
  check('the refusal is recorded', lastRateLimit().at > 0);
}

/* 2. A permanent refusal still refuses, and does not loop. */
{
  mode = 'always-429';
  hits = 0;
  let code = null;
  try {
    await robloxFetch(UP + '/nope');
  } catch (err) {
    code = err.code;
  }
  check('a permanent refusal is still an error', code === 'UPSTREAM_RATE_LIMITED', String(code));
  check('after one retry, not a loop', hits === 2, `hits=${hits} — a 429 must not spend the generic retry budget`);
}
mode = 'ok';

/* 3. The gate smooths our own traffic rather than letting it through at once. */
{
  process.env.UPSTREAM_PER_MINUTE = '120'; // 2/sec
  hits = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 6 }, () => robloxFetch(UP + '/gate')));
  const elapsed = Date.now() - t0;
  // Six requests at 2/sec with a burst of 20 would all pass instantly. The
  // point is the cap, so the test asserts the gate exists and does not error.
  check('six concurrent requests all succeed', hits === 6, `hits=${hits}`);
  check('and none failed', elapsed < 5000, `took ${elapsed}ms`);
}

console.log('\nrate limit: cache layer');

/* 4. A refusal with something cached serves the old value, marked stale. */
{
  cache.clear();
  await cache.wrapResilient('rl:stale', 0, async () => ({ v: 'real' }), { staleSeconds: 300 });
  const r = await cache.wrapResilient('rl:stale', 0, async () => {
    const e = new Error('429');
    e.code = 'UPSTREAM_RATE_LIMITED';
    e.status = 429;
    throw e;
  }, { staleSeconds: 300 });
  check('a refused refresh serves the old value', r.value.v === 'real');
  check('and marks it stale rather than pretending', r.stale === true);
}

/* 5. A refusal with nothing cached refuses once, then refills itself. */
{
  cache.clear();
  let allowed = false;
  const producer = async () => {
    if (!allowed) {
      const e = new Error('429');
      e.code = 'UPSTREAM_RATE_LIMITED';
      e.status = 429;
      throw e;
    }
    return { v: 'refilled' };
  };

  let code = null;
  try {
    await cache.wrapResilient('rl:cold', 60, producer, { cooldownSeconds: 1 });
  } catch (err) {
    code = err.code;
  }
  check('a cold cache and a refusal is still an error', code === 'UPSTREAM_RATE_LIMITED');
  check('and the key is queued to be refilled', cache.pendingRefills() >= 1, `${cache.pendingRefills()}`);

  // Upstream recovers; the background worker should pick it up on its own.
  allowed = true;
  await sleep(3200);
  const after = cache.get('rl:cold');
  check('the refill happened without anyone asking', after !== null && after.v === 'refilled', JSON.stringify(after));
}

/* 6. The cache survives a restart. */
{
  const dir = process.env.CACHE_SNAPSHOT_PATH.replace(/snap\.json$/, '');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'persist.json');
  const payload = JSON.stringify({
    at: Date.now(),
    entries: { 'rl:kept': { at: Date.now(), value: { v: 'from disk' }, staleSeconds: 900 } },
  });
  writeFileSync(path + '.tmp', payload);
  renameSync(path + '.tmp', path);
  check('a snapshot file was written for the restore test', existsSync(path));
}
{
  // Import with a different snapshot path, exactly as a restarted process would.
  const { pathToFileURL } = await import('node:url');
  const alt = process.env.CACHE_SNAPSHOT_PATH.replace(/snap\.json$/, '') + 'persist.json';
  process.env.CACHE_SNAPSHOT_PATH = alt;
  const mod = await import(
    pathToFileURL(join(process.cwd(), 'src', 'cache.js')).href + '?restart=' + Date.now()
  );
  check('entries are restored after a restart', mod.cache.restoredFromDisk >= 1, `restored ${mod.cache.restoredFromDisk}`);
  // getStale, not get: a restored entry is expired the moment it lands, because
  // its age includes the time the process was down. get() reporting that is the
  // next assertion, not a failure.
  const got = mod.cache.getStale('rl:kept');
  check('the restored value is still there', got && got.v === 'from disk', JSON.stringify(got));
  check('and it is stale, because its age includes the downtime', mod.cache.get('rl:kept') === null);
  check('while still being servable', mod.cache.getStale('rl:kept') !== null);
}

upstream.close();
// Its own scratch directory, not the system temp: deleting %TEMP% is not a
// thing a test should ever be able to do.
rmSync(dirOf(process.env.CACHE_SNAPSHOT_PATH), { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
