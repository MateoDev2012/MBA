const fs = require('fs');
const path = 'C:\\Users\\Asus\\OneDrive\\Desktop\\roblox api\\public\\index.html';
let t = fs.readFileSync(path, 'utf8');

const idx = t.indexOf('<body data-rbx-game');
console.log('Index:', idx);
console.log('Bytes around:');
for (let i = idx - 10; i < idx + 200; i++) {
  const c = t[i];
  const code = t.charCodeAt(i);
  if (c === '\n') console.log(`${i}: \\n (${code})`);
  else if (c === '\t') console.log(`${i}: \\t (${code})`);
  else if (c === ' ') console.log(`${i}: space (${code})`);
  else if (c === '<') console.log(`${i}: < (${code})`);
  else if (c === '>') console.log(`${i}: > (${code})`);
  else if (c === '&') console.log(`${i}: & (${code})`);
  else console.log(`${i}: ${c} (${code})`);
}