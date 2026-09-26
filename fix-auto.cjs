const fs = require('fs');
const path = 'C:\\Users\\Asus\\OneDrive\\Desktop\\roblox api\\public\\index.html';
let t = fs.readFileSync(path, 'utf8');

// Get the EXACT block from the file
const idx = t.indexOf('<body data-rbx-game');
const blockStart = t.lastIndexOf('<pre><code>', idx);
const blockEnd = t.indexOf('</code></pre>', idx);
const oldBlock = t.slice(blockStart, blockEnd + '</code></pre>'.length);

console.log('Old block:', JSON.stringify(oldBlock));
console.log('Old block in t:', t.includes(oldBlock));

const newBlock = '<pre><code><script>\n  window.RBX_GAME_ID = \'994732206\';\n</script>\n<script src="https://YOUR-DOMAIN.com/roblox-stats.js"></script>\n\n<h2>{{name}}</h2>\n<p>{{playing}} players right now &middot; {{likes}} likes</p>\n<img data-rbx-set="src=thumbnail:url"></code></pre>';

if (t.includes(oldBlock)) {
  t = t.replace(oldBlock, newBlock);
  fs.writeFileSync(path, t);
  console.log('Replaced successfully!');
} else {
  console.log('ERROR: Old block not found in t!');
}