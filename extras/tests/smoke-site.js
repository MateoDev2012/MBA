/**
 * Site chrome suite: the nav and the footer are copied into every page.
 * Usage:  node extras/tests/smoke-site.js      (needs a server on :3000)
 *
 * The duplication itself is deliberate. The pages are static files with no build
 * step, which is the whole point of a site that renders instantly and costs
 * nothing to host, so there is no template to render them from. The cost of that
 * choice is that eighteen copies of the nav can drift apart, and they did: the
 * Explorer link was added to the docs pages and quietly missed on six others.
 * Nobody noticed until someone scrolled a menu and found a page that did not
 * have it.
 *
 * So this suite reads the files rather than trusting them. It is the cheapest
 * possible guard against the one bug class that duplication invites, and it
 * needs no server and no browser.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', '..', 'public');

let pass = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'pass  ' : 'FAIL  '} ${name}${ok ? '' : '  <- ' + detail}`);
  ok ? pass++ : failed++;
};

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

const files = htmlFiles(publicDir).map((p) => ({
  path: path.relative(publicDir, p).replace(/\\/g, '/'),
  raw: readFileSync(p, 'utf8'),
}));

console.log('\n-- shared chrome --');

// Every page that is not the 404 needs the full nav; the 404 is a dead end and
// carries a reduced one on purpose.
const withNav = files.filter((f) => f.path !== '404.html');

/** The links in the desktop nav, in order. */
function navLinks(raw) {
  const nav = /<nav class="nav">([\s\S]*?)<\/nav>/.exec(raw);
  if (!nav) return null;
  return [...nav[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

const navSets = withNav.map((f) => ({ path: f.path, links: navLinks(f.raw) }));

check('every page has a desktop nav', navSets.every((n) => n.links), navSets.filter((n) => !n.links).map((n) => n.path).join(', '));

const reference = navSets.find((n) => n.links);
const sameNav = navSets.filter((n) => n.links && JSON.stringify(n.links) === JSON.stringify(reference.links));
check(
  'every page has the same nav links, in the same order',
  sameNav.length === navSets.length,
  navSets.filter((n) => n.links && !sameNav.includes(n)).map((n) => n.path).join(', ')
);

for (const want of ['/docs', '/explorer', '/demo', '/pricing', '/legal']) {
  const missing = navSets.filter((n) => n.links && !n.links.includes(want)).map((n) => n.path);
  check(`nav links to ${want}`, missing.length === 0, missing.join(', '));
}

/** The mobile sheet has to carry the same links, or the phone menu is a subset. */
const mobile = withNav.map((f) => ({
  path: f.path,
  links: navLinks(f.raw.replace(/<nav class="nav">[\s\S]*?<\/nav>/, '<nav class="nav"></nav>')),
}));
const missingMobile = withNav.filter((f, i) => {
  const m = /<nav class="mobilenav"[^>]*>([\s\S]*?)<\/nav>/.exec(f.raw);
  if (!m) return true;
  const links = [...m[1].matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
  return !['/docs', '/explorer', '/demo', '/pricing', '/legal'].every((w) => links.includes(w));
});
check('the mobile menu carries the same links', missingMobile.length === 0, missingMobile.map((f) => f.path).join(', '));

// Exactly one nav item may be marked active per page, and it has to be the page
// you are on. Two actives means someone pasted a header and forgot to edit it.
const twoActive = withNav.filter((f) => (f.raw.match(/<nav class="nav">[\s\S]*?<\/nav>/) || [''])[0].split('class="active"').length - 1 > 1);
check('at most one active nav item', twoActive.length === 0, twoActive.map((f) => f.path).join(', '));

console.log('\n-- footer --');

const footers = files.map((f) => {
  const m = /<footer class="site">([\s\S]*?)<\/footer>/.exec(f.raw);
  return { path: f.path, html: m ? m[1] : null };
});

check('every page has a footer', footers.every((f) => f.html), footers.filter((f) => !f.html).map((f) => f.path).join(', '));

// The credit badge is not decoration: roblox-stats.js stops fetching when the
// site hides it, and a footer that quietly lost it would be a broken promise.
const missingCredit = footers.filter((f) => f.html && !/Made by Moonlight Studios/.test(f.html)).map((f) => f.path);
check('the Moonlight Studios credit is in every footer', missingCredit.length === 0, missingCredit.join(', '));

const missingYear = footers.filter((f) => f.html && !/data-year/.test(f.html)).map((f) => f.path);
check('the footer year is filled in at runtime', missingYear.length === 0, missingYear.join(', '));

const footerRef = footers.find((f) => f.html);
const sameFooter = footers.filter((f) => f.html && f.html.replace(/\s+/g, ' ') === footerRef.html.replace(/\s+/g, ' '));
check('every footer is identical', sameFooter.length === footers.length, footers.filter((f) => !sameFooter.includes(f)).map((f) => f.path).join(', '));

console.log('\n-- one page, one owner --');

for (const f of files) {
  const h1 = (f.raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
  const count = (f.raw.match(/<h1[\s>]/g) || []).length;
  check(`${f.path} has exactly one h1`, count === 1, `found ${count}${h1 ? ` ("${h1.replace(/<[^>]+>/g, '').trim().slice(0, 40)}")` : ''}`);
}

console.log('\n-- nothing dead --');

// A page nothing links to is a page nobody can find. docs.html sat at
// /docs.html for the whole life of the project, unreachable and 47 KB, serving a
// second copy of every docs page at a second URL.
const linked = new Set();
for (const f of files) {
  for (const m of f.raw.matchAll(/href="(\/[^"#?]*)/g)) linked.add(m[1]);
}
for (const m of readFileSync(path.join(publicDir, '..', 'src', 'server.js'), 'utf8').matchAll(/'(\/[a-z0-9\/-]*)'/gi)) {
  linked.add(m[1]);
}
const orphans = files
  // 404.html is deliberately unlinked: the server's catch-all serves it for any
  // address that does not exist, which is the only way to reach it.
  .filter((f) => f.path !== '404.html')
  .map((f) => '/' + f.path.replace(/index\.html$/, '').replace(/\.html$/, ''))
  // /docs/quickstart and /docs/quickstart/ are the same page to a reader.
  .map((r) => r.replace(/\/$/, '') || '/')
  .filter((route) =>
    ![...linked].some((l) => {
      const n = l.replace(/\/$/, '') || '/';
      return n === route;
    })
  );
check('no page is unreachable', orphans.length === 0, orphans.join(', '));

console.log(`\n${pass} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
