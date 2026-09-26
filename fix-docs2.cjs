const fs = require('fs');
const path = 'C:/Users/Asus/OneDrive/Desktop/roblox api/public/docs.html';
let t = fs.readFileSync(path, 'utf8');

// Find the "Several games on one page" section and add a note before it
const searchStr = '<h3 class="mt-3">Several games on one page</h3>';
const idx = t.indexOf(searchStr);

if (idx >= 0) {
  const note = `
        <div class="note info">
          <p><strong>Simpler option:</strong> set <code>window.RBX_GAME_ID = '994732206'</code> in a
            <code><script></code> before loading <code>roblox-stats.js</code>, and you don't need
            <code>data-rbx-game</code> on the body. Placeholders work globally.</p>
        </div>

        <p><strong>A binding with no <code>data-rbx-game</code> ancestor is intentionally never filled.</strong>
          Otherwise an element outside every scope would still get filled, and you would have no way to
          write the literal text <code>{{playing}}</code> in a tutorial or an example.</p>

        ${searchStr}`;
  
  t = t.replace(searchStr, note);
  fs.writeFileSync(path, t);
  console.log('Added note successfully!');
} else {
  console.log('Search string not found');
}