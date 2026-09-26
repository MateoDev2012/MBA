const fs = require('fs');
const path = 'C:\\Users\\Asus\\OneDrive\\Desktop\\roblox api\\public\\index.html';
let t = fs.readFileSync(path, 'utf8');

// EXACT block from the file
const oldBlock = '<pre><code><body data-rbx-game="994732206">\n\n  <h2>{{name}}</h2>\n  <p>{{playing}} players right now &middot; {{likes}} likes</p>\n  <img data-rbx-set="src=thumbnail:url">\n\n  <script src="https://YOUR-DOMAIN.com/roblox-stats.js"></script></code></pre>';

const newBlock = '<pre><code><script>\n  window.RBX_GAME_ID = \'994732206\';\n</script>\n<script src="https://YOUR-DOMAIN.com/roblox-stats.js"></script>\n\n<h2>{{name}}</h2>\n<p>{{playing}} players right now &middot; {{likes}} likes</p>\n<img data-rbx-set="src=thumbnail:url"></code></pre>';

console.log('oldBlock in t:', t.includes(oldBlock));
console.log('oldBlock length:', oldBlock.length);

if (t.includes(oldBlock)) {
  t = t.replace(oldBlock, newBlock);
  fs.writeFileSync(path, t);
  console.log('Replaced successfully!');
} else {
  console.log('Still not matching!');
  // Debug: compare char by char
  const idx = t.indexOf('<pre><code><body data-rbx-game');
  if (idx >= 0) {
    const actual = t.slice(idx, idx + oldBlock.length);
    console.log('Actual block:', JSON.stringify(actual));
    console.log('Expected:', JSON.stringify(oldBlock));
    for (let i = 0; i < Math.min(actual.length, oldBlock.length); i++) {
      if (actual[i] !== oldBlock[i]) {
        console.log(`Mismatch at ${i}: actual="${actual[i]}"(${actual.charCodeAt(i)}) expected="${oldBlock[i]}"(${oldBlock.charCodeAt(i)})`);
        break;
      }
    }
  }
}