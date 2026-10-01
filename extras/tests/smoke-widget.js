/**
 * The widget's network behaviour, against a stub that fails in each of the ways
 * the real world does.
 *
 * The important one is the last: a card that was showing real numbers, and a
 * refresh that fails. The old behaviour replaced the card with "Could not load
 * this game", which took real numbers away from somebody reading them because of
 * a lost packet.
 *
 *   node extras/tests/smoke-widget.js
 */
import { readFileSync } from 'node:fs';
import { requirePatchright } from './patchright.mjs';

const { chromium } = requirePatchright();

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const widget = readFileSync('roblox-stats.js', 'utf8');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});

async function scenario(name, handler, { refresh = null, extraHtml = '', settle = 4500 } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('**/api/v1/**', handler);
  await page.route('**/roblox-stats.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: widget })
  );
  await page.setContent(
    `<!doctype html><html><body>
      <div data-roblox-game="994732206"${refresh ? ` data-roblox-refresh="${refresh}"` : ''}></div>
      ${extraHtml}
      <script>window.ROBLOX_API_BASE = "${BASE}";</script>
      <script src="${BASE}/roblox-stats.js"></script>
    </body></html>`,
    { waitUntil: 'load' }
  );
  await page.waitForTimeout(settle);
  const state = await page.evaluate(() => {
    const host = document.querySelector('[data-roblox-game]');
    const card = host.querySelector('.rbxw-card');
    const foot = host.querySelector('[class*="foot"]');
    const stamp = foot ? foot.firstElementChild : null;
    return {
      hasCard: !!card,
      text: host.textContent.replace(/\s+/g, ' ').trim().slice(0, 70),
      hasError: /Could not load/.test(host.textContent),
      hasCredit: !!document.getElementById('rbxw-credit'),
      stampText: stamp ? stamp.textContent.trim() : null,
      stampStale: stamp ? stamp.getAttribute('data-stale') : null,
      creditExists: !!document.getElementById('rbxw-credit'),
    };
  });
  await ctx.close();
  return { name, state };
}

const okJson = {
  ok: true,
  data: {
    id: 994732206,
    name: 'Blox Fruits',
    creator: 'Gamer Robot Inc',
    playing: 1234567,
    upVotes: 25000000,
    visits: 60000000000,
  },
};
const fulfil = (body) => (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

console.log('widget: network behaviour');

// 1. A refused request is retried, and Retry-After is respected.
{
  let calls = 0;
  const r = await scenario('429 once', (route) => {
    calls++;
    if (calls === 1) {
      return route.fulfill({ status: 429, headers: { 'retry-after': '1' }, contentType: 'application/json', body: '{}' });
    }
    return fulfil(okJson)(route);
  });
  check('a 429 does not become an error card', !r.state.hasError && r.state.hasCard, r.state.text);
  check('and it took more than one attempt', calls >= 2, `calls=${calls}`);
  check('the card really shows the data', /Blox Fruits/.test(r.state.text), r.state.text);
  check('the credit badge is present', r.state.hasCredit, 'the badge is appended to the document, not the host');
}

// 2. A permanent refusal still ends in an honest error, with the credit kept.
{
  const r = await scenario('always 429', (route) =>
    route.fulfill({ status: 429, headers: { 'retry-after': '0' }, contentType: 'application/json', body: '{}' })
  );
  check('a permanent refusal shows an error, not a fake card', r.state.hasError, r.state.text);
  check('and the credit badge is still there', r.state.creditExists, 'a refusal must never take the credit away');
}

// 3. A server error is retried too.
{
  let calls = 0;
  const r = await scenario('500 once', (route) => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    return fulfil(okJson)(route);
  });
  check('a 503 is retried and recovers', calls >= 2 && !r.state.hasError, `calls=${calls} ${r.state.text}`);
}

// 4. A 404 is an answer, not a glitch: no retry storm, honest message.
{
  let calls = 0;
  const r = await scenario('404', (route) => {
    calls++;
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { message: 'No game with that id.' } }),
    });
  });
  check('a 404 is not retried', calls === 1, `calls=${calls} — a 404 will be a 404 in a second too`);
  check('and the message comes from the API', /No game with that id/.test(r.state.text), r.state.text);
}

// 5. A hanging request must not leave a skeleton forever.
{
  // Three attempts of 8s each, with backoff: the honest answer takes longer
  // than any other scenario, and waiting less would test the skeleton rather
  // than the timeout.
  const r = await scenario('hangs', (route) => new Promise(() => {}), { settle: 32000 });
  check(
    'a request that never answers ends as an error, not a skeleton',
    r.state.hasError || r.state.hasCard,
    'a silent skeleton is the failure this is checking for'
  );
  check('and the message says it was a timeout', /did not answer in time|timed out|too long/i.test(r.state.text), r.state.text);
}

console.log('\nwidget: a failed refresh keeps what is on screen');
{
  // Load successfully, then start failing, and let the refresh run.
  let calls = 0;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('**/api/v1/**', (route) => {
    calls++;
    if (calls === 1) return fulfil(okJson)(route);
    return route.abort('connectionfailed');
  });
  await page.route('**/roblox-stats.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: widget })
  );
  await page.setContent(
    `<!doctype html><html><body>
      <div data-roblox-game="994732206" data-roblox-refresh="2"></div>
      <script>window.ROBLOX_API_BASE = "${BASE}";</script>
      <script src="${BASE}/roblox-stats.js"></script>
    </body></html>`,
    { waitUntil: 'load' }
  );
  await page.waitForTimeout(2500);
  const before = await page.evaluate(() => {
    const h = document.querySelector('[data-roblox-game]');
    return { card: !!h.querySelector('.rbxw-card'), text: h.textContent.replace(/\s+/g, ' ').trim().slice(0, 50) };
  });
  check('the first load painted a card', before.card, before.text);

  // Let a couple of refreshes fail.
  await page.waitForTimeout(14000);
  const after = await page.evaluate(() => {
    const h = document.querySelector('[data-roblox-game]');
    const foot = h.querySelector('[class*="foot"]');
    const stamp = foot ? foot.firstElementChild : null;
    return {
      card: !!h.querySelector('.rbxw-card'),
      error: /Could not load/.test(h.textContent),
      hasData: /Blox Fruits/.test(h.textContent),
      stampText: stamp ? stamp.textContent.trim() : null,
      stampStale: stamp ? stamp.getAttribute('data-stale') : null,
    };
  });
  check('the card survived a failing refresh', after.card, 'it was replaced by an error');
  check('and it was not turned into an error', !after.error, 'a lost packet erased real numbers');
  check('the numbers are still on screen', after.hasData);
  check('the timestamp says the update failed', after.stampText === 'Last update failed', String(after.stampText));
  check('and is marked so it can be styled', after.stampStale === 'true', String(after.stampStale));
  check('and the badge survived too', await page.evaluate(() => !!document.getElementById('rbxw-credit')));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
