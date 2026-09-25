<div align="center">

# Roblox Stats API

**Live Roblox game statistics in one simple REST call.**

Owner · likes · active players · visits · logo · banners · game passes · badges

[Español / Spanish version](README.es.md) · No API key · Open CORS

</div>

---

A free, public REST API that returns **real, live Roblox data** for any game. Give it a `universeId` and get the owner, likes, players online right now, visits, logo, banners, and more — all in one request.

Built for anyone who wants a game leaderboard, a stats page, or a game card on their site without wrestling with Roblox's fragmented endpoints.

And if you just want to paint a number on a page, you don't write any JavaScript at all. **One file, one script tag, done:**

```html
<p>{{playing}} players right now</p>
<script src="https://your-domain.com/roblox-stats.js"></script>
```

```bash
curl https://your-domain.com/api/v1/games/994732206
```

```json
{
  "ok": true,
  "data": {
    "id": 994732206,
    "name": "Blox Fruits",
    "playing": 247363,
    "visits": 64655032396,
    "creator": { "name": "Gamer Robot Inc", "type": "Group" },
    "ratings": { "upVotes": 12709795, "favorites": 19978649, "upVoteRatio": 92.3 },
    "thumbnail": "https://tr.rbxcdn.com/.../512/512/Image/Png/noFilter",
    "images": ["https://tr.rbxcdn.com/.../768/432/Image/Png/noFilter"]
  }
}
```

## Why this exists

Roblox's public API works, but it's spread across five different domains, paths are inconsistent, some are poorly documented, and responses need parsing before they're useful. This wraps all of that into a single, predictable format.

Some Roblox API traps that will ruin your day if you call it directly:

| Trap | Reality |
| --- | --- |
| `/v1/games/favorites/count?universeIds=` | Returns 404. The working path is `/v1/games/{id}/favorites/count`, singular and one id at a time. |
| `thumbnails/multiget/thumbnails?universeIds=` without `size` | Returns 400. `size` is mandatory. |
| `games/{id}/game-passes` | Returns 404. The live endpoint is under `apis.roblox.com/game-passes/v1/...`. |
| `badges/{id}/badges?limit=5` | Returns 400. `limit` must be an **even** number. |
| `games/{id}/servers/Public` | Removed from public API; needs a developer key. Not available here. |
| Game pass prices | Not in the listing. Require one extra call per pass, so they're optional. |
| `placeId` vs `universeId` | Different IDs. A URL ending in `/Place` carries a placeId. |
| `v2/groups/{id}/games` | Only accepts page sizes 10, 25, 50, or 100. Anything else is 400. |
| `v2/groups/{id}/games` | Returns no player counts, and calls visits `placeVisits`. |
| Search results | Come back as many groups of a game, not a group with a list. |

## Features

- **Write the stat name, get the number** — put `{{playing}}` in your HTML and it fills itself. No frameworks, no build step.
- **Everything in one call** — game data, owner, votes, favorites, logo, banners, and media in one response.
- **No API key, open CORS** — drop the URL in a `<script>` or a `fetch()` and it works.
- **Widget** — one `<script>` paints a live card with banner, logo, and stats, styleable with CSS.
- **Server-side templates** — `POST /api/v1/render` returns your HTML with numbers already filled in.
- **Node SDK** — zero-dependency client for server code.
- **MCP server** — lets AI agents look up Roblox stats as a tool.
- **Discovery** — trending games, games by creator, and a machine-readable list of every valid variable.
- **Batch endpoint** — up to 50 games in one request instead of 50 requests.
- **Built-in cache** — tuned per data type to stay inside Roblox's rate limits.
- **Rate limiting** — per IP, so one script can't burn the quota.
- **Roblox resilience** — timeouts, retries with backoff, and request cancellation.

## Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/v1/games/{universeId}` | Full data: owner, votes, favorites, logo, banners, media |
| `GET` | `/api/v1/games/{universeId}/quick` | Lightweight version without heavy media. Ideal for cards and listings |
| `GET` | `/api/v1/games/batch?ids=1,2,3` | Up to 50 games in one call |
| `GET` | `/api/v1/resolve?url={url}` | Converts any Roblox URL to its `universeId` |
| `GET` | `/api/v1/search?q={text}&limit=10` | Search games by name |
| `GET` | `/api/v1/trending?limit=20[&includeMedia=true]` | Most played games right now, sorted by live players. `includeMedia` adds thumbnails and banners |
| `GET` | `/api/v1/groups/{groupId}/games?limit=50` | Games published by a group (`&includeStats=true` adds players) |
| `GET` | `/api/v1/users/{userId}/games?limit=50` | Games published by a user, same options |
| `GET` | `/api/v1/games/{universeId}/game-passes` | Game passes (`?includePrices=true` for prices) |
| `GET` | `/api/v1/games/{universeId}/badges` | Game badges |
| `GET` | `/api/v1/games/{universeId}/developer` | Creator data, plus group details when owner is a group |
| `GET` | `/api/v1/groups/{groupId}` | Group name, description, and member count |
| `GET` | `/api/v1/fields` | Every valid variable name, machine-readable |
| `POST` | `/api/v1/render` | Fills `{{placeholders}}` in HTML with live data |
| `POST` | `/api/v1/render/multi` | Same, for multiple games: `{{universeId:field}}` |
| `GET` | `/api` | JSON index with all endpoints |
| `GET` | `/health` | Service and cache status |

## Quick start (no server, just the file)

```html
<body data-rbx-game="994732206">
  <h2>{{name}}</h2>
  <p>{{playing}} players right now · {{likes}} likes</p>
  <img data-rbx-set="src=thumbnail:url">
  <script src="https://your-domain.com/roblox-stats.js"></script>
</body>
```

Copy `roblox-stats.js` to your project, change the domain, and write any stat name in `{{braces}}`. That's the whole setup.

### Available placeholders
`{{name}}`, `{{playing}}`, `{{visits}}`, `{{likes}}`, `{{upVotes}}`, `{{downVotes}}`, `{{favorites}}`, `{{upVoteRatio}}`, `{{totalVotes}}`, `{{maxPlayers}}`, `{{creator}}`, `{{creatorType}}`, `{{creatorUrl}}`, `{{description}}`, `{{url}}`, `{{thumbnail}}`, `{{banner}}`, `{{created}}`, `{{updated}}`, `{{id}}`

Modifiers: `:raw` (exact number), `:short` (always abbreviated), `:full` (never abbreviated), `:url` (escaped for `src`/`href`).

## Quick start (plain JSON, any language)

```js
const res = await fetch('https://your-domain.com/api/v1/games/994732206');
const { data } = await res.json();
console.log(data.name, data.playing, data.ratings.upVotes);
```

```python
import requests
data = requests.get("https://your-domain.com/api/v1/games/994732206").json()["data"]
print(data["name"], data["playing"], data["ratings"]["upVotes"])
```

```bash
curl https://your-domain.com/api/v1/games/994732206
```

## Run your own (Render, Railway, Fly.io, VPS)

```bash
git clone <this-repo>
cd roblox-api
npm install
npm start          # http://localhost:3000
```

**Required edit before publishing:** in `roblox-stats.js` (line ~117) set:
```js
const SITE_URL = 'https://your-domain.com';
```
So the credit badge links somewhere real.

### Environment variables
| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `CORS_ORIGIN` | `*` | Comma-separated allow-list, or `*` for everyone |
| `RATE_LIMIT_MAX` | `120` | Req/min per IP when no keys configured |
| `API_KEYS` | *(empty)* | Keys separated by `;`, optionally `key:Name:domain.com` |
| `API_KEY_MODE` | `optional` | `off`, `optional`, `required` |
| `RATE_LIMIT_ANON_MAX` | `30` | Per-minute limit for callers without a key |
| `RATE_LIMIT_KEYED_MAX` | `600` | Per-minute limit for callers with a valid key |

Full list in `.env.example`. Cache TTLs and other knobs are there too.

### API keys (optional)
Out of the box no key is needed. If you configure `API_KEYS` you get three modes:

- `off` — no keys at all
- `optional` (default) — anonymous works, valid key gets higher limit
- `required` — every request needs a valid key

Send it in the `X-API-Key` header (never in the URL — that leaks into logs and Referer).

```js
fetch('https://your-domain.com/api/v1/games/994732206', {
  headers: { 'X-API-Key': 'Made by MoonlightStudios' }
})
```

The bundled Node SDK and MCP server read `ROBLOX_API_KEY` from the environment automatically.

**A key is not a secret.** It sits in plain text inside the public `roblox-stats.js` file. What it buys you: a rate limit you control, the ability to revoke one caller without a restart, and optional domain locks (`key:Name:yoursite.com`). It does not make data private. The badge in `roblox-stats.js` is what keeps this free.

Check what a key can do: `GET /api/v1/keys/me` (works even in `required` mode).

## The credit badge (the one rule)

`roblox-stats.js` draws a small **MBA · Made by Moonlight Studios** badge and links the studio name to the studio's site. It verifies the badge is still present, visible, and linked before writing any number. Remove it, blank the name, break the link, or hide it with CSS — the script stops.

Calling the JSON endpoints directly with your own code needs no badge. The badge belongs to the ready-made file and the widget.

## Project structure

```
roblox-api/
├── roblox-stats.js        ← the one file users copy
├── package.json
├── .env.example
├── public/                ← served as static pages (/docs, /demo, /pricing, /legal, /404)
│   ├── index.html         ← home
│   ├── docs.html          ← full documentation
│   ├── demo.html          ← live demo with 6 examples
│   ├── pricing.html       ← limits, FAQ, the rule
│   ├── legal.html         ← terms, privacy, license, contact
│   ├── 404.html           ← friendly 404
│   ├── theme.css          ← complete design system
│   ├── site.js            ← theme, nav, copy, TOC, reveal
│   └── api.js             ← site's own API client
├── src/                   ← server
│   ├── server.js          ← entry point
│   ├── apikey.js          ← key parsing, 3 modes, domain locks
│   ├── ratelimit.js       ← per-key + per-IP buckets
│   ├── cache.js           ← in-memory TTL cache
│   ├── roblox.js          ← all Roblox API calls
│   ├── fields.js          ← 20 stat definitions
│   ├── normalize.js       ← normalizes Roblox responses
│   ├── template.js        ← {{placeholder}} renderer
│   └── routes/
│       ├── games.js       ← /games, /search, /trending, /resolve
│       └── template.js    ← /render, /render/multi, /fields
└── extras/
    ├── sdk/index.js       ← Node SDK
    ├── mcp/server.js      ← MCP server
    └── tests/             ← 125 automated tests
```

## License & legal

See [LICENSE](LICENSE) (MIT for the code). Data comes from Roblox's public APIs. **Not affiliated with, endorsed by, or sponsored by Roblox Corporation.** Roblox and the Roblox logo are trademarks of Roblox Corporation.

Full terms: `/legal` on any deployment (or `legal.html` in this repo).

## Contact

Bug reports, takedown requests, endpoint requests, or questions: **hello@your-domain.example** (replace with your real address before publishing).

A useful bug report is one line: the ID you asked about and the endpoint you used. A failing ID usually means the game is private, archived, or removed — that's Roblox's answer, not a bug here.