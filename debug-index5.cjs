const fs = require('fs');
const path = 'C:\\Users\\Asus\\OneDrive\\Desktop\\roblox api\\public\\index.html';
let t = fs.readFileSync(path, 'utf8');

// Search for the entity-encoded version
const idx = t.indexOf('data-rbx-game="994732206"');
console.log('Index of data-rbx-game:', idx);

if (idx >= 0) {
  console.log('Context (200 chars):');
  console.log(JSON.stringify(t.slice(idx - 50, idx + 250)));
}