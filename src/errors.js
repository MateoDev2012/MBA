/** Error helpers: always output JSON in the same shape. */

/**
 * Error raised for a failed Roblox response.
 *
 * It lives here rather than in roblox.js because the cache needs to raise it
 * too: when Roblox is refusing us and there is nothing cached to fall back on,
 * the cooldown path has to produce the same error the fetch path would have, or
 * the response body changes shape depending on which piece of code noticed
 * first. Re-exported from roblox.js so existing imports keep working.
 */
export class RobloxError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message);
    this.name = 'RobloxError';
    this.status = status ?? 502;
    this.code = code ?? 'UPSTREAM_ERROR';
    this.cause = cause;
  }
}

export function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'BAD_REQUEST';
  return err;
}

export function notFound(message = 'Not found') {
  const err = new Error(message);
  err.status = 404;
  err.code = 'NOT_FOUND';
  return err;
}

/**
 * Wraps an async handler so rejections reach the error middleware instead of
 * hanging (Express 4 does not catch promises on its own).
 */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
