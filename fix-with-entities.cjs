const fs = require('fs');
const path = 'C:\\Users\\Asus\\OneDrive\\Desktop\\roblox api\\public\\index.html';
let t = fs.readFileSync(path, 'utf8');

// EXACT block from the file WITH HTML ENTITIES
const oldBlock = '<pre><code><body data-rbx-game="994732206">\n\n  <h2>{{name}}</h2>\n  <p>{{playing}} players right now &middot; {{likes}} likes</p>\n  <img data-rbx-set="src=thumbnail:url">\n\n  <script src="https://YOUR-DOMAIN.com/roblox-stats.js"></script></code></pre>';

const newBlock = '<pre><code><script>\n  window.RBX_GAME_ID = \'994732206\';\n</script>\n<script src="https://YOUR-DOMAIN.com/roblox-stats.js"></script>\n\n<h2>{{name}}</h2>\n<p>{{playing}} players right now &middot; {{likes}} likes</p>\n<img data-rbx-set="src=thumbnail:url"></code></pre>';

console.log('Old block in t:', t.includes(oldBlock));

if (t.includes(oldBlock)) {
  t = t.replace(oldBlock, newBlock);
  fs.writeFileSync(path, t);
  console.log('Replaced successfully!');
} else {
  console.log('Still not matching');
  // Find the actual block
  const idx = t.indexOf('<body data-rbx-game');
  if (idx >= 0) {
    const blockStart = t.lastIndexOf('<pre><code>', idx);
    const blockEnd = t.indexOf('</code></pre>', idx);
    const actual = t.slice(blockStart, blockEnd + '</code></pre>'.length);
    console.log('Actual:', JSON.stringify(actual));
    console.log('Expected:', JSON.stringify(oldBlock));
  }
}