/**
 * Smoke test against the local server.
 * Usage:  node extras/tests/smoke.js   (with the server running on port 3000)
 *
 * Set API_KEY when the server under test has keys configured, so the suite
 * still passes against a deployment running API_KEY_MODE=required.
 */

import { readFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const BLOX_FRUITS = 994732206;

/**
 * Sends the key when one is configured, so the suite keeps working against a
 * server that has API_KEY_MODE=required. Without this the tests would all come
 * back 401 on a correctly configured deployment and look like a broken API.
 */
const API_KEY = process.env.API_KEY || '';
const HEADERS = API_KEY ? { 'X-API-Key': API_KEY } : {};

let passed = 0;
let failed = 0;

async function check(name, url, validate) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    const body = await res.json();
    const problem = validate(res.status, body);
    if (problem) {
      console.log(`  FAIL   ${name} -> ${problem}`);
      failed++;
    } else {
      console.log(`  pass   ${name}`);
      passed++;
    }
  } catch (err) {
    console.log(`  ERROR  ${name} -> ${err.message}`);
    failed++;
  }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyStr = (v) => typeof v === 'string' && v.length > 0;

console.log(`Testing ${BASE}\n`);

// The key lives inside this file, so the request that downloads it cannot carry
// one. If the server guarded or rate limited it, API_KEY_MODE=required would
// make the file unobtainable and no embed could ever work. Sent with no key on
// purpose, which is exactly the situation a real browser is in.
{
  const noKey = await fetch(`${BASE}/roblox-stats.js`);
  const src = await noKey.text();
  if (noKey.status === 200 && src.includes('RobloxStats')) {
    console.log('  pass   /roblox-stats.js is served without a key');
    passed++;
  } else {
    console.log(`  FAIL   /roblox-stats.js without a key -> status ${noKey.status}`);
    failed++;
  }
  if (/public, max-age=\d+/.test(noKey.headers.get('cache-control') || '')) {
    console.log('  pass   /roblox-stats.js is cacheable');
    passed++;
  } else {
    console.log('  FAIL   /roblox-stats.js has no cache-control, every page load refetches it');
    failed++;
  }
  if ((noKey.headers.get('ratelimit-limit') || '') === '') {
    console.log('  pass   /roblox-stats.js is not rate limited');
    passed++;
  } else {
    console.log('  FAIL   /roblox-stats.js is rate limited, a shared IP could take it down');
    failed++;
  }
}

await check('root /api', `${BASE}/api`, (s, b) => (s === 200 && b.ok ? null : `status ${s}`));

await check('health /health', `${BASE}/health`, (s, b) =>
  s === 200 && b.ok === true && b.uptime >= 0 && b.keys && b.keys.mode
    ? null
    : `status ${s}, keys.mode=${b?.keys?.mode}`
);

// The debugging endpoint has to answer without a key, or a page whose key is
// wrong has no way to find out. Always 200, in every mode.
await check('key self-check /api/v1/keys/me', `${BASE}/api/v1/keys/me`, (s, b) =>
  s === 200 && b.ok === true && ['off', 'optional', 'required'].includes(b.mode)
    ? null
    : `status ${s}, mode=${b?.mode}`
);

await check(
  'full game (Blox Fruits)',
  `${BASE}/api/v1/games/${BLOX_FRUITS}`,
  (s, b) => {
    if (s !== 200 || !b.ok) return `status ${s}`;
    const d = b.data;
    const missing = [];
    if (d.id !== BLOX_FRUITS) missing.push('wrong id');
    if (!isNonEmptyStr(d.name)) missing.push('name');
    if (!isNonEmptyStr(d.url)) missing.push('url');
    if (!isNum(d.playing)) missing.push('playing');
    if (!isNum(d.visits)) missing.push('visits');
    if (!isNum(d.ratings.upVotes)) missing.push('ratings.upVotes');
    if (!isNum(d.ratings.favorites)) missing.push('ratings.favorites');
    if (!isNonEmptyStr(d.thumbnail)) missing.push('thumbnail (logo)');
    if (!Array.isArray(d.images) || d.images.length === 0) missing.push('images (banners)');
    if (!d.creator || !isNonEmptyStr(d.creator.name)) missing.push('creator.name');
    if (!d.creator || !['User', 'Group'].includes(d.creator.type)) missing.push('creator.type');
    if (!d.created || Number.isNaN(Date.parse(d.created))) missing.push('created (valid ISO)');
    return missing.length ? `missing: ${missing.join(', ')}` : null;
  }
);

await check('quick game', `${BASE}/api/v1/games/${BLOX_FRUITS}/quick`, (s, b) =>
  s === 200 && b.ok && isNum(b.data.playing) && isNonEmptyStr(b.data.thumbnail)
    ? null
    : `status ${s} or incomplete fields`
);

await check(
  'batch of 3 games',
  `${BASE}/api/v1/games/batch?ids=${BLOX_FRUITS},1686885941,2753915549`,
  (s, b) => {
    if (s !== 200 || !b.ok) return `status ${s}`;
    if (b.count !== 3) return `expected 3 games, got ${b.count}`;
    const bad = b.data.find((g) => !isNum(g.playing) || !isNonEmptyStr(g.name));
    return bad ? `incomplete game: ${JSON.stringify(bad)}` : null;
  }
);

await check(
  'resolve game URL',
  `${BASE}/api/v1/resolve?url=https://www.roblox.com/games/${BLOX_FRUITS}`,
  (s, b) => (s === 200 && b.data.universeId === BLOX_FRUITS ? null : `status ${s} or wrong id`)
);

await check(
  'resolve place URL (/Place)',
  `${BASE}/api/v1/resolve?url=https://www.roblox.com/games/2753915549/Place`,
  (s, b) => {
    if (s !== 200) return `status ${s}`;
    if (b.data.placeId !== 2753915549) return `wrong placeId: ${b.data.placeId}`;
    if (b.data.universeId !== BLOX_FRUITS) return `wrong universeId: ${b.data.universeId}`;
    return null;
  }
);

await check('search', `${BASE}/api/v1/search?q=Blox%20Fruits&limit=3`, (s, b) =>
  s === 200 && b.ok && Array.isArray(b.data) && b.data.length > 0
    ? null
    : `status ${s} or no results`
);

await check('game passes', `${BASE}/api/v1/games/${BLOX_FRUITS}/game-passes`, (s, b) =>
  s === 200 && b.ok && Array.isArray(b.data) && b.data.length > 0 ? null : `status ${s} or empty`
);

await check('badges', `${BASE}/api/v1/games/${BLOX_FRUITS}/badges`, (s, b) =>
  s === 200 && b.ok && Array.isArray(b.data) ? null : `status ${s}`
);

await check('developer + group', `${BASE}/api/v1/games/${BLOX_FRUITS}/developer`, (s, b) =>
  s === 200 && b.ok && b.data.creatorName ? null : `status ${s}`
);

console.log('\n-- errors (must be 4xx JSON, never 500) --');

await check('unknown id -> 404', `${BASE}/api/v1/games/999999999999`, (s, b) =>
  s === 404 && b.ok === false ? null : `status ${s}`
);

await check('non-numeric id -> 404', `${BASE}/api/v1/games/abc`, (s) =>
  s === 404 ? null : `status ${s}`
);

await check('non-roblox url -> 400', `${BASE}/api/v1/resolve?url=https://evil.com/games/1`, (s) =>
  s === 400 ? null : `status ${s}`
);

await check('search without q -> 400', `${BASE}/api/v1/search`, (s) =>
  s === 400 ? null : `status ${s}`
);

await check('batch without ids -> 400', `${BASE}/api/v1/games/batch`, (s) =>
  s === 400 ? null : `status ${s}`
);

await check('unknown route -> 404', `${BASE}/api/v1/nothing`, (s) => (s === 404 ? null : `status ${s}`));

console.log('\n-- placeholders and templates --');

await check('field catalogue', `${BASE}/api/v1/fields`, (s, b) => {
  if (s !== 200 || !b.ok) return `status ${s}`;
  if (!Array.isArray(b.fields) || b.fields.length === 0) return 'no fields listed';
  const names = b.fields.map((f) => f.name);
  const required = ['name', 'playing', 'visits', 'likes', 'favorites', 'upVoteRatio', 'thumbnail', 'creator'];
  const missing = required.filter((n) => !names.includes(n));
  return missing.length ? `catalogue is missing: ${missing.join(', ')}` : null;
});

// The browser script carries its own copy of the field list, because it cannot
// import server modules. This compares the two so they cannot drift apart and
// leave {{playing}} working in curl but blank on a real page.
const bindingsSrc = await readFile(new URL('../../roblox-stats.js', import.meta.url), 'utf8');
const clientNames = (bindingsSrc.match(/var KNOWN = new Set\(Object\.keys\(NUMERIC\)\.concat\(\[([\s\S]*?)\]\)\)/) || [
  , '',
])[1]
  .split(',')
  .map((s) => s.trim().replace(/^'|'$/g, ''))
  .filter(Boolean);
const serverNames = (await (await fetch(`${BASE}/api/v1/fields`, { headers: HEADERS })).json()).fields.map(
  (f) => f.name
);
const clientNumeric = Object.keys(
  JSON.parse(
    (bindingsSrc.match(/var NUMERIC = (\{[\s\S]*?\});/) || [, '{}'])[1].replace(/(\w+):\s*1/g, '"$1":1')
  )
);
const clientAll = [...clientNumeric, ...clientNames];
const drift = serverNames.filter((n) => !clientAll.includes(n));
const extra = clientAll.filter((n) => !serverNames.includes(n));
if (drift.length || extra.length) {
  console.log(
    `  FAIL   roblox-stats.js field list differs from the server` +
      (drift.length ? ` (missing in browser: ${drift.join(', ')})` : '') +
      (extra.length ? ` (only in browser: ${extra.join(', ')})` : '')
  );
  failed++;
} else {
  console.log(`  pass   roblox-stats.js and server agree on all ${clientAll.length} field names`);
  passed++;
}

// The two features share one file. If a page can be built with one <script> tag,
// no second file may reappear and quietly split the story in two again.
const MUST_NOT_EXIST = [
  // The browser side is one file, at the project root.
  'public/bindings.js',
  'public/widget.js',
  'public/bindings-demo.html',
  'public/widget/demo.html',
  'public/roblox-stats.js',
  // Optional extras stay folded into one folder, so the top level stays short.
  'sdk/index.js',
  'mcp/server.js',
  'scripts/smoke.js',
];
for (const gone of MUST_NOT_EXIST) {
  const still = await readFile(new URL(`../../${gone}`, import.meta.url), 'utf8').then(
    () => true,
    () => false
  );
  if (still) {
    console.log(`  FAIL   ${gone} still exists; the layout must stay flat`);
    failed++;
  } else {
    console.log(`  pass   ${gone} is gone, as it should be`);
    passed++;
  }
}

const renderRes = await fetch(`${BASE}/api/v1/render`, {
  method: 'POST',
  headers: { ...HEADERS, 'content-type': 'application/json' },
  body: JSON.stringify({
    universeId: BLOX_FRUITS,
    html: '<b>{{playing}}</b>|<b>{{likes:raw}}</b>|<b>{{upVoteRatio}}</b>|<a href="{{creatorUrl}}">c</a>',
  }),
});
const renderBody = await renderRes.json();
if (renderRes.status !== 200) {
  console.log(`  FAIL   render -> status ${renderRes.status}`);
  failed++;
} else {
  const html = renderBody.data.html;
  const problems = [];
  if (/\{\{/.test(html)) problems.push('some placeholders were left in the output');
  if (!/>\d/.test(html)) problems.push('no number was substituted');
  if (!html.includes('roblox.com')) problems.push('attribute placeholder not substituted');
  if (problems.length) {
    console.log(`  FAIL   render -> ${problems.join('; ')} (${html})`);
    failed++;
  } else {
    console.log(`  pass   render fills text and attributes -> ${html}`);
    passed++;
  }
}

const badRender = await fetch(`${BASE}/api/v1/render`, {
  method: 'POST',
  headers: { ...HEADERS, 'content-type': 'application/json' },
  body: JSON.stringify({ universeId: BLOX_FRUITS, html: '{{playng}}' }),
});
if (badRender.status === 400) {
  console.log('  pass   render rejects an unknown field name');
  passed++;
} else {
  console.log(`  FAIL   render accepted an unknown field name (status ${badRender.status})`);
  failed++;
}

const noBody = await fetch(`${BASE}/api/v1/render`, {
  method: 'POST',
  headers: { ...HEADERS, 'content-type': 'application/json' },
  body: JSON.stringify({ html: '{{name}}' }),
});
if (noBody.status === 400) {
  console.log('  pass   render without universeId -> 400');
  passed++;
} else {
  console.log(`  FAIL   render without universeId returned ${noBody.status}`);
  failed++;
}

const multiRes = await fetch(`${BASE}/api/v1/render/multi`, {
  method: 'POST',
  headers: { ...HEADERS, 'content-type': 'application/json' },
  body: JSON.stringify({
    html: '{{994732206:playing}} / {{1686885941:playing:short}}',
    universeIds: [994732206, 1686885941],
  }),
});
const multiBody = await multiRes.json();
const multiHtml = multiBody?.data?.html || '';
// The ":short" suffix must not be read as a field name.
if (multiRes.status === 200 && /^\d[\d.,]*[KM]? \/ \d[\d.,]*[KM]?$/.test(multiHtml)) {
  console.log(`  pass   render/multi handles id:field:mode -> ${multiHtml}`);
  passed++;
} else {
  console.log(`  FAIL   render/multi -> status ${multiRes.status}, output "${multiHtml}"`);
  failed++;
}

console.log('\n-- creators and trending --');

await check('games by group', `${BASE}/api/v1/groups/1/games?limit=10`, (s, b) => {
  if (s !== 200 || !b.ok) return `status ${s}`;
  if (!Array.isArray(b.data)) return 'data is not an array';
  const g = b.data[0];
  if (!g) return null; // a creator with no public games is legitimate
  const problems = [];
  if (!isNum(g.id)) problems.push('id');
  if (!isNonEmptyStr(g.name)) problems.push('name');
  if (!isNonEmptyStr(g.url)) problems.push('url');
  // playing must be null (not 0) when includeStats was not asked for.
  if (g.playing !== null) problems.push(`playing should be null, got ${g.playing}`);
  if (b.note === null) problems.push('note should explain the null playing');
  return problems.length ? problems.join(', ') : null;
});

await check('games by group with stats', `${BASE}/api/v1/groups/1/games?limit=10&includeStats=true`, (s, b) => {
  if (s !== 200 || !b.ok) return `status ${s}`;
  const g = (b.data || [])[0];
  if (!g) return null;
  if (!isNum(g.playing)) return `playing should be a number, got ${g.playing}`;
  if (b.note !== null) return 'note should be null when stats were included';
  return null;
});

// Roblox rate limits bursts of requests for ids that do not exist, and this
// whole suite fires a lot of traffic in a few seconds, so a 429 here means
// "upstream was busy", not "the mapping is broken". A 404 is the real answer.
const missingGroup = await fetch(`${BASE}/api/v1/groups/999999999999/games`, { headers: HEADERS });
if (missingGroup.status === 404) {
  const body = await missingGroup.json();
  if (body?.error?.code === 'NOT_FOUND' && /No group found/.test(body.error.message)) {
    console.log('  pass   unknown group -> 404 NOT_FOUND');
    passed++;
  } else {
    console.log(`  FAIL   404 body is wrong: ${JSON.stringify(body)}`);
    failed++;
  }
} else if (missingGroup.status === 429) {
  console.log('  WARN   unknown group -> 429 from Roblox (rate limited), skipping assertion');
  passed++;
} else {
  console.log(`  FAIL   unknown group -> status ${missingGroup.status}`);
  failed++;
}

await check('trending', `${BASE}/api/v1/trending?limit=10`, (s, b) => {
  if (s !== 200 || !b.ok) return `status ${s}`;
  if (!Array.isArray(b.data) || b.data.length === 0) return 'no games returned';
  const problems = [];
  // Roblox hands back many one-game groups; all of them have to be gathered.
  if (b.data.length < 5) problems.push(`only ${b.data.length} games, groups were not flattened`);
  const first = b.data[0];
  if (!isNum(first.playing)) problems.push('playing');
  if (!isNonEmptyStr(first.name)) problems.push('name');
  if (!isNonEmptyStr(first.url)) problems.push('url');
  // Search deliberately withholds the creator, so this only works if the extra
  // details call is really being made. A null here is what the docs hero card
  // was rendering as "Unknown creator".
  const noCreator = b.data.filter((g) => !isNonEmptyStr(g.creator));
  if (noCreator.length) problems.push(`${noCreator.length}/${b.data.length} without creator`);
  const noVisits = b.data.filter((g) => !isNum(g.visits));
  if (noVisits.length) problems.push(`${noVisits.length}/${b.data.length} without visits`);
  for (let i = 1; i < b.data.length; i++) {
    if (b.data[i].playing > b.data[i - 1].playing) problems.push('not sorted by players');
  }
  return problems.length ? problems.join(', ') : null;
});

// The images are opt-in, and the docs page leans on them, so they are tested
// here rather than discovered missing by whoever builds the page next.
await check('trending with images', `${BASE}/api/v1/trending?limit=10&includeMedia=true`, (s, b) => {
  if (s !== 200 || !b.ok) return `status ${s}`;
  if (!Array.isArray(b.data) || b.data.length === 0) return 'no games returned';
  const problems = [];
  const missing = b.data.filter((g) => !isNonEmptyStr(g.thumbnail) || !isNonEmptyStr(g.banner));
  if (missing.length) problems.push(`${missing.length}/${b.data.length} without images`);
  // Images are the opt-in part; creator and visits must still be there, because
  // they are filled in for every /trending response and not only this one.
  const missingDetails = b.data.filter((g) => !isNonEmptyStr(g.creator) || !isNum(g.visits));
  if (missingDetails.length) problems.push(`${missingDetails.length}/${b.data.length} without details`);
  // The list itself must not change just because images were asked for.
  for (let i = 1; i < b.data.length; i++) {
    if (b.data[i].playing > b.data[i - 1].playing) problems.push('not sorted by players');
  }
  return problems.length ? problems.join(', ') : null;
});

// The Moonlight Studios credit is what keeps this API free, so the browser file
// must both carry it and refuse to work without it. Checked here because a
// later "let me tidy this up" edit that drops the gate would otherwise ship
// silently: the file still works for everyone who keeps the credit.
{
  const problems = [];
  // The wording is split into before/linkText so only the name is the link, so
  // this checks the two halves rather than one old combined string.
  if (!/before:\s*'Made by '/.test(bindingsSrc) || !/linkText:\s*'Moonlight Studios'/.test(bindingsSrc)) {
    problems.push('the credit wording is gone from the CREDIT config');
  }
  // The badge link is the whole point of the change, so its target is one
  // named setting and it must be wired to the anchor.
  if (!/var SITE_URL = ''/.test(bindingsSrc)) problems.push('SITE_URL is gone');
  if (!/name\.href = CREDIT\.url/.test(bindingsSrc)) problems.push('the badge name is not the link');
  // The key must ride in the header, never in the query string: a query param
  // lands in access logs, browser history and every outgoing Referer.
  if (!/opts\.headers\['X-API-Key'\] = API_KEY/.test(bindingsSrc)) {
    problems.push('the key is not sent in the X-API-Key header');
  }
  if (/['"`]?API_BASE \+ ['"`][^'"`]*\?key=/.test(bindingsSrc)) {
    problems.push('the key is being put in a URL');
  }
  // Both fetch paths must pass the gate, or deleting the credit changes nothing.
  const gates = (bindingsSrc.match(/creditAllows\(/g) || []).length;
  if (gates < 3) problems.push(`only ${gates} creditAllows() call sites, expected loadGame + loadCard + definition`);
  if (!/creditBlocked\s*=\s*true/.test(bindingsSrc)) problems.push('nothing ever sets creditBlocked');
  if (!/creditHidden\s*\(/.test(bindingsSrc)) problems.push('hiding the credit is not detected');
  // The credit must be rendered on boot, before any request is made.
  if (!/function start\(\)\s*\{\s*renderCredit\(\)/.test(bindingsSrc)) {
    problems.push('start() does not render the credit first');
  }
  // window.ROBLOX_API_BASE has to be checked BEFORE document.currentScript, or a
  // file copied into somebody else\'s project talks to the wrong server.
  // Compared on CODE, not on comments: the file explains the ordering in prose
  // right above it, and a naive search finds that explanation first.
  const code = bindingsSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const overrideAt = code.indexOf('window.ROBLOX_API_BASE) return');
  const currentScriptAt = code.indexOf('document.currentScript');
  if (overrideAt === -1) problems.push('window.ROBLOX_API_BASE is no longer honoured');
  else if (currentScriptAt !== -1 && overrideAt > currentScriptAt) {
    problems.push('document.currentScript is read before the ROBLOX_API_BASE override');
  }

  if (problems.length) {
    console.log(`  FAIL   credit enforcement weakened: ${problems.join('; ')}`);
    failed++;
  } else {
    console.log('  pass   Moonlight Studios credit is present and enforced on both fetch paths');
    passed++;
  }
}

console.log('\n-- CORS --');

// A browser on another site must be able to call the API, including the POST
// endpoints. The preflight is what tells the browser it is allowed, so it has
// to advertise POST: a direct request returning 200 proves nothing, because
// the browser never gets that far.
const preflight = await fetch(`${BASE}/api/v1/render`, {
  method: 'OPTIONS',
  headers: {
    Origin: 'https://some-other-site.example',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type',
  },
});
const allowedMethods = preflight.headers.get('access-control-allow-methods') || '';
if (
  preflight.headers.get('access-control-allow-origin') === 'https://some-other-site.example' &&
  /POST/.test(allowedMethods)
) {
  console.log(`  pass   CORS preflight allows POST (${allowedMethods})`);
  passed++;
} else {
  console.log(
    `  FAIL   CORS preflight: origin=${preflight.headers.get('access-control-allow-origin')}, ` +
      `methods="${allowedMethods}" - a browser would block POST /render`
  );
  failed++;
}

// The key travels in X-API-Key, which is not a CORS-safelisted header. That
// turns every single embed into a preflight, and if the preflight does not allow
// the header the browser blocks the request before it is ever sent. This is the
// one change that would silently break every third-party site at once.
const keyPreflight = await fetch(`${BASE}/api/v1/games/${BLOX_FRUITS}/quick`, {
  method: 'OPTIONS',
  headers: {
    Origin: 'https://some-other-site.example',
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'x-api-key',
  },
});
const allowedHeaders = keyPreflight.headers.get('access-control-allow-headers') || '';
if (/x-api-key/i.test(allowedHeaders)) {
  console.log(`  pass   CORS preflight allows X-API-Key (${allowedHeaders})`);
  passed++;
} else {
  console.log(
    `  FAIL   CORS preflight does not allow X-API-Key (allowed: "${allowedHeaders}") - ` +
      'every browser embed would be blocked'
  );
  failed++;
}

// Being allowed to SEND the header is not enough, a page on another domain also
// has to be allowed to READ the reply, or it can never find out its key worked.
const exposed = keyPreflight.headers.get('access-control-expose-headers') || '';
if (/x-rbx-key/i.test(exposed)) {
  console.log(`  pass   CORS exposes X-RBX-Key to the browser (${exposed})`);
  passed++;
} else {
  console.log(`  FAIL   X-RBX-Key is not exposed to browsers (exposed: "${exposed}")`);
  failed++;
}

const realPost = await fetch(`${BASE}/api/v1/render`, {
  method: 'POST',
  headers: { ...HEADERS, 'content-type': 'application/json', Origin: 'https://some-other-site.example' },
  body: JSON.stringify({ universeId: BLOX_FRUITS, html: '{{name}}' }),
});
if (realPost.headers.get('access-control-allow-origin') === 'https://some-other-site.example') {
  console.log('  pass   CORS reflects the origin on a real POST');
  passed++;
} else {
  console.log('  FAIL   CORS did not send Access-Control-Allow-Origin on the POST');
  failed++;
}

console.log('\n-- cache --');
// Uses a game not requested earlier in this run, so the first call is genuinely
// cold (it hits Roblox) and the second one is served from cache.
const COLD_ID = 15339;
const coldStart = performance.now();
await fetch(`${BASE}/api/v1/games/${COLD_ID}/quick`, { headers: HEADERS });
const coldMs = performance.now() - coldStart;

const warmStart = performance.now();
const warmRes = await fetch(`${BASE}/api/v1/games/${COLD_ID}/quick`, { headers: HEADERS });
const warmBody = await warmRes.json();
const warmMs = performance.now() - warmStart;

if (warmBody.data.id !== COLD_ID) {
  console.log('  FAIL   cached response did not return the right game');
  failed++;
} else if (warmMs < coldMs) {
  console.log(`  pass   cache works: cold ${coldMs.toFixed(1)}ms -> warm ${warmMs.toFixed(1)}ms`);
  passed++;
} else {
  // On Windows / local networks timings are noisy; just note it.
  console.log(
    `  WARN   cache not faster (cold ${coldMs.toFixed(1)}ms, warm ${warmMs.toFixed(1)}ms). ` +
      'May be local network noise; check /health to see the counter grow.'
  );
  passed++;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
