const https = require('https');

https.get('https://ms-mba.up.railway.app/roblox-stats.js', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const idx = data.indexOf('DELIBERATE');
    console.log('Found at:', idx);
    if (idx >= 0) {
      console.log('Context:', data.slice(Math.max(0, idx-200), idx+200));
    }
  });
}).on('error', e => console.log('Fetch error:', e.message));