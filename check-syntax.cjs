const https = require('https');

https.get('https://ms-mba.up.railway.app/roblox-stats.js', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      require('vm').compileFunction(data);
      console.log('Syntax OK');
    } catch (e) {
      console.log('Syntax error:', e.message);
    }
  });
}).on('error', e => console.log('Fetch error:', e.message));