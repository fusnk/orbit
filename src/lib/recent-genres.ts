/** How many recent genres the Movies / TV Shows filter offers as shortcuts. */
export const RECENT_GENRES = 3;

export const DEFAULT_RECENT_GENRES: readonly string[] = ['Action', 'Comedy', 'Horror'];

/** Recent genres from settings; the defaults when nothing usable was saved. */
export function parseRecentGenres(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_RECENT_GENRES];
  const names = value.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64);
  return names.length ? [...new Set(names)].slice(0, RECENT_GENRES) : [...DEFAULT_RECENT_GENRES];
}

/**
 * `recent` with `genre` added at the front, or unchanged when it's already
 * there: shortcuts don't reorder under the pointer when one is clicked.
 */
export function addRecentGenre(recent: readonly string[], genre: string): string[] {
  if (recent.includes(genre)) return [...recent];
  return [genre, ...recent].slice(0, RECENT_GENRES);
}
