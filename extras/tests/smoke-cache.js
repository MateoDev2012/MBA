/**
 * The cache is the only thing standing between a 429 from Roblox and an outage
 * here, and its three behaviours are easy to break without noticing:
 *
 *   1. a fresh value is served normally,
 *   2. a 429 with something in the grace window serves the old value instead of
 *      an error, and says so,
 *   3. a 429 with nothing cached does not turn into a stream of 429s: the
 *      cooldown stops the second and third caller from reaching Roblox at all.
 *
 * Run directly (`node extras/tests/smoke-cache.js`) or through `npm test`.
 */

import { cache } from '../../src/cache.js';

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rateLimited() {
  const err = new Error('Roblox is rate limiting requests (429)');
  err.status = 429;
  err.code = 'UPSTREAM_RATE_LIMITED';
  return err;
}

console.log('cache: resilience against an upstream that refuses us');

/* 1. A fresh value is served, and the producer only runs once. */
{
  cache.clear();
  let calls = 0;
  const producer = async () => {
    calls++;
    return { v: calls };
  };
  const a = await cache.wrapResilient('t:fresh', 60, producer);
  const b = await cache.wrapResilient('t:fresh', 60, producer);
  check('first call populates the cache', calls === 1, `calls=${calls}`);
  check('second call does not hit the producer', a.value.v === 1 && b.value.v === 1);
  check('second call is marked cached', b.cached === true);
  check('a fresh value is not marked stale', b.stale === false);
}

/* 2. After the TTL, a 429 serves the old value instead of erroring. */
{
  cache.clear();
  // TTL 0 so the entry is instantly expired, with a long grace window.
  await cache.wrapResilient('t:stale', 0, async () => ({ v: 'real' }), { staleSeconds: 300 });
  let ref = await cache.wrapResilient('t:stale', 0, async () => {
    throw rateLimited();
  }, { staleSeconds: 300 });
  check('expired entry + 429 serves the old value', ref.value.v === 'real', JSON.stringify(ref));
  check('and marks it stale', ref.stale === true);
  check('and does not throw', true);
}

/* 3. Cooldown: after a 429 with nothing cached, later callers do not reach out. */
{
  cache.clear();
  let upstreamCalls = 0;
  const alwaysRefused = async () => {
    upstreamCalls++;
    throw rateLimited();
  };

  let threw = null;
  try {
    await cache.wrapResilient('t:cooldown', 60, alwaysRefused, { cooldownSeconds: 60 });
  } catch (err) {
    threw = err;
  }
  check('cold cache + 429 does throw', threw?.code === 'UPSTREAM_RATE_LIMITED');

  // The next twenty visitors must not each fire a request at Roblox.
  let furtherThrows = 0;
  for (let i = 0; i < 20; i++) {
    try {
      await cache.wrapResilient('t:cooldown', 60, alwaysRefused, { cooldownSeconds: 60 });
    } catch (err) {
      furtherThrows++;
    }
  }
  check('cooldown still answers 429 to the caller', furtherThrows === 20, `threw ${furtherThrows}/20`);
  check(
    'but only the FIRST request reached Roblox',
    upstreamCalls === 1,
    `upstream called ${upstreamCalls} times — this is the stampede the cooldown exists to stop`
  );
  check('isCooling reports the key', cache.isCooling('t:cooldown') === true);
  check('cooldownRemaining is positive', cache.cooldownRemaining('t:cooldown') > 0);
}

/* 4. Cooldown is per key, so one refused key does not freeze the others. */
{
  cache.clear();
  try {
    await cache.wrapResilient('t:a', 60, async () => { throw rateLimited(); }, { cooldownSeconds: 60 });
  } catch { /* expected */ }
  let otherWorked = false;
  try {
    const r = await cache.wrapResilient('t:b', 60, async () => ({ ok: 1 }));
    otherWorked = r.value.ok === 1;
  } catch { /* should not happen */ }
  check('a refused key does not block a different one', otherWorked);
  check('a cooled key stays cool', cache.isCooling('t:a') === true);
  check('a fresh key is not cool', cache.isCooling('t:b') === false);
}

/* 5. A success clears the cooldown, so recovery is not gated by a timer. */
{
  cache.clear();
  try {
    await cache.wrapResilient('t:recover', 60, async () => { throw rateLimited(); }, { cooldownSeconds: 1 });
  } catch { /* expected */ }
  check('cooled after a refusal', cache.isCooling('t:recover') === true);
  await sleep(1100);
  check('cooldown expires on its own', cache.isCooling('t:recover') === false);
  const r = await cache.wrapResilient('t:recover', 60, async () => ({ ok: 'back' }));
  check('and upstream is reachable again', r.value.ok === 'back');
}

/* 6. Single-flight still holds on the resilient path. */
{
  cache.clear();
  let calls = 0;
  const slow = async () => {
    calls++;
    await sleep(60);
    return { v: calls };
  };
  const results = await Promise.all([
    cache.wrapResilient('t:sf', 60, slow),
    cache.wrapResilient('t:sf', 60, slow),
    cache.wrapResilient('t:sf', 60, slow),
  ]);
  check('three concurrent callers make one upstream call', calls === 1, `calls=${calls}`);
  check('and all three get the value', results.every((r) => r.value.v === 1));
}

/* 7. Nothing is marked stale when nothing went wrong. */
{
  cache.clear();
  const r = await cache.wrapResilient('t:clean', 60, async () => 'fine');
  check('a healthy response is never marked stale', r.stale === false);
  check('and is not marked cooled', r.cooled === undefined);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
