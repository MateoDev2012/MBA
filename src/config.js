/** Configuration read from the environment, with sane defaults. */

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Cache TTLs in seconds, tuned to how fast each value actually changes:
 * `playing` changes constantly (30s), a logo basically never (1h).
 */
const ttl = {
  stats: num(process.env.CACHE_TTL_STATS, 30),
  votes: num(process.env.CACHE_TTL_VOTES, 300),
  favorites: num(process.env.CACHE_TTL_FAVORITES, 600),
  media: num(process.env.CACHE_TTL_MEDIA, 3600),
};

export const config = {
  port: num(process.env.PORT, 3000),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  upstreamTimeoutMs: num(process.env.UPSTREAM_TIMEOUT_MS, 10000),
  // Cap on a template sent to POST /api/v1/render, so one request cannot make
  // the server chew through megabytes of string.
  renderMaxTemplateChars: num(process.env.RENDER_MAX_TEMPLATE_CHARS, 200_000),
  ttl,
  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: num(process.env.RATE_LIMIT_MAX, 120),
  },
};
