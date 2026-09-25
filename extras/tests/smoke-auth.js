/**
 * API key suite.
 * Usage:  node extras/tests/smoke-auth.js      (starts and stops its own servers)
 *
 * Every other suite needs a server already running. This one cannot, because
 * the whole subject is how the server behaves under different API_KEYS and
 * API_KEY_MODE settings, so it starts a fresh one per scenario on its own port
 * and kills it again. No mocks: the point is to prove the middleware ORDER and
 * the status codes a browser will actually see, both of which a unit test with
 * a fake req/res would happily agree with while the real thing 401s.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Resolved from this file, not from the cwd, so the suite runs from anywhere.
const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, '..', '..', 'src', 'server.js');

const PORT = Number(process.env.AUTH_TEST_PORT || 3311);
const BASE = `http://localhost:${PORT}`;
const ID = 994732206;
const GOOD = 'Made by MoonlightStudios';
const OTHER = 'second-key';
const BAD = 'nope';

let pass = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'pass  ' : 'FAIL  '} ${name}${ok ? '' : '  <- ' + detail}`);
  ok ? pass++ : failed++;
};

function startServer(env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [serverEntry], {
      env: { ...process.env, PORT: String(PORT), RATE_LIMIT_MAX: '5000', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d;
      if (out.includes('listening')) resolve(proc);
    });
    proc.stderr.on('data', (d) => {
      out += d;
    });
    proc.on('exit', (code) => reject(new Error(`server exited ${code}: ${out}`)));
    setTimeout(() => reject(new Error('timeout: ' + out)), 15000);
  });
}

const get = (path, { key, origin, method = 'GET', headers: extra } = {}) => {
  const headers = { ...(extra || {}) };
  if (key) headers['X-API-Key'] = key;
  if (origin) headers['Origin'] = origin;
  return fetch(BASE + path, { method, headers }).then(async (r) => ({
    status: r.status,
    keyHeader: r.headers.get('x-rbx-key'),
    limit: r.headers.get('ratelimit-limit'),
    body: await r.json().catch(() => null),
  }));
};

/**
 * Runs one scenario against a freshly started server.
 *
 * API_KEYS and API_KEY_MODE are forced to a known value first, and an empty
 * string is used rather than leaving them unset. `process.env` is inherited, so
 * a developer (or CI) with API_KEYS exported would otherwise silently turn
 * "no keys configured" into "keys configured" and the suite would pass while
 * testing the wrong thing. That is not hypothetical: it is exactly what
 * happened the first time this ran from a shell that had the key exported.
 */
async function scenario(label, env, fn) {
  console.log(`\n-- ${label} --`);
  const proc = await startServer({ API_KEYS: '', API_KEY_MODE: '', ...env });
  try {
    await fn();
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 400));
  }
}

await scenario('mode off: no API_KEYS set', {}, async () => {
  const anon = await get(`/api/v1/games/${ID}/quick`);
  check('anonymous request works', anon.status === 200, `status ${anon.status}`);
  const bogus = await get(`/api/v1/games/${ID}/quick`, { key: BAD });
  check('a bogus key does not break anything', bogus.status === 200, `status ${bogus.status}`);
  check('X-RBX-Key reports none', bogus.keyHeader === 'none', bogus.keyHeader);
  const me = await get('/api/v1/keys/me');
  check('keys/me says mode off', me.body?.mode === 'off', JSON.stringify(me.body));
});

await scenario('mode optional: the default once keys exist', { API_KEYS: GOOD }, async () => {
  const anon = await get(`/api/v1/games/${ID}/quick`);
  check('anonymous still works', anon.status === 200, `status ${anon.status}`);
  check('anonymous gets the lower limit', Number(anon.limit) === 30, `limit ${anon.limit}`);

  const keyed = await get(`/api/v1/games/${ID}/quick`, { key: GOOD });
  check('keyed request works', keyed.status === 200, `status ${keyed.status}`);
  check('X-RBX-Key reports valid', keyed.keyHeader === 'valid', keyed.keyHeader);
  check('keyed gets the higher limit', Number(keyed.limit) === 600, `limit ${keyed.limit}`);

  const wrong = await get(`/api/v1/games/${ID}/quick`, { key: BAD });
  check('wrong key is not an error in optional mode', wrong.status === 200, `status ${wrong.status}`);
  check('wrong key is reported', wrong.keyHeader === 'none', wrong.keyHeader);

  const me = await get('/api/v1/keys/me', { key: GOOD });
  check('keys/me authenticates', me.body?.authenticated === true, JSON.stringify(me.body));
  check('keys/me counts the request', me.body?.usage?.requests >= 1, JSON.stringify(me.body?.usage));
  check('keys/me never echoes the key', !JSON.stringify(me.body).includes(GOOD), 'leaked the key');

  const bearer = await fetch(`${BASE}/api/v1/games/${ID}/quick`, {
    headers: { Authorization: `Bearer ${GOOD}` },
  });
  check('Authorization: Bearer works too', bearer.status === 200, `status ${bearer.status}`);

  const qs = await get(`/api/v1/games/${ID}/quick?key=${encodeURIComponent(GOOD)}`);
  check('?key= works too', qs.status === 200, `status ${qs.status}`);
});

await scenario(
  'domain lock',
  { API_KEYS: `${GOOD}:Public:moonlight.example;other:Partner:partner.example` },
  async () => {
    const allowed = await get(`/api/v1/games/${ID}/quick`, {
      key: GOOD,
      origin: 'https://www.moonlight.example',
    });
    check('subdomain of a locked domain is allowed', allowed.status === 200, `status ${allowed.status}`);

    const wrongHost = await get(`/api/v1/games/${ID}/quick`, {
      key: GOOD,
      origin: 'https://evil.example',
    });
    check('a different origin is refused even in optional mode', wrongHost.status === 401, `status ${wrongHost.status}`);
    check('refusal names the reason', wrongHost.keyHeader === 'wrong-domain', wrongHost.keyHeader);

    // The classic suffix-matching bug: "notmoonlight.example" must not pass.
    const suffix = await get(`/api/v1/games/${ID}/quick`, {
      key: GOOD,
      origin: 'https://notmoonlight.example',
    });
    check('a lookalike domain is refused', suffix.status === 401, `status ${suffix.status}`);

    const noOrigin = await get(`/api/v1/games/${ID}/quick`, { key: GOOD });
    check('curl with no Origin still works', noOrigin.status === 200, `status ${noOrigin.status}`);
  }
);

// The suite sends no key on most requests, so the anonymous ceiling has to be
// raised here for exactly the same reason RATE_LIMIT_MAX is: it is a test rig,
// not a real deployment. The 30/min default is the product decision.
const RIG = { RATE_LIMIT_MAX: '5000', RATE_LIMIT_ANON_MAX: '5000' };

await scenario('mode required', { API_KEYS: GOOD, API_KEY_MODE: 'required', ...RIG }, async () => {
  const anon = await get(`/api/v1/games/${ID}/quick`);
  check('anonymous is refused with 401', anon.status === 401, `status ${anon.status}`);
  check('the error explains itself', /needs an API key/i.test(anon.body?.error?.message || ''), JSON.stringify(anon.body?.error));

  const bad = await get(`/api/v1/games/${ID}/quick`, { key: BAD });
  check('a wrong key is refused with 401', bad.status === 401, `status ${bad.status}`);

  const good = await get(`/api/v1/games/${ID}/quick`, { key: GOOD });
  check('the right key works', good.status === 200, `status ${good.status}`);

  // A POST with no key must be refused by the guard, not by body validation.
  // Sending a body would hide a regression: a 400 here could equally be the
  // route complaining about a missing field.
  const post = await get('/api/v1/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json', body: JSON.stringify({ universeId: ID, html: '{{name}}' }) },
  });
  check('POST endpoints are guarded too', post.status === 401, `status ${post.status}`);

  const postOk = await fetch(`${BASE}/api/v1/render`, {
    method: 'POST',
    headers: { 'X-API-Key': GOOD, 'content-type': 'application/json' },
    body: JSON.stringify({ universeId: ID, html: '<b>{{name}}</b>' }),
  });
  check('POST works with a valid key', postOk.status === 200, `status ${postOk.status}`);

  // A refused key must not have burned rate limit budget.
  const health = await get('/health');
  check('health reports the mode', health.body?.keys?.mode === 'required', JSON.stringify(health.body?.keys));
  check('health is not key-gated', health.status === 200, `status ${health.status}`);

  // The key lives inside the file, so the request that downloads it can never
  // carry one. If it were guarded, required mode would be unusable.
  const file = await get('/roblox-stats.js');
  check('/roblox-stats.js needs no key even in required mode', file.status === 200, `status ${file.status}`);

  // A page that cannot load the file holding its key needs a way to ask why.
  const me = await get('/api/v1/keys/me');
  check('keys/me is reachable without a key', me.status === 200, `status ${me.status}`);
  check('keys/me says why', me.body?.reason === 'missing', JSON.stringify(me.body?.reason));
  check('keys/me hands over the public key so the docs page works', me.body?.publicKey === GOOD, JSON.stringify(me.body));

  const wrongReason = await get('/api/v1/keys/me', { key: BAD });
  check('keys/me distinguishes a wrong key from a missing one', wrongReason.body?.reason === 'unknown', JSON.stringify(wrongReason.body?.reason));

  const okMe = await get('/api/v1/keys/me', { key: GOOD });
  check('keys/me authenticates a good key', okMe.body?.authenticated === true, JSON.stringify(okMe.body));
});

await scenario('several keys configured', { API_KEYS: `${GOOD};${OTHER}`, ...RIG }, async () => {
  // The docs page can only pick a key for itself when there is exactly one, so
  // it must get nothing rather than an arbitrary key that might not be the
  // one its own embeds use.
  const me = await get('/api/v1/keys/me');
  check('keys/me withholds publicKey when there is more than one', me.body?.publicKey === undefined, JSON.stringify(me.body?.publicKey));
  check('mode falls back to optional', me.body?.mode === 'optional', JSON.stringify(me.body?.mode));
  const second = await get(`/api/v1/games/${ID}/quick`, { key: OTHER });
  check('the second key works too', second.status === 200, `status ${second.status}`);
});

await scenario('no keys at all', { API_KEYS: '', API_KEY_MODE: 'off', ...RIG }, async () => {
  const me = await get('/api/v1/keys/me');
  check('keys/me never invents a publicKey', me.body?.publicKey === undefined, JSON.stringify(me.body?.publicKey));
  check('mode is off', me.body?.mode === 'off', JSON.stringify(me.body?.mode));
});

// With no key system in play, the plain RATE_LIMIT_MAX has to be the one that
// applies. It is easy to break this by having the key layer return a default
// instead of null, which silently makes RATE_LIMIT_MAX unreachable and leaves
// an unconfigured checkout stuck at 30/min for no stated reason.
await scenario('RATE_LIMIT_MAX still works when no keys exist', { API_KEYS: '', API_KEY_MODE: '', RATE_LIMIT_MAX: '77' }, async () => {
  const res = await get('/api/v1/games/15339/quick');
  check('the header reports RATE_LIMIT_MAX, not the key defaults', res.limit === '77', `limit ${res.limit}`);
});

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
