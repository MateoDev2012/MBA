/**
 * Response caching headers.
 *
 * Tells browsers and any CDN in front of us how long this response may be
 * reused. This is what lets Cloudflare (or nginx, or a browser) answer most
 * requests without us ever calling Roblox, which is the difference between an
 * API that stays up and one that gets rate limited into uselessness.
 *
 * TTL should be the shortest of the caches involved, so the header can never
 * claim more freshness than the data actually has.
 */

export function setCacheControl(res, seconds) {
  res.setHeader('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${seconds * 2}`);
}
