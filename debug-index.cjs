const fs = require('fs');
const path = 'C:\\Users\\Asus\\OneDrive\\Desktop\\roblox api\\public\\index.html';
let t = fs.readFileSync(path, 'utf8');

// Search for the game ID in the file
const idx = t.indexOf('994732206');
if (idx >= 0) {
  console.log('Found at index:', idx);
  console.log('Context:', JSON.stringify(t.slice(idx - 50, idx + 300)));
} else {
  console.log('Game ID not found in file');
}