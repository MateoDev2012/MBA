const fs = require('fs');
const path = 'C:/Users/Asus/OneDrive/Desktop/roblox api/public/explorer/index.html';
let t = fs.readFileSync(path, 'utf8');

const lastScriptStart = t.lastIndexOf('<script>');
const scriptContent = t.slice(lastScriptStart, t.indexOf('</script>', lastScriptStart) + 9);

const newScript = scriptContent.replace(
  "<script>\n(function () {\n  'use strict';",
  "<script>\nconsole.error('[explorer] MAIN SCRIPT START');\n(function () {\n  'use strict';\n  console.error('[explorer] RbxApi:', typeof window.RbxApi);\n  console.error('[explorer] Chart:', typeof Chart);"
);

if (t.includes(scriptContent)) {
  t = t.replace(scriptContent, newScript);
  fs.writeFileSync(path, t);
  console.log('Added debug logs');
} else {
  console.log('Could not find script to replace');
}