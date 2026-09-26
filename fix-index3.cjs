const fs = require('fs');
const path = 'C:\\Users\\Asus\\OneDrive\\Desktop\\roblox api\\public\\index.html';
let t = fs.readFileSync(path, 'utf8');

// The EXACT block as it appears in the file (with HTML entities < >)
const oldBlock = '<pre><code><body data-rbx-game="994732206">\n\n  <h2>{{name}}</h2>\n  <p>{{playing}} players right now &middot; {{likes}} likes</p>\n  <img data-rbx-set="src=thumbnail:url">\n\n  <script src="https://YOUR-DOMAIN.com/roblox-stats.js"></script></code></pre>';

const newBlock = '<pre><code><script>\n  window.RBX_GAME_ID = \'994732206\';\n</script>\n<script src="https://YOUR-DOMAIN.com/roblox-stats.js"></script>\n\n<h2>{{name}}</h2>\n<p>{{playing}} players right now &middot; {{likes}} likes</p>\n<img data-rbx-set="src=thumbnail:url"></code></pre>';

if (t.includes(oldBlock)) {
  t = t.replace(oldBlock, newBlock);
  fs.writeFileSync(path, t);
  console.log('Replaced successfully!');
} else {
  console.log('Old block not found - checking...');
  const idx = t.indexOf('<body data-rbx-game');
  if (idx >= 0) {
    console.log('Found at:', idx);
    console.log('Context:', JSON.stringify(t.slice(idx - 30, idx + 280)));
  }
}