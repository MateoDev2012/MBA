/**
 * Explorer honesty checks. No server, no browser: these read the file and
 * assert the invariants that are easy to break and expensive to discover.
 *
 * Both of these exist because a user found the bug by using the page, which is
 * the worst way to find one.
 *
 *  - rankOf must consult state.query. It used to return the game's position in
 *    whatever list was on screen while the cell was labelled "Global", so
 *    searching for a 21-player game and getting one result put "#1 Global" at
 *    the top of the page. A search result is ordered by relevance and has no
 *    global position, and saying otherwise is a false claim rather than a rough
 *    edge.
 *
 *  - The rank label has to exist and be written by the script. When it was
 *    static, there was no way to say "Search rank" and the same cell claimed a
 *    global position on a relevance list.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '..', '..', 'public', 'explorer', 'index.html');
const src = readFileSync(file, 'utf8');

let pass = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'pass  ' : 'FAIL  '} ${name}${ok ? '' : '  <- ' + detail}`);
  ok ? pass++ : failed++;
};

console.log('explorer: the detail view must not claim what it cannot know');

// The function body, so a guard elsewhere in the file cannot satisfy this.
const rankOfBody = /function rankOf\([^)]*\)\s*\{([\s\S]*?)\n  \}/.exec(src);
check('rankOf exists', !!rankOfBody, 'no rankOf function found');
if (rankOfBody) {
  check(
    'rankOf refuses to answer during a search',
    /state\.query/.test(rankOfBody[1]),
    'rankOf does not look at state.query, so a search result gets a rank'
  );
  check(
    'rankOf returns null when it cannot place the game',
    /return null/.test(rankOfBody[1]),
    'rankOf has no null path, so an unplaced game gets a number'
  );
}

// The rank wording must exist for the cases that are not numbers.
check(
  'a search result is labelled as unranked, not as a position',
  /not ranked/.test(src),
  'no "not ranked" wording for search results'
);
check(
  'a game outside the fetched window says so',
  /outside top/.test(src),
  'no wording for a game outside the ranking we fetched'
);
check(
  'the number of games the ranking covers is disclosed',
  /games fetched/.test(src),
  'the rank does not say how far the ranking reaches'
);

// The label element and the write to it. The script looks the element up into
// a variable and assigns through that, so the two halves are on separate lines.
check('the rank cell has a label element', /id="gsRankLabel"/.test(src));
check(
  'the script looks the rank label up',
  /getElementById\('gsRankLabel'\)/.test(src),
  'the label element is never read, so a search cannot say "Search rank"'
);
check(
  'the script writes the rank label',
  /rankLabel\.textContent\s*=/.test(src),
  'the label is static, so a search cannot say "Search rank"'
);

// The chart's own honesty: three readings minimum, and never a fabricated line.
// Comments are stripped first, or this matches the comment that documents the
// Math.random line that used to be here and still is not.
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
check(
  'the chart needs at least three readings',
  /samples\.length < 3/.test(code),
  'the minimum-reading guard is gone'
);
check(
  'there is no randomised fallback line',
  !/Math\.random\s*\(/.test(code),
  'Math.random is back in the Explorer; a drawn line must come from readings'
);
check(
  'the chart reads the sample store',
  /samplesFor\(/.test(code),
  'the chart does not read the samples it collected'
);

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
