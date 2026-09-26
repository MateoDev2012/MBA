const fs = require('fs');
const path = 'C:\\Users\\Asus\\OneDrive\\Desktop\\roblox api\\public\\index.html';
let t = fs.readFileSync(path, 'utf8');

// Search for the entity-encoded version
const searchStr = '<body data-rbx-game';
const idx = t.indexOf(searchStr);
console.log('Found at:', idx);

if (idx >= 0) {
  // Get the full block from <pre><code> to </code></pre>
  const blockStart = t.lastIndexOf('<pre><code>', idx);
  const blockEnd = t.indexOf('</code></pre>', idx);
  const actualBlock = t.slice(blockStart, blockEnd + '</code></pre>'.length);
  console.log('Block length:', actualBlock.length);
  console.log('=== ACTUAL BLOCK ===');
  console.log(JSON.stringify(actualBlock));
}