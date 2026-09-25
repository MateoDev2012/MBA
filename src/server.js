/**
 * Roblox Stats API server.
 *
 * Design decision: open CORS and no API key. The point is that anyone can drop
 * the URL into a <script> tag or a fetch() call and have it just work. Abuse
 * is handled by the per-IP rate limit and by the cache (so we do not burn the
 * Roblox quota), not by forcing people to sign up.
 */

// Must be the FIRST import: the modules below read process.env as they load,
// and this one is what puts the .env values into the environment.
import './load-env.js';

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { rateLimit } from './ratelimit.js';
import { apikey, apiKeyGuard, describe, firstKey } from './apikey.js';
import { router as gamesRouter } from './routes/games.js';
import { router as templateRouter } from './routes/template.js';
import { cache } from './cache.js';
import { RobloxError } from './roblox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

const app = express();
app.disable('x-powered-by');
// Required for req.ip to be the real client address behind a proxy
// (Render, Railway, nginx, ...).
app.set('trust proxy', 1);

app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
    // POST is needed by /api/v1/render. Without it here the browser blocks
    // the preflight even though the request itself would have worked, which
    // looks exactly like a broken API from the caller's side.
    methods: ['GET', 'POST', 'OPTIONS'],
    // Without this a browser can send these headers but cannot READ them, so
    // `res.setHeader` on them is invisible to any page on another domain. That
    // matters for X-RBX-Key, which is how a page finds out whether its key is
    // valid without having to provoke an error first.
    exposedHeaders: ['X-RBX-Key', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
  })
);

// ---------------------------------------------------------------------------
// Everything below this line is STATIC: no key, no rate limit.
// ---------------------------------------------------------------------------
// The key lives INSIDE roblox-stats.js, so a browser physically cannot send it
// on the request that downloads the file. Guarding or rate limiting the file
// would mean that under API_KEY_MODE=required nobody could ever obtain the key,
// and under the anonymous limit a crowd behind one IP could burn the quota and
// take the file down with it. A static file also costs zero Roblox requests,
// which is the only thing the limiter exists to protect. So the assets are
// served first, ahead of both guards.

/** The one file consumers copy. It lives at the project root, not in public/,
 *  so that "which file do I need?" has a one-word answer. */
app.get('/roblox-stats.js', (req, res) => {
  const file = path.join(rootDir, 'roblox-stats.js');
  if (req.query.download) {
    res.download(file, 'roblox-stats.js', { headers: { 'Cache-Control': 'public, max-age=3600' } });
  } else {
    res.sendFile(file, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  }
});

/** Root: the documentation page (HTML). */
app.use(express.static(publicDir, { extensions: ['html'] }));

// ---------------------------------------------------------------------------
// Everything below this line is the API: key checked, rate limited.
// ---------------------------------------------------------------------------

/**
 * Health check and key self-check, both registered before the key guard.
 *
 * Neither is a secret. They are open on purpose, because each one is the way a
 * caller finds out WHY it is being refused, and a diagnostic that 401s is worse
 * than no diagnostic: a deploy platform polling /health would kill a working
 * server, and a page whose key is wrong would have no way to ask.
 */
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    cache: cache.stats(),
    keys: { mode: apikey.mode, configured: apikey.configured },
  });
});

app.get('/api/v1/keys/me', (req, res) => {
  res.json({
    ...describe(req),
    // In `required` mode this project's own documentation page and demo would
    // 401 on themselves, which makes the mode undeployable, so they need some
    // way to get a working key. Handed over to anyone who asks, in that mode
    // only, and only when there is exactly one key.
    //
    // This is not a secret being disclosed. It is written in plain text inside
    // the public .js file that every embedder already downloads, so anyone who
    // wanted it could curl that file instead. Gating it on Origin or Referer
    // would look like protection while stopping nobody, and would break the
    // docs page, because a same-origin GET sends no Origin header at all.
    //
    // Returns null when several keys are configured, since picking one for
    // them would be arbitrary. Use the default `optional` mode in that case.
    ...(apikey.mode === 'required' && firstKey() ? { publicKey: firstKey() } : {}),
  });
});

// The key guard goes BEFORE the JSON body parser on purpose. express.json will
// happily buffer 300kb for a caller whose key is about to be refused, so the
// cheap header check has to happen first and the parser only runs for callers
// who got past it. It also goes before the rate limiter, so a request that was
// never going to be answered does not spend quota.
app.use(apiKeyGuard());

app.use(rateLimit());

// JSON body parsing, needed by POST /api/v1/render.
// The 300kb limit matches the 200k character template cap.
app.use(express.json({ limit: '300kb' }));

/** JSON index of the API. */
app.get('/api', (req, res) => {
  res.json({
    ok: true,
    name: 'Roblox Stats API',
    version: '1.0.0',
    description: 'Live Roblox game statistics, ready to drop into your site.',
    docs: '/docs',
    endpoints: {
      fullGame: '/api/v1/games/{universeId}',
      quickGame: '/api/v1/games/{universeId}/quick',
      batch: '/api/v1/games/batch?ids=1,2,3',
      resolveUrl: '/api/v1/resolve?url=https://www.roblox.com/games/994732206',
      search: '/api/v1/search?q=blox+fruits&limit=10',
      gamePasses: '/api/v1/games/{universeId}/game-passes',
      badges: '/api/v1/games/{universeId}/badges',
      developer: '/api/v1/games/{universeId}/developer',
      group: '/api/v1/groups/{groupId}',
      groupGames: '/api/v1/groups/{groupId}/games',
      userGames: '/api/v1/users/{userId}/games',
      trending: '/api/v1/trending?limit=20',
      fields: '/api/v1/fields',
      render: 'POST /api/v1/render',
    },
    apiKey: {
      how: 'Send it in the X-API-Key header (or Authorization: Bearer, or ?key=). The header is preferred: a query parameter leaks into logs and Referer headers.',
      mode: apikey.mode,
      required: apikey.mode === 'required',
      limits: { anonymousPerMinute: apikey.anonMax, keyedPerMinute: apikey.keyedMax },
      inspect: '/api/v1/keys/me',
    },
    placeholders: {
      how: 'Use {{playing}}, {{likes}}, {{name}} in your HTML. See GET /api/v1/fields',
      catalogue: '/api/v1/fields',
    },
    site: {
      home: '/',
      docs: '/docs',
      demo: '/demo',
      pricing: '/pricing',
      legal: '/legal',
      browserFile: '/roblox-stats.js',
      health: '/health',
    },
  });
});

app.use('/api/v1', gamesRouter);
app.use('/api/v1', templateRouter);

// 404 for unknown API routes.
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// 404 for unknown *pages*, as HTML. Registered after the /api handler so a
// mistyped endpoint still gets JSON — a page of HTML in a fetch() is a much
// worse error message than {"ok":false}, and people read the difference.
// express.static already answered /docs, /demo, /pricing and /legal from their
// .html files, so everything that reaches here genuinely does not exist.
app.use((req, res) => {
  res.status(404).sendFile(path.join(publicDir, '404.html'));
});

/** Error middleware: always JSON in the same shape. */
app.use((err, req, res, _next) => {
  const isRoblox = err instanceof RobloxError;
  const status = err.status || (isRoblox ? 502 : 500);

  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, '->', err.message, err.cause || '');
  }

  res.status(status).json({
    ok: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: status >= 500 && !isRoblox ? 'Internal server error' : err.message,
    },
  });
});

const server = app.listen(config.port, () => {
  console.log(`Roblox Stats API listening on http://localhost:${config.port}`);
  console.log(`Docs:   http://localhost:${config.port}/`);
  console.log(`Try:    http://localhost:${config.port}/api/v1/games/994732206  (Blox Fruits)`);
});

const shutdown = (signal) => () => {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));

export { app, server };
