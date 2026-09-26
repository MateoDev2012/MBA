const fs = require('fs');
const path = 'C:\\Users\\Asus\\OneDrive\\Desktop\\roblox api\\public\\index.html';
let t = fs.readFileSync(path, 'utf8');

// Find the full block - search for the pattern
const searchStr = '<pre><code>';
const idx = t.indexOf(searchStr, 9000);
console.log('Found <pre><code> at:', idx);
if (idx >= 0) {
  console.log('Context:', JSON.stringify(t.slice(idx, idx + 300)));
}