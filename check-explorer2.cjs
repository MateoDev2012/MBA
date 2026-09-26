const https = require('https');

https.get('https://ms-mba.up.railway.app/explorer', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const idx = data.lastIndexOf('<script>');
    console.log('Last <script> at:', idx);
    if (idx >= 0) {
      const s = data.slice(idx + 8);
      const e = s.indexOf('</script>');
      console.log('Script content length:', e);
      console.log(s.slice(0, 200));
    }
  });
}).on('error', e => console.log('Error:', e.message));