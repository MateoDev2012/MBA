#!/usr/bin/env node
/**
 * MCP server: exposes the Roblox stats API as tools for AI agents
 * (Claude Desktop, OpenCode, and anything else speaking MCP over stdio).
 *
 * The MCP SDK is deliberately not a dependency here: this implements the
 * JSON-RPC 2.0 protocol over stdio directly. That keeps the whole project on
 * two dependencies (express and cors) and the MCP server starts with
 * `npm run mcp`, with nothing extra to install.
 *
 * Protocol: MCP "stdio" -> one JSON request per line on stdin.
 */

import readline from 'node:readline';
import { createClient } from '../sdk/index.js';

const PORT = process.env.PORT || 3000;
const API_URL = process.env.ROBLOX_API_URL || `http://localhost:${PORT}`;

// createClient reads ROBLOX_API_KEY itself, so an MCP host pointed at a server
// in API_KEY_MODE=required works with no extra wiring here.
const client = createClient({ baseUrl: API_URL });

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'roblox-stats', version: '1.0.0' };

/**
 * Tool definitions. The client MCP reads this to show the tools to the user
 * and decide when to call them.
 */
const TOOLS = [
  {
    name: 'get_roblox_game',
    description:
      'Live data for a Roblox game: name, players online right now, visits, likes, dislikes, owner, thumbnail, banners and description. Use this whenever someone asks about a specific Roblox game.',
    inputSchema: {
      type: 'object',
      properties: {
        universeId: {
          type: 'number',
          description:
            'Game id (the number in roblox.com/games/<ID>/...). e.g. 994732206 is Blox Fruits.',
        },
      },
      required: ['universeId'],
    },
  },
  {
    name: 'search_roblox_games',
    description:
      'Search Roblox games by name. Returns each result with its player count and likes. Useful when the user gives the game name instead of the id.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Game name, e.g. "Blox Fruits"' },
        limit: { type: 'number', description: 'Max results (default 10, max 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'resolve_roblox_url',
    description:
      'Converts a Roblox URL to its universeId. Use it when the user pastes a roblox.com/games/... link instead of typing the number.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Game URL on roblox.com' },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_roblox_game_passes',
    description: 'Lists the game passes of a Roblox game with their price in Robux.',
    inputSchema: {
      type: 'object',
      properties: {
        universeId: { type: 'number', description: 'Game id' },
        includePrices: { type: 'boolean', description: 'Include prices (slower)' },
      },
      required: ['universeId'],
    },
  },
  {
    name: 'get_roblox_badges',
    description: 'Lists the badges of a Roblox game.',
    inputSchema: {
      type: 'object',
      properties: {
        universeId: { type: 'number', description: 'Game id' },
      },
      required: ['universeId'],
    },
  },
  {
    name: 'get_roblox_trending',
    description:
      'Lists the most played Roblox games right now, sorted by live player count. Use this for "what is popular" questions.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many games to return (default 10, max 50)' },
      },
    },
  },
  {
    name: 'get_roblox_creator_games',
    description:
      'Lists the games published by a group or a user, so you can answer "what does this creator own". Player counts are null unless includeStats is true.',
    inputSchema: {
      type: 'object',
      properties: {
        creatorType: { type: 'string', enum: ['group', 'user'], description: 'Which kind of creator' },
        creatorId: { type: 'number', description: 'The group or user id' },
        limit: { type: 'number', description: 'How many games (default 50)' },
        includeStats: {
          type: 'boolean',
          description: 'Fill in live player counts with one extra request. Off by default.',
        },
      },
      required: ['creatorType', 'creatorId'],
    },
  },
  {
    name: 'fill_roblox_template',
    description:
      'Fills {{placeholders}} in an HTML snippet with live stats, e.g. "<b>{{playing}}</b> players in {{name}}". Useful for generating a short summary or a card in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        universeId: { type: 'number', description: 'Game id' },
        html: { type: 'string', description: 'Template containing {{placeholders}}' },
      },
      required: ['universeId', 'html'],
    },
  },
  {
    name: 'list_roblox_fields',
    description:
      'Lists every valid placeholder name (name, playing, visits, likes, favorites, upVoteRatio, thumbnail, creator, ...). Call this before fill_roblox_template if unsure which names exist.',
    inputSchema: { type: 'object', properties: {} },
  },
];

/** Runs a tool and returns the result in MCP shape. */
async function callTool(name, args) {
  try {
    switch (name) {
      case 'get_roblox_game': {
        const game = await client.getGame(args.universeId);
        return {
          content: [
            {
              type: 'text',
              text: [
                `Game: ${game.name}`,
                `Id: ${game.id}`,
                `Playing now: ${game.playing.toLocaleString('en-US')}`,
                `Total visits: ${game.visits.toLocaleString('en-US')}`,
                `Likes: ${game.ratings.upVotes.toLocaleString('en-US')}`,
                `Dislikes: ${game.ratings.downVotes.toLocaleString('en-US')}`,
                `Vote ratio: ${game.ratings.upVoteRatio}%`,
                `Favorites: ${game.ratings.favorites.toLocaleString('en-US')}`,
                `Owner: ${game.creator?.name} (${game.creator?.type})`,
                `URL: ${game.url}`,
                `Thumbnail: ${game.thumbnail ?? 'not available'}`,
                `Banners: ${game.images.length > 0 ? game.images.join(', ') : 'not available'}`,
                game.description ? `Description: ${game.description.slice(0, 600)}` : null,
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        };
      }

      case 'search_roblox_games': {
        const results = await client.search(args.query, { limit: args.limit || 10 });
        if (!Array.isArray(results) || results.length === 0) {
          return {
            content: [{ type: 'text', text: `No games found for "${args.query}".` }],
          };
        }
        const lines = results.map(
          (g, i) =>
            `${i + 1}. ${g.name} (id ${g.universeId}) — ${g.playing.toLocaleString('en-US')} playing, ` +
            `${g.upVotes.toLocaleString('en-US')} likes`
        );
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      case 'resolve_roblox_url': {
        const data = await client.resolve(args.url);
        return {
          content: [{ type: 'text', text: `universeId: ${data.universeId}\nURL: ${data.url}` }],
        };
      }

      case 'get_roblox_game_passes': {
        const passes = await client.getGamePasses(args.universeId, {
          includePrices: args.includePrices === true,
        });
        const list = Array.isArray(passes) ? passes : passes?.data || [];
        if (list.length === 0) {
          return { content: [{ type: 'text', text: 'This game has no game passes.' }] };
        }
        const lines = list.map((p) => {
          const price = p.priceInRobux != null ? `${p.priceInRobux} R$` : 'price not available';
          return `- ${p.name}: ${price}${p.isForSale ? '' : ' (not for sale)'}`;
        });
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      case 'get_roblox_badges': {
        const badges = await client.getBadges(args.universeId);
        const list = Array.isArray(badges) ? badges : badges?.data || [];
        if (list.length === 0) {
          return { content: [{ type: 'text', text: 'This game has no published badges.' }] };
        }
        const lines = list
          .slice(0, 50)
          .map((b) => `- ${b.name}: ${b.description || 'no description'}`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      case 'get_roblox_trending': {
        const games = await client.trending({ limit: args.limit || 10 });
        const list = Array.isArray(games) ? games : games?.data || [];
        if (list.length === 0) {
          return { content: [{ type: 'text', text: 'No trending games were returned.' }] };
        }
        const lines = list.map(
          (g, i) =>
            `${i + 1}. ${g.name} (id ${g.id}) — ${g.playing.toLocaleString('en-US')} playing, ` +
            `${(g.upVotes ?? 0).toLocaleString('en-US')} likes${g.creator ? `, by ${g.creator}` : ''}`
        );
        return {
          content: [{ type: 'text', text: `Most played Roblox games right now:\n${lines.join('\n')}` }],
        };
      }

      case 'get_roblox_creator_games': {
        const isGroup = args.creatorType === 'group';
        const games = isGroup
          ? await client.getGroupGames(args.creatorId, {
              limit: args.limit || 50,
              includeStats: args.includeStats === true,
            })
          : await client.getUserGames(args.creatorId, {
              limit: args.limit || 50,
              includeStats: args.includeStats === true,
            });
        const list = Array.isArray(games) ? games : games?.data || [];
        const who = `${isGroup ? 'Group' : 'User'} ${args.creatorId}`;
        if (list.length === 0) {
          return { content: [{ type: 'text', text: `${who} has no public games.` }] };
        }
        const lines = list.map((g) => {
          const playing =
            g.playing === null || g.playing === undefined
              ? 'player count not available'
              : `${g.playing.toLocaleString('en-US')} playing`;
          return `- ${g.name} (id ${g.id}): ${playing}, ${(g.visits ?? 0).toLocaleString('en-US')} visits`;
        });
        const header = `${who} publishes ${list.length} game(s):`;
        const footer =
          args.includeStats === true
            ? ''
            : '\n\nPlayer counts are null because Roblox does not provide them on this endpoint. Call again with includeStats: true to fill them in.';
        return { content: [{ type: 'text', text: `${header}\n${lines.join('\n')}${footer}` }] };
      }

      case 'fill_roblox_template': {
        const r = await client.render(args.universeId, args.html);
        return {
          content: [
            {
              type: 'text',
              text:
                `Filled using: ${r.used.join(', ')}\n` +
                `Result:\n${r.html}`,
            },
          ],
        };
      }

      case 'list_roblox_fields': {
        const f = await client.fields();
        const lines = f.fields.map((x) => `- {{${x.name}}}: ${x.description}`);
        return {
          content: [
            {
              type: 'text',
              text:
                `Valid placeholders (${f.fields.length}):\n${lines.join('\n')}\n\n` +
                `Suffixes: :raw for the exact number, :short to force 245.4K, :url inside src="...".`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    // Errors come back as a result with isError rather than a protocol
    // exception, so the model can read the reason and retry.
    return {
      content: [{ type: 'text', text: `Error while calling the API: ${err.message}` }],
      isError: true,
    };
  }
}

/** Single entry point for the protocol. */
function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };

    case 'notifications/initialized':
      return null; // notification: no response

    case 'tools/list':
      return { tools: TOOLS };

    case 'tools/call':
      return callTool(msg.params?.name, msg.params?.arguments || {});

    case 'ping':
      return {};

    default:
      throw Object.assign(new Error(`Unsupported method: ${msg.method}`), { code: -32601 });
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;

  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return; // corrupt line: skip it instead of dying
  }

  try {
    const result = await handle(msg);
    // Notifications get no response.
    if (result === null || msg.id === undefined) return;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id ?? null,
        error: { code: err.code ?? -32603, message: err.message },
      }) + '\n'
    );
  }
});

rl.on('close', () => process.exit(0));

process.stderr.write(`roblox-stats MCP server ready. Talking to the API at ${API_URL}\n`);
