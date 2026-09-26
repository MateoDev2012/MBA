const https = require('https');

https.get('https://ms-mba.up.railway.app/explorer', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Length:', data.length);
    console.log('Has <script>:', data.includes('<script>'));
    console.log('Has </script>:', data.includes('</script>'));
    const idx1 = data.indexOf('<script');
    console.log('First <script at:', data.indexOf('<script'));
    console.log('Last <script at:', data.lastIndexOf('<script'));
    const idx = data.lastIndexOf('<script>');
    if (idx >= 0) {
      console.log(data.slice(idx, idx + 100));
    }
  });
}).on('error', e => console.log('Error:', e.message));