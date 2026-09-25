/**
 * The catalogue of stat variables.
 *
 * This is the single source of truth for which names you can use in
 * {{placeholders}} and data-rbx-bind="..." attributes. Keeping it explicit
 * means a typo produces a clear error instead of a silently empty spot on the
 * page, which is the single most common way this kind of feature annoys people.
 */

/**
 * Each field: how to pull it out of the game object, whether it is a number
 * worth abbreviating, and a short description used by the /fields endpoint.
 */
export const FIELDS = {
  // --- Identity ---
  name: { get: (g) => g.name, desc: 'Game name' },
  id: { get: (g) => g.id, desc: 'Game universeId' },
  description: { get: (g) => g.description, desc: 'Game description', multiline: true },
  url: { get: (g) => g.url, desc: 'Public Roblox URL' },
  thumbnail: { get: (g) => g.thumbnail, desc: 'Logo (thumbnail) image URL' },
  banner: { get: (g) => g.images?.[0] || null, desc: 'Banner image URL' },

  // --- Player counts (these change constantly) ---
  playing: { get: (g) => g.playing, desc: 'Players online right now', number: true, short: true },
  visits: { get: (g) => g.visits, desc: 'All-time total visits', number: true, short: true },
  maxPlayers: { get: (g) => g.maxPlayers, desc: 'Max players per server', number: true },

  // --- Ratings ---
  likes: { get: (g) => g.ratings?.upVotes, desc: 'Likes (upvotes)', number: true, short: true, alias: 'upVotes' },
  upVotes: { get: (g) => g.ratings?.upVotes, desc: 'Likes (upvotes)', number: true, short: true },
  downVotes: { get: (g) => g.ratings?.downVotes, desc: 'Dislikes (downvotes)', number: true, short: true },
  favorites: { get: (g) => g.ratings?.favorites, desc: 'Favorite count', number: true, short: true },
  upVoteRatio: {
    get: (g) => g.ratings?.upVoteRatio,
    desc: 'Share of positive votes, 0-100',
    number: true,
    suffix: '%',
  },
  totalVotes: { get: (g) => g.ratings?.totalVotes, desc: 'Likes plus dislikes', number: true, short: true },

  // --- Creator ---
  creator: { get: (g) => g.creator?.name, desc: 'Owner name (user or group)' },
  creatorType: { get: (g) => g.creator?.type, desc: '"User" or "Group"' },
  creatorUrl: { get: (g) => g.creator?.url, desc: 'Link to the owner profile or group' },

  // --- Dates ---
  created: { get: (g) => g.created, desc: 'Creation date (ISO 8601)' },
  updated: { get: (g) => g.updated, desc: 'Last update date (ISO 8601)' },
};

export const FIELD_NAMES = Object.keys(FIELDS);

/** Fields that read best abbreviated, e.g. 245360 -> "245.4K". */
export const SHORT_BY_DEFAULT = new Set(
  Object.entries(FIELDS)
    .filter(([, f]) => f.short)
    .map(([name]) => name)
);

/**
 * Renders a value for display.
 *
 * modes:
 *   text   (default) escaped, human readable, auto-abbreviated where sensible
 *   short  forced abbreviation (245.4K)
 *   raw    the exact value, still escaped
 *   url    unescaped apart from quotes, for use inside src="..."
 */
export function renderValue(fieldName, value, mode = 'text') {
  const field = FIELDS[fieldName];

  if (value === null || value === undefined || value === '') return '';

  if (mode === 'url') {
    // Values are URLs. Escape only what could break out of an attribute.
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  if (mode === 'raw') {
    return escapeHtml(String(value));
  }

  if (field?.number) {
    let text =
      mode === 'short' || (mode === 'text' && SHORT_BY_DEFAULT.has(fieldName))
        ? abbreviate(value)
        : formatNumber(value);
    if (field.suffix) text += field.suffix;
    return text;
  }

  return escapeHtml(String(value));
}

const LOCALES = ['en-US'];

/** 64655032396 -> "64,655,032,396" */
export function formatNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString(LOCALES[0]);
}

/** 245360 -> "245.4K", 12709795 -> "12.7M" */
export function abbreviate(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const abs = Math.abs(num);
  if (abs >= 1e12) return trimZero(num / 1e12) + 'T';
  if (abs >= 1e9) return trimZero(num / 1e9) + 'B';
  if (abs >= 1e6) return trimZero(num / 1e6) + 'M';
  if (abs >= 1e4) return trimZero(num / 1e3) + 'K';
  // Below 10,000 the full number stays readable.
  return formatNumber(num);
}

function trimZero(n) {
  return n.toFixed(1).replace(/\.0$/, '');
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Reads a field off a game object, or undefined if it is not there. */
export function getField(game, name) {
  const field = FIELDS[name];
  if (!field) return undefined;
  return field.get(game);
}

/** The /fields payload, so clients can validate names before rendering. */
export function describeFields() {
  return Object.entries(FIELDS).map(([name, f]) => ({
    name,
    description: f.desc,
    type: f.number ? 'number' : 'string',
    abbreviates: Boolean(f.short),
  }));
}
