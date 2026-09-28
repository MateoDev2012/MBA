/**
 * Static checks over every HTML page in public/.
 *
 * These are the four ways this site has broken in the past, and none of them
 * show up in a smoke test because the server keeps serving a 200 for a page that
 * is blank, half-escaped, or about to execute a script it was only meant to
 * display:
 *
 *   1. A UTF-8 BOM. PowerShell's Set-Content adds one, and it turns the first
 *      tag into a text node, which silently eats the doctype.
 *   2. An inline script that does not parse. The pages carry their own small
 *      scripts; a syntax error there is invisible in review and fatal at runtime.
 *   3. A live <script> inside a <pre>. The "copy this file" snippets show real
 *      markup, and one careless edit turns documentation into a running script.
 *   4. Double-escaped entities. A page that renders `&amp;amp;` has been passed
 *      through an escaper twice, which is easy to do when a template is fixed
 *      with a string replace.
 *
 * Plus two structural rules: exactly one <h1>, and a non-empty <title>.
 *
 * Run with `npm run check:html`.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const publicDir = join(root, 'public');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

const files = walk(publicDir);
if (!files.length) {
  console.error('no HTML found under public/');
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'check-html-'));
const problems = [];
let scriptsChecked = 0;

for (const abs of files) {
  const rel = relative(root, abs).replace(/\\/g, '/');
  const buf = readFileSync(abs);
  const text = buf.toString('utf8');

  // 1. BOM
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    problems.push(`${rel}: starts with a UTF-8 BOM`);
  }

  // 2. Inline scripts parse
  let index = 0;
  for (const m of text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const body = m[1].trim();
    if (!body) continue;
    index++;
    scriptsChecked++;
    const scratchFile = join(scratch, `inline-${scriptsChecked}.mjs`);
    writeFileSync(scratchFile, body);
    try {
      execFileSync(process.execPath, ['--check', scratchFile], { stdio: 'pipe' });
    } catch (err) {
      const detail = String(err.stderr || err).split('\n').slice(0, 4).join('\n');
      problems.push(`${rel}: inline script #${index} does not parse\n    ${detail.replace(/\n/g, '\n    ')}`);
    }
  }

  // 3. A script inside a pre block runs.
  for (const m of text.matchAll(/<pre[\s\S]*?<\/pre>/g)) {
    if (/<script/i.test(m[0])) problems.push(`${rel}: live <script> inside a <pre> block`);
  }

  // 4. Escaped twice
  if (text.includes('&amp;amp;')) problems.push(`${rel}: double-escaped entity (&amp;amp;)`);
  if (text.includes('&amp;lt;') || text.includes('&amp;gt;')) {
    problems.push(`${rel}: escaped entity leaked into visible text`);
  }

  // Structure
  const h1 = (text.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) problems.push(`${rel}: ${h1} <h1> elements, expected exactly 1`);

  const title = /<title>([^<]*)<\/title>/.exec(text);
  if (!title || !title[1].trim()) problems.push(`${rel}: missing or empty <title>`);

  if (!/<html[^>]+data-theme=/.test(text)) {
    problems.push(`${rel}: no data-theme on <html>, so the theme cannot be set before first paint`);
  }
}

rmSync(scratch, { recursive: true, force: true });

if (problems.length) {
  console.error(`${problems.length} problem(s):\n`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

console.log(`html: ${files.length} pages, ${scriptsChecked} inline scripts, all clean`);
