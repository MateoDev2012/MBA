/**
 * Placeholder rendering.
 *
 * Supported syntaxes, so people can use whichever one they already have in
 * their fingers:
 *
 *   {{playing}}                  default: escaped, abbreviated if it reads better
 *   {{playing:raw}}              the exact value, still escaped
 *   {{playing:short}}            forced abbreviation (245.4K)
 *   {{thumbnail:url}}            only quotes/ampersands escaped, for src="..."
 *
 * The data-rbx-bind="..." attribute is deliberately NOT handled here. Filling
 * an element's text with a regex means guessing where the tag ends, which
 * breaks on nested markup. That syntax belongs to the browser script, which
 * sets textContent and has the real DOM. Server side, {{...}} is the syntax.
 *
 * Unknown names are reported instead of silently rendering nothing, which is
 * the difference between a typo you find in ten seconds and a blank box you
 * stare at for an afternoon.
 */

import { FIELDS, getField, renderValue } from './fields.js';

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*(?::\s*(raw|short|url|text)\s*)?\}\}/g;

/**
 * Renders an HTML template.
 *
 * @param {string} html   template containing {{placeholders}}
 * @param {object} game   normalized game object (the shape /games/{id} returns)
 * @param {object} opts   { onMissing: 'empty' | 'keep' | 'error' }
 * @returns {{ html: string, used: string[], unknown: string[] }}
 */
export function renderTemplate(html, game, opts = {}) {
  const onMissing = opts.onMissing || 'keep';
  const used = new Set();
  const unknown = new Set();

  const out = html.replace(PLACEHOLDER, (_match, name, mode) => {
    return resolve(name, game, mode, onMissing, used, unknown);
  });

  return { html: out, used: [...used], unknown: [...unknown] };
}

function resolve(name, game, mode, onMissing, used, unknown) {
  if (!FIELDS[name]) {
    unknown.add(name);
    return onMissing === 'empty' ? '' : `{{${name}}}`;
  }
  used.add(name);
  const value = getField(game, name);
  if (value === null || value === undefined) {
    return onMissing === 'empty' ? '' : `{{${name}}}`;
  }
  return renderValue(name, value, mode || 'text');
}

/**
 * Fills the placeholders for several games at once, keyed by universeId.
 * Useful for "compare these two games" templates.
 */
export function renderWithMap(html, gamesById, opts = {}) {
  const used = new Set();
  const unknown = new Set();

  // Grammar: [universeId:]field[:mode]
  // The leading id is only an id when it is all digits, which is what keeps
  // "{{playing:short}}" from being read as "field 'short' of game 'playing'".
  const resolveAny = (token) => {
    const parts = token.split(':').map((s) => s.trim());
    let id = null;
    let name = parts[0];
    let mode;

    if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
      id = parts[0];
      name = parts[1];
      mode = parts[2];
    } else {
      mode = parts[1];
    }

    if (!FIELDS[name]) {
      unknown.add(name);
      return opts.onMissing === 'empty' ? '' : `{{${token}}}`;
    }
    used.add(name);

    const game = id ? gamesById[id] : null;
    if (!game) return '';

    const value = getField(game, name);
    if (value === null || value === undefined) return '';
    return renderValue(name, value, mode || 'text');
  };

  // Same pattern as PLACEHOLDER but tolerating a numeric id prefix.
  const MULTI = /\{\{\s*([a-zA-Z0-9]+(?:\s*:\s*[a-zA-Z0-9]+){0,2})\s*\}\}/g;
  const out = html.replace(MULTI, (_m, token) => resolveAny(token.trim()));

  return { html: out, used: [...used], unknown: [...unknown] };
}
