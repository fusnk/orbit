/** Search across every addon catalog that supports it. */
import type { UsableAddon } from '../addons/types';
import type { CatalogRef, Title } from './titles';

/** Movies and TV shows; "anime" is an anime addon's TV show (see `isShowType`). */
const SEARCH_TYPES = new Set(['movie', 'series', 'anime']);

/**
 * Catalogs that accept a `search` extra and need nothing else to be supplied.
 * Several catalogs of one addon may search the same index (e.g. per type),
 * so each is queried with its own type.
 */
export function searchableCatalogs(addons: readonly UsableAddon[]): CatalogRef[] {
  return addons.flatMap((addon) =>
    addon.manifest.catalogs
      .filter((catalog) => SEARCH_TYPES.has(catalog.type) && catalog.extra.some((e) => e.name === 'search'))
      .filter((catalog) => catalog.extra.every((e) => !e.isRequired || e.name === 'search'))
      .map((catalog) => ({ addon, catalog, extra: [] as [string, string][] })),
  );
}

/**
 * Merges result lists (already in the user's addon order) by id — IMDb ids
 * for Cinemeta-style addons — keeping the first addon's copy and noting every
 * addon that returned it.
 */
export function mergeResults(lists: readonly Title[][]): Title[] {
  const merged = new Map<string, Title>();
  for (const list of lists) {
    for (const title of list) {
      const existing = merged.get(title.id);
      if (!existing) merged.set(title.id, { ...title, origins: [...title.origins] });
      else {
        for (const origin of title.origins) {
          if (!existing.origins.some((o) => o.key === origin.key)) existing.origins.push(origin);
        }
      }
    }
  }
  return [...merged.values()];
}

export const MAX_RECENT = 8;

/** Recent searches as stored in settings; anything malformed is dropped. */
export function parseRecent(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((q): q is string => typeof q === 'string' && q.trim() !== '').slice(0, MAX_RECENT);
}

/** Puts `query` first, dropping an earlier copy (ignoring case) and the oldest past the limit. */
export function addRecent(recent: readonly string[], query: string): string[] {
  const q = query.trim();
  if (!q) return [...recent];
  return [q, ...recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
}

/**
 * One Search page's recent searches, loaded from `saved` (the setting and its
 * key) and saved with `save`. A change made before the list has loaded waits
 * for it: otherwise the load would replace the list and the save drop the change.
 */
export function recentSearches(saved: Promise<{ key: string; value: unknown }>, save: (key: string, list: string[]) => Promise<unknown>) {
  let list: string[] = [];
  const loaded = saved.then(({ key, value }) => {
    list = parseRecent(value);
    return key;
  });
  async function change(next: (current: string[]) => string[]): Promise<void> {
    const key = await loaded;
    list = next(list);
    await save(key, list);
  }
  return {
    get list(): readonly string[] {
      return list;
    },
    loaded: loaded.then(() => {}),
    add: (query: string) => change((current) => addRecent(current, query)),
    set: (next: string[]) => change(() => next),
  };
}

/**
 * Lowercase, without accents or punctuation, for comparing titles to a query.
 * Only Latin and Greek letters lose their accents: in other scripts the marks
 * are part of the word (Japanese ガ is not カ, Hindi vowel signs are letters),
 * and Korean syllables are put back together after NFD splits them.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/([\p{Script=Latin}\p{Script=Greek}])\p{M}+/gu, '$1')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

/** Leading articles a title may or may not be searched with ("The Matrix" as "matrix"). */
const ARTICLE = /^(?:the|a|an) /;
const withoutArticle = (text: string) => text.replace(ARTICLE, '');
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/**
 * How well `name` matches `query` (both normalized), best first:
 * 0 exact, 1 exact but for a leading "The/A/An", 2 starts with the query,
 * 3 has the query as a whole phrase, 4 has all its words in any order, 5 not really.
 */
function tierOf(name: string, query: string): number {
  if (!query) return 5;
  if (name === query) return 0;
  const bareName = withoutArticle(name);
  const bareQuery = withoutArticle(query);
  if (bareName === bareQuery) return 1;
  if (name.startsWith(query) || bareName.startsWith(bareQuery)) return 2;
  if (` ${name} `.includes(` ${query} `) || ` ${name} `.includes(` ${bareQuery} `)) return 3;
  // Chinese, Japanese and Thai don't put spaces between words, so a word can only be found inside the name.
  if (UNSPACED.test(query) && name.includes(query)) return 3;
  const words = new Set(name.split(' '));
  return bareQuery.split(' ').every((word) => words.has(word)) ? 4 : 5;
}

/**
 * A year at the start or end of a query ("dune 2021", "2021 dune"), and the
 * rest of it. Only plausible release years count, and only beside other
 * words: "2012" alone is a title, as is "Blade Runner 2049".
 */
export function queryYear(query: string, thisYear = new Date().getFullYear()): { rest: string; year: string } | null {
  const q = normalize(query);
  const match = /^(.+) (\d{4})$/.exec(q) ?? /^(\d{4}) (.+)$/.exec(q);
  if (!match) return null;
  const [rest, year] = /^\d{4}$/.test(match[2]!) ? [match[1]!, match[2]!] : [match[2]!, match[1]!];
  const n = Number(year);
  return n >= 1900 && n <= thisYear + 2 ? { rest, year } : null;
}

/**
 * A looser query to try once when a search finds nothing: without a year
 * ("dune 2021" as "dune"), else without accents and punctuation ("Amélie!"
 * as "amelie"). Null when it would be the same search again.
 */
export function lenientQuery(query: string, thisYear?: number): string | null {
  const loose = queryYear(query, thisYear)?.rest ?? normalize(query);
  return loose && loose !== query.trim().toLowerCase() ? loose : null;
}

/**
 * `search(query)`, and when it finds nothing, one more try with a looser
 * query (`lenientQuery`), ranked by what was typed so a year still counts.
 * Only once, so a search never floods the addons; and not when every addon
 * failed (offline, all timing out), which would only wait out the same
 * failure a second time.
 */
export async function searchLeniently<R extends { titles: readonly unknown[]; allFailed: boolean }>(query: string, search: (words: string, rankAs: string) => Promise<R>): Promise<R> {
  const found = await search(query, query);
  const loose = found.titles.length || found.allFailed ? null : lenientQuery(query);
  if (!loose) return found;
  const again = await search(loose, query);
  return again.titles.length ? again : found;
}

/** How well a title's name matches the query (see `tierOf`); a year in the query is tried both ways. */
export function matchTier(name: string, query: string, thisYear?: number): number {
  const n = normalize(name);
  const q = normalize(query);
  const split = queryYear(query, thisYear);
  return Math.min(tierOf(n, q), split ? tierOf(n, split.rest) : 5);
}

/**
 * Orders merged results by how well the title matches the query (`tierOf`).
 * A year in the query ("dune 2021") puts that year's matches first. Within a
 * tier, titles with a rating (known ones) come first, then those adding the
 * fewest words to the query: "game of thr" is completed by "Game of Thrones"
 * more than by "Game of Thrones: The Last Watch", which an addon may list
 * first. After that the addons' own order is kept, so an addon's loose
 * matches can't bury another addon's exact one.
 */
export function rankResults<T extends Pick<Title, 'name' | 'year'> & { rating?: string | undefined }>(titles: readonly T[], query: string, thisYear?: number): T[] {
  const q = normalize(query);
  if (!q) return [...titles];
  const year = queryYear(query, thisYear)?.year;
  const queryWords = withoutArticle(q).split(' ').length;
  return titles
    .map((title, index) => {
      const tier = matchTier(title.name, query, thisYear);
      // Only a title that matches the words gets the year's boost.
      const boosted = !!year && tier < 5 && title.year?.slice(0, 4) === year;
      const known = !!title.rating;
      const extra = withoutArticle(normalize(title.name)).split(' ').length - queryWords;
      return { title, index, tier, boosted, known, extra };
    })
    // A title named by the whole query ("Space: 1999") still comes before the year's boost.
    .sort(
      (a, b) =>
        Number(a.tier === 5) - Number(b.tier === 5) ||
        Number(a.tier > 1) - Number(b.tier > 1) ||
        Number(b.boosted) - Number(a.boosted) ||
        a.tier - b.tier ||
        // Titles that don't really match keep the addons' order.
        (a.tier < 5 ? Number(b.known) - Number(a.known) || a.extra - b.extra : 0) ||
        a.index - b.index,
    )
    .map((r) => r.title);
}
