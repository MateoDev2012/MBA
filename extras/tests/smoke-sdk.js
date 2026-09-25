/**
 * Test for the Node SDK and the MCP server against the local API.
 * Usage:  node extras/tests/smoke-sdk.js
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const { createServer } = await import('node:http');
const { createClient } = await import('../sdk/index.js');

const client = createClient({ baseUrl: BASE, timeoutMs: 20000 });

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    const msg = await fn();
    console.log(`  pass   ${name}${msg ? ` â€” ${msg}` : ''}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL   ${name} â€” ${err.message}`);
    failed++;
  }
}

console.log(`Testing SDK against ${BASE}\n`);

await check('getGame', async () => {
  const g = await client.getGame(994732206);
  if (g.name !== 'Blox Fruits') throw new Error(`unexpected name: ${g.name}`);
  if (typeof g.playing !== 'number') throw new Error('playing is not a number');
  return `${g.name}, ${g.playing.toLocaleString('en-US')} playing, ${g.ratings.upVotes.toLocaleString('en-US')} likes`;
});

await check('getGameQuick', async () => {
  const g = await client.getGameQuick(994732206);
  if (!g.thumbnail) throw new Error('no thumbnail');
  return `thumbnail ok, ratio ${g.upVoteRatio}%`;
});

await check('batch', async () => {
  const b = await client.batch([994732206, 1686885941]);
  if (!Array.isArray(b) || b.length !== 2) throw new Error(`expected 2, got ${b?.length}`);
  return `${b.length} games`;
});

await check('search', async () => {
  const r = await client.search('Blox Fruits', { limit: 5 });
  if (!r.length) throw new Error('no results');
  return r[0].name;
});

await check('resolve', async () => {
  const r = await client.resolve('https://www.roblox.com/games/994732206');
  if (r.universeId !== 994732206) throw new Error('wrong id');
  return `universeId ${r.universeId}`;
});

await check('game passes with prices', async () => {
  const p = await client.getGamePasses(994732206, { includePrices: true });
  const first = p[0];
  if (first?.priceInRobux == null) throw new Error('no price');
  return `${first.name}: ${first.priceInRobux} R$`;
});

await check('badges', async () => {
  const b = await client.getBadges(994732206);
  return `${b.length} badges`;
});

await check('developer', async () => {
  const d = await client.getDeveloper(994732206);
  if (!d.creatorName) throw new Error('no creatorName');
  return `${d.creatorName} (group: ${d.group?.name ?? 'n/a'})`;
});

await check('404 propagates with status', async () => {
  try {
    await client.getGame(999999999999);
    throw new Error('should have thrown');
  } catch (err) {
    if (err.status !== 404) throw new Error(`unexpected status: ${err.status}`);
    return `${err.code}: ${err.message}`;
  }
});

await check('trending', async () => {
  const t = await client.trending({ limit: 5 });
  if (!Array.isArray(t) || t.length === 0) throw new Error('no games');
  for (let i = 1; i < t.length; i++) {
    if (t[i].playing > t[i - 1].playing) throw new Error('not sorted by players');
  }
  return `${t.length} games, top is ${t[0].name} with ${t[0].playing.toLocaleString('en-US')}`;
});

await check('getGroupGames reports no player count by default', async () => {
  const g = await client.getGroupGames(4372130);
  if (!Array.isArray(g)) throw new Error('expected an array');
  const first = g[0];
  if (!first) return 'group has no public games';
  if (first.playing !== null) throw new Error(`playing should be null, got ${first.playing}`);
  return `${g.length} games, playing is null (not 0)`;
});

await check('getGroupGames with includeStats', async () => {
  const g = await client.getGroupGames(4372130, { includeStats: true });
  const first = g[0];
  if (!first) return 'group has no public games';
  if (typeof first.playing !== 'number') throw new Error(`playing should be a number, got ${first.playing}`);
  return `playing = ${first.playing.toLocaleString('en-US')}`;
});

await check('getUserGames', async () => {
  const g = await client.getUserGames(1, { limit: 10 });
  return `${g.length} games`;
});

await check('fields catalogue', async () => {
  const f = await client.fields();
  const names = f.fields.map((x) => x.name);
  for (const needed of ['name', 'playing', 'likes', 'favorites', 'thumbnail']) {
    if (!names.includes(needed)) throw new Error(`missing ${needed}`);
  }
  return `${f.fields.length} fields`;
});

await check('render fills placeholders', async () => {
  const r = await client.render(994732206, '<b>{{playing}}</b> in <i>{{name}}</i> by {{creator}}');
  if (/\{\{/.test(r.html)) throw new Error(`placeholders left: ${r.html}`);
  if (!r.html.includes('Blox Fruits')) throw new Error('name not substituted');
  return r.html;
});

await check('renderMulti addresses games by id', async () => {
  const r = await client.renderMulti('{{994732206:playing}} vs {{1686885941:playing:short}}', [
    994732206,
    1686885941,
  ]);
  if (/\{\{/.test(r.html)) throw new Error(`placeholders left: ${r.html}`);
  return r.html;
});

await check('render rejects a typo', async () => {
  try {
    await client.render(994732206, '{{playng}}');
    throw new Error('should have thrown');
  } catch (err) {
    if (err.code !== 'UNKNOWN_FIELDS') throw new Error(`unexpected code: ${err.code}`);
    return err.message;
  }
});

// A timeout can only be tested against a request that genuinely hangs. Setting
// timeoutMs to 1 against a cached endpoint is a race: on a fast machine the
// answer arrives first and there is nothing to time out, which is how this test
// used to fail at random.
const silent = createServer((_req, _res) => {
  /* accept the connection, never answer it */
});
await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
const deadPort = silent.address().port;

await check('timeout is reported correctly', async () => {
  const slow = createClient({ baseUrl: `http://127.0.0.1:${deadPort}`, timeoutMs: 250 });
  const started = Date.now();
  try {
    await slow.getGame(15339);
    throw new Error('should have timed out');
  } catch (err) {
    if (err.code !== 'TIMEOUT') throw new Error(`unexpected code: ${err.code}`);
    if (Date.now() - started > 5000) throw new Error('the timeout never fired');
    return `TIMEOUT after ${Date.now() - started}ms`;
  }
});
await new Promise((resolve) => silent.close(resolve));

// A stub that reports back exactly which headers arrived, so the key path can be
// checked without a server in API_KEY_MODE=required. Pointed at the real server
// the SDK could only prove that a request succeeded, which is also true with no
// key at all, so it would pass whether the feature worked or not.
const echo = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, data: { key: req.headers['x-api-key'] ?? null } }));
});
await new Promise((resolve) => echo.listen(0, '127.0.0.1', resolve));
const echoPort = echo.address().port;
const echoBase = `http://127.0.0.1:${echoPort}`;

await check('apiKey option becomes an X-API-Key header', async () => {
  const withKey = createClient({ baseUrl: echoBase, apiKey: 'Made by MoonlightStudios' });
  const r = await withKey.getGame(1);
  if (r.key !== 'Made by MoonlightStudios') {
    throw new Error(`header was ${JSON.stringify(r.key)}`);
  }
  return 'sent';
});

await check('ROBLOX_API_KEY is read from the environment', async () => {
  process.env.ROBLOX_API_KEY = 'from-env-key';
  try {
    const fromEnv = createClient({ baseUrl: echoBase });
    const r = await fromEnv.getGame(1);
    if (r.key !== 'from-env-key') throw new Error(`header was ${JSON.stringify(r.key)}`);
    // An explicit option must win over the environment, or a shared process
    // cannot use two deployments at once.
    const overridden = createClient({ baseUrl: echoBase, apiKey: 'explicit' });
    const r2 = await overridden.getGame(1);
    if (r2.key !== 'explicit') throw new Error(`header was ${JSON.stringify(r2.key)}`);
    return 'env, and the option overrides it';
  } finally {
    delete process.env.ROBLOX_API_KEY;
  }
});

await check('no key means no header at all', async () => {
  const anon = createClient({ baseUrl: echoBase });
  const r = await anon.getGame(1);
  if (r.key !== null) throw new Error(`header was ${JSON.stringify(r.key)}`);
  return 'not sent';
});

await new Promise((resolve) => echo.close(resolve));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
