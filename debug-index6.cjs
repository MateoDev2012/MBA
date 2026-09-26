const fs = require('fs');
const path = 'C:\\Users\\Asus\\OneDrive\\Desktop\\roblox api\\public\\index.html';
let t = fs.readFileSync(path, 'utf8');

const idx = t.indexOf('data-rbx-game="994732206"');
console.log('Found at:', idx);

// Get the exact bytes from <pre><code> to </code></pre>
const start = t.lastIndexOf('<pre><code>', idx);
const end = t.indexOf('</code></pre>', idx);
console.log('Start:', start, 'End:', end);

if (start >= 0 && end >= 0) {
  const block = t.slice(start, end + '</code></pre>'.length);
  console.log('=== BLOCK ===');
  console.log(JSON.stringify(block));
  console.log('=== END BLOCK ===');
  
  // Also print char codes
  console.log('\nChar codes:');
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    const code = block.charCodeAt(i);
    if (code > 127 || c === '\n' || c === '\r' || c === '\t') {
      console.log(`${i}: "${c}" (${code})`);
    }
  }
}