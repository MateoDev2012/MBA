const fs = require('fs');
const path = 'C:\\Users\\Asus\\OneDrive\\Desktop\\roblox api\\public\\index.html';
let t = fs.readFileSync(path, 'utf8');

const idx = t.indexOf('<pre><code><body data-rbx-game');
const actual = t.slice(idx, idx + 249);
const expected = '<pre><code><body data-rbx-game="994732206">\n\n  <h2>{{name}}</h2>\n  <p>{{playing}} players right now &middot; {{likes}} likes</p>\n  <img data-rbx-set="src=thumbnail:url">\n\n  <script src="https://YOUR-DOMAIN.com/roblox-stats.js"></script></code></pre>';

console.log('Actual length:', actual.length);
console.log('Expected length:', expected.length);
console.log('');
console.log('=== ACTUAL ===');
console.log(JSON.stringify(actual));
console.log('');
console.log('=== EXPECTED ===');
console.log(JSON.stringify(expected));
console.log('');

for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
  const a = actual[i];
  const e = expected[i];
  const ac = a ? a.charCodeAt(0) : 'EOF';
  const ec = e ? e.charCodeAt(0) : 'EOF';
  if (a !== e) {
    console.log(`Mismatch at ${i}: actual="${a}"(${ac}) expected="${e}"(${ec})`);
  }
}