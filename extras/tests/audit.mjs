/**
 * A site audit that looks for the classes of defect that survive a design pass:
 * console noise, layout that overflows at three widths, images with no alt
 * text, clipped text, duplicate ids, heading gaps, tap targets a finger cannot
 * hit, and links that go nowhere.
 *
 * Reads a crawler of every internal link first, so a page nobody links to is
 * still checked.
 *
 *   node extras/tests/audit.mjs [baseUrl]
 */
import { requirePatchright } from './patchright.mjs';

const { chromium } = requirePatchright();

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const WIDTHS = [375, 768, 1280];
const THEMES = ['light', 'dark'];

const findings = [];
const add = (page, kind, detail) => findings.push({ page, kind, detail });

// ---------------------------------------------------------------- discover
// The bundled chromium channel, not the default download: the default
// headless shell is not installed here and the launch fails with a message
// about running "npx playwright install" rather than anything actionable.
const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const seed = await browser.newContext();
const seedPage = await seed.newPage();
await seedPage.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
const start = await seedPage.evaluate(() =>
  [...new Set([...document.querySelectorAll('a[href^="/"]')]
    .map((a) => a.getAttribute('href').split('#')[0].split('?')[0])
    .filter(Boolean))]
);
await seed.close();

const known = new Set();
const queue = ['/', ...start.filter((p) => p !== '/')];
while (queue.length && known.size < 40) {
  const p = queue.shift();
  if (known.has(p)) continue;
  known.add(p);
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  try {
    const res = await pg.goto(BASE + p, { waitUntil: 'load', timeout: 45000 });
    if (!res || res.status() >= 400) { add(p, 'status', String(res && res.status())); continue; }
    await pg.waitForTimeout(1200);
    const more = await pg.evaluate(() =>
      [...new Set([...document.querySelectorAll('a[href^="/"]')]
        .map((a) => a.getAttribute('href').split('#')[0].split('?')[0])
        .filter((h) => h && !/\.[a-z0-9]+$/i.test(h)))]
    );
    for (const m of more) if (!known.has(m)) queue.push(m);
  } catch (err) {
    add(p, 'load', err.message.slice(0, 80));
  }
  await ctx.close();
}

// 404 is reachable but not linked; include it so it gets checked.
if (!known.has('/404.html')) known.add('/404.html');

const PAGES = [...known].filter((p) => !/\.[a-z0-9]+$/i.test(p) || p.endsWith('.html')).sort();

// ---------------------------------------------------------------- check
for (const path of PAGES) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 130)); });
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 130)));

    await page.addInitScript((t) => { try { localStorage.setItem('rbx-theme', t); } catch {} }, theme);
    let res;
    try {
      res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 60000 });
    } catch (err) {
      add(path, 'load', err.message.slice(0, 80));
      await ctx.close();
      continue;
    }
    if (!res || res.status() >= 400) { add(path, 'status', String(res && res.status())); await ctx.close(); continue; }
    await page.waitForTimeout(2000);

    for (const err of errors) add(path, 'console', `${theme}: ${err}`);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      await page.waitForTimeout(450);
      const px = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (px > 0) {
        const who = await page.evaluate(() => {
          const d = document.documentElement;
          const bad = [];
          document.querySelectorAll('body *').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.right > d.clientWidth + 2 && r.width > 8) {
              bad.push((el.className || el.tagName.toLowerCase()).toString().slice(0, 36));
            }
          });
          return [...new Set(bad)].slice(0, 3);
        });
        add(path, `overflow@${width}`, `${px}px  ${who.join(' | ')}`);
      }
    }
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(250);

    const r = await page.evaluate(() => {
      const out = { noAlt: [], dupIds: [], headings: [], tiny: [], clipped: [], emptyLinks: [] };

      document.querySelectorAll('img').forEach((img) => {
        if (!img.hasAttribute('alt')) out.noAlt.push((img.src || '?').slice(-46));
      });

      const seen = new Set();
      document.querySelectorAll('[id]').forEach((el) => {
        if (seen.has(el.id)) out.dupIds.push(el.id);
        seen.add(el.id);
      });

      let prev = 0;
      document.querySelectorAll('h1,h2,h3,h4').forEach((h) => {
        const lvl = Number(h.tagName[1]);
        if (prev && lvl > prev + 1) {
          out.headings.push(`${h.tagName} after H${prev}: ${h.textContent.trim().slice(0, 30)}`);
        }
        prev = lvl;
      });

      document.querySelectorAll('a, button, [role="tab"], select').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return;
        if (el.closest('.skip, .brand, .crumbs, .footer-col, .toc, .mobilenav, .codeblock-label')) return;
        if (b.height < 24 || b.width < 16) {
          const label = (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 22);
          out.tiny.push(`${label} ${Math.round(b.width)}x${Math.round(b.height)}`);
        }
      });

      document.querySelectorAll('h1,h2,h3,p,li,dd,dt,span,b,a,button,code,label').forEach((el) => {
        if (el.children.length) return;
        const cs = getComputedStyle(el);
        if (cs.overflow === 'visible' || cs.overflowX === 'visible') return;
        if (cs.textOverflow === 'ellipsis') return;
        if (el.scrollWidth > el.clientWidth + 3 && el.clientWidth > 0) {
          out.clipped.push(`${el.className || el.tagName} "${el.textContent.trim().slice(0, 20)}"`);
        }
      });

      document.querySelectorAll('a[href]').forEach((a) => {
        const label = a.textContent.trim();
        if (!label && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])')) {
          out.emptyLinks.push(a.getAttribute('href').slice(0, 26));
        }
      });

      return out;
    });

    const uniq = (a) => [...new Set(a)];
    if (r.noAlt.length) add(path, 'img-no-alt', uniq(r.noAlt).slice(0, 3).join(' | '));
    if (r.dupIds.length) add(path, 'duplicate-id', uniq(r.dupIds).slice(0, 4).join(', '));
    if (r.headings.length) add(path, 'heading-gap', r.headings.slice(0, 2).join(' | '));
    if (r.tiny.length) add(path, 'tiny-target', uniq(r.tiny).slice(0, 5).join(' | '));
    if (r.clipped.length) add(path, 'clipped-text', uniq(r.clipped).slice(0, 4).join(' | '));
    if (r.emptyLinks.length) add(path, 'empty-link', uniq(r.emptyLinks).slice(0, 4).join(' | '));

    await ctx.close();
  }
}

await browser.close();

console.log(`\naudit: ${PAGES.length} pages, ${WIDTHS.join('/')}px, ${THEMES.join('+')}\n`);
if (!findings.length) {
  console.log('CLEAN — no findings');
  process.exit(0);
}
const byKind = new Map();
for (const f of findings) {
  if (!byKind.has(f.kind)) byKind.set(f.kind, []);
  byKind.get(f.kind).push(f);
}
console.log(`${findings.length} finding(s)\n`);
for (const [kind, list] of byKind) {
  console.log(`--- ${kind} (${list.length}) ---`);
  for (const f of list.slice(0, 14)) console.log(`  ${f.page}  ${f.detail}`);
  if (list.length > 14) console.log(`  ... +${list.length - 14}`);
  console.log('');
}
