#!/usr/bin/env node
/**
 * MCP server test: speaks the protocol over stdio exactly like a real client.
 * Usage:  node extras/tests/smoke-mcp.js   (with the API server running)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_URL = process.env.ROBLOX_API_URL || 'http://localhost:3000';

const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'server.js')], {
  env: { ...process.env, ROBLOX_API_URL: API_URL },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for ${method}`));
    }, 30000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

let passed = 0;
let failed = 0;

function report(name, ok, detail) {
  if (ok) {
    console.log(`  pass   ${name}${detail ? ` â€” ${detail}` : ''}`);
    passed++;
  } else {
    console.log(`  FAIL   ${name}${detail ? ` â€” ${detail}` : ''}`);
    failed++;
  }
}

console.log(`Testing MCP server against ${API_URL}\n`);

// 1. initialize
const init = await request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'smoke-test', version: '1.0.0' },
});
const serverInfo = init.result?.serverInfo;
report(
  'initialize',
  init.result?.protocolVersion === '2024-11-05' && serverInfo?.name === 'roblox-stats',
  serverInfo ? `${serverInfo.name} v${serverInfo.version}` : JSON.stringify(init.error || init)
);

// 2. tools/list
const EXPECTED_TOOLS = [
  'get_roblox_game',
  'search_roblox_games',
  'resolve_roblox_url',
  'get_roblox_game_passes',
  'get_roblox_badges',
  'get_roblox_trending',
  'get_roblox_creator_games',
  'fill_roblox_template',
  'list_roblox_fields',
];
const tools = await request('tools/list', {});
const toolList = tools.result?.tools || [];
const missingTools = EXPECTED_TOOLS.filter((n) => !toolList.some((t) => t.name === n));
report(
  'tools/list',
  missingTools.length === 0,
  missingTools.length
    ? `missing: ${missingTools.join(', ')}`
    : `${toolList.length} tools: ${toolList.map((t) => t.name).join(', ')}`
);

// 3. Every tool must have a name and a valid JSON schema.
const schemaOk = toolList.every(
  (t) => t.name && t.description && t.inputSchema && t.inputSchema.type === 'object'
);
report('tool schemas are valid', schemaOk);

// 4. get_roblox_game
const game = await request('tools/call', {
  name: 'get_roblox_game',
  arguments: { universeId: 994732206 },
});
const gameText = game.result?.content?.[0]?.text || '';
report(
  'get_roblox_game',
  game.result && !game.result.isError && gameText.includes('Blox Fruits'),
  gameText.split('\n')[0]
);
report(
  'get_roblox_game returns real numbers',
  /Playing now: [\d,]+/.test(gameText) && /Likes: [\d,]+/.test(gameText),
  (gameText.match(/Playing now: [\d,]+/) || [''])[0]
);

// 5. search_roblox_games
const search = await request('tools/call', {
  name: 'search_roblox_games',
  arguments: { query: 'Blox Fruits', limit: 3 },
});
const searchText = search.result?.content?.[0]?.text || '';
report(
  'search_roblox_games',
  !search.result?.isError && searchText.includes('Blox Fruits'),
  searchText.split('\n')[0]
);

// 6. resolve_roblox_url
const resolve = await request('tools/call', {
  name: 'resolve_roblox_url',
  arguments: { url: 'https://www.roblox.com/games/994732206' },
});
const resolveText = resolve.result?.content?.[0]?.text || '';
report(
  'resolve_roblox_url',
  resolveText.includes('994732206'),
  resolveText.split('\n')[0]
);

// 7. game passes
const passes = await request('tools/call', {
  name: 'get_roblox_game_passes',
  arguments: { universeId: 994732206, includePrices: true },
});
const passesText = passes.result?.content?.[0]?.text || '';
report(
  'get_roblox_game_passes',
  !passes.result?.isError && /R\$/.test(passesText),
  passesText.split('\n')[0]
);

// 8. badges
const badges = await request('tools/call', {
  name: 'get_roblox_badges',
  arguments: { universeId: 994732206 },
});
report(
  'get_roblox_badges',
  !badges.result?.isError && Array.isArray(badges.result?.content),
  (badges.result?.content?.[0]?.text || '').split('\n')[0]
);

// 9. trending
const trending = await request('tools/call', {
  name: 'get_roblox_trending',
  arguments: { limit: 5 },
});
const trendingText = trending.result?.content?.[0]?.text || '';
report(
  'get_roblox_trending',
  !trending.result?.isError && /1\./.test(trendingText) && /playing/.test(trendingText),
  trendingText.split('\n')[0]
);

// 10. creator games, with and without player counts
const creatorNoStats = await request('tools/call', {
  name: 'get_roblox_creator_games',
  arguments: { creatorType: 'group', creatorId: 4372130 },
});
const creatorNoStatsText = creatorNoStats.result?.content?.[0]?.text || '';
report(
  'get_roblox_creator_games explains the missing player count',
  !creatorNoStats.result?.isError &&
    creatorNoStatsText.includes('Blox Fruits') &&
    creatorNoStatsText.includes('includeStats'),
  creatorNoStatsText.split('\n')[0]
);

const creatorStats = await request('tools/call', {
  name: 'get_roblox_creator_games',
  arguments: { creatorType: 'group', creatorId: 4372130, includeStats: true },
});
const creatorStatsText = creatorStats.result?.content?.[0]?.text || '';
report(
  'get_roblox_creator_games with includeStats',
  !creatorStats.result?.isError && /[\d,]+ playing/.test(creatorStatsText),
  (creatorStatsText.match(/[\d,]+ playing/) || [''])[0]
);

// 11. template filling
const filled = await request('tools/call', {
  name: 'fill_roblox_template',
  arguments: { universeId: 994732206, html: '<b>{{playing}}</b> players in {{name}}' },
});
const filledText = filled.result?.content?.[0]?.text || '';
report(
  'fill_roblox_template',
  !filled.result?.isError && filledText.includes('Blox Fruits') && !/\{\{/.test(filledText),
  filledText.split('\n').pop()
);

const badTemplate = await request('tools/call', {
  name: 'fill_roblox_template',
  arguments: { universeId: 994732206, html: '{{nope}}' },
});
report(
  'fill_roblox_template reports an unknown field',
  badTemplate.result?.isError === true,
  (badTemplate.result?.content?.[0]?.text || '').slice(0, 70)
);

// 12. the field catalogue
const fieldList = await request('tools/call', { name: 'list_roblox_fields', arguments: {} });
const fieldText = fieldList.result?.content?.[0]?.text || '';
report(
  'list_roblox_fields',
  !fieldList.result?.isError && fieldText.includes('{{playing}}') && fieldText.includes('{{likes}}'),
  fieldText.split('\n')[0]
);

// 13. A bad argument must come back as isError, not as a protocol crash.
const bad = await request('tools/call', {
  name: 'get_roblox_game',
  arguments: { universeId: 999999999999 },
});
report(
  'invalid id returns isError (no crash)',
  bad.result?.isError === true && !bad.error,
  (bad.result?.content?.[0]?.text || '').slice(0, 60)
);

// 10. An unknown method must be a proper JSON-RPC error.
const unknown = await request('does/not/exist', {});
report(
  'unknown method returns JSON-RPC error',
  unknown.error?.code === -32601,
  `code ${unknown.error?.code}`
);

child.kill();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
