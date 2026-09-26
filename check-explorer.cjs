const https = require('https');

https.get('https://ms-mba.up.railway.app/explorer', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const idx = data.lastIndexOf('<script>');
    if (idx >= 0) {
      const script = data.slice(idx + 8); // Remove '<script>'
      const scriptEnd = script.indexOf('</script>');
      const scriptContent = script.slice(0, scriptEnd);
      try {
        require('vm').compileFunction(scriptContent);
        console.log('Syntax OK');
      } catch (e) {
        console.log('Syntax error:', e.message);
      }
    } else {
      console.log('No script tag found');
    }
  });
}).on('error', e => console.log('Fetch error:', e.message));