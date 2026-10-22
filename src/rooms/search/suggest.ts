/**
 * Titles for a natural-language search (catalog/search-intent.ts): what
 * TMDB finds for its filters, titles like the one it names, or a person's
 * titles, and the Discover grid "See in Discover" opens. Every list here
 * passed the content limit where it was loaded (catalog/tmdb.ts, and the
 * addons' search for words left over).
 */
import { normalize } from '../../catalog/search';
import { inYears, intentFilters, type IntentMedia, type SearchIntent } from '../../catalog/search-intent';
import { interleave } from '../../catalog/taste';
import { personDetails, recommendationsFor, searchPeople, searchTitles, tmdbSourcePage } from '../../catalog/tmdb';
import type { Title } from '../../catalog/titles';
import { t } from '../../i18n';
import type { GridSource, Kind, PageLoader } from '../explore/grid';

export interface Suggestions {
  titles: Title[];
  /** What the suggestions were found from ("Like Breaking Bad"), when not the search itself. */
  sub?: string | undefined;
  /** For a "like" search, the title it found by name. */
  seed?: string | undefined;
  /** Where "See in Discover" goes; none for words searched as a title. */
  grid?: GridSource | undefined;
}

/** The kinds to suggest: the search's own, else the chosen tab's, else both. */
function kindsFor(media: IntentMedia, tab: 'all' | Kind): Kind[] {
  if (media !== 'both') return [media];
  return tab === 'all' ? ['movie', 'series'] : [tab];
}

/** Today here, not in UTC (which is a day off in the evening or morning, depending on the zone), as "See in Discover" reads it. */
function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** A page that has everything there is (recommendations, a person's shows). */
const onePage = (titles: Title[], page: number) => ({ titles: page === 1 ? titles : [], done: true });

/** The title a "like" search names: TMDB's best match of that kind (an exact name first), else the addons'. */
async function seedTitle(name: string, media: IntentMedia, search: (query: string) => Promise<Title[]>): Promise<Pick<Title, 'id' | 'type' | 'name'> | undefined> {
  const fits = (kind: string) => media === 'both' || kind === media;
  const hits = ((await searchTitles(name).catch(() => null)) ?? []).filter((hit) => hit.imdbId && fits(hit.kind));
  const hit = hits.find((h) => normalize(h.name) === normalize(name)) ?? hits[0];
  if (hit?.imdbId) return { id: hit.imdbId, type: hit.kind, name: hit.name };
  return (await search(name)).find((title) => fits(title.type));
}

/**
 * Titles for `intent`, or null when there are none. `search` searches the
 * addons the way Search does (for "shows like …" and words left over).
 */
export async function suggestionsFor(intent: SearchIntent, query: string, tab: 'all' | Kind, search: (query: string) => Promise<Title[]>): Promise<Suggestions | null> {
  const eyebrow = t('search.suggestions.eyebrow');

  if (intent.kind === 'discover' && intent.text) {
    // Words that are a title, kept to the kind and years asked for: "batman movies from the 90s".
    const titles = (await search(intent.text)).filter((title) => (intent.media === 'both' || title.type === intent.media) && inYears(title, intent));
    return { titles };
  }

  if (intent.kind === 'discover') {
    const queries = new Map(
      kindsFor(intent.media, tab).flatMap((kind) => {
        const q = intentFilters(intent, kind, today());
        return q ? [[kind, q] as const] : [];
      }),
    );
    const kinds = [...queries.keys()];
    if (!kinds.length) return { titles: [] };
    const load: PageLoader = (kind, page) => {
      const q = queries.get(kind);
      return q ? tmdbSourcePage({ kind: 'discover', media: kind === 'movie' ? 'movie' : 'tv', sort: q.sort, filters: q.filters }, page) : Promise.resolve({ titles: [], done: true });
    };
    const pages = await Promise.all(kinds.map((kind) => load(kind, 1)));
    // Without a TMDB token there's nothing to suggest.
    if (pages.some((p) => p === null)) return null;
    return {
      titles: interleave(pages.map((p) => p?.titles ?? [])),
      grid: { title: query, eyebrow, kinds, load, discover: { filters: (kind) => queries.get(kind)?.filters ?? {}, sort: (kind) => queries.get(kind)?.sort ?? 'popularity.desc' } },
    };
  }

  if (intent.kind === 'like') {
    const seed = await seedTitle(intent.title, intent.media, search);
    if (!seed) return null;
    const recs = (await recommendationsFor(seed)) ?? [];
    const kinds = kindsFor(intent.media, tab);
    const titles = recs.filter((title) => kinds.includes(title.type as Kind));
    const sub = t('search.suggestions.like', { title: seed.name });
    const present = kinds.filter((kind) => titles.some((title) => title.type === kind));
    return { titles, sub, seed: seed.name, grid: { title: sub, eyebrow, kinds: present.length ? present : kinds, load: (kind, page) => Promise.resolve(onePage(titles.filter((title) => title.type === kind), page)) } };
  }

  const person = (await searchPeople(intent.name))?.[0];
  if (!person) return null;
  const kinds = kindsFor(intent.media, tab);
  // TMDB's discover finds a person's films; their shows come from their page.
  const shows = kinds.includes('series') ? personDetails(person.id).then((p) => (p?.knownFor ?? []).filter((title) => title.type === 'series')) : Promise.resolve([]);
  const load: PageLoader = async (kind, page) => (kind === 'movie' ? tmdbSourcePage({ kind: 'person', id: person.id, media: 'movie', sort: 'popularity.desc' }, page) : onePage(await shows, page));
  const pages = await Promise.all(kinds.map((kind) => load(kind, 1)));
  const sub = t('search.suggestions.with', { name: person.name });
  return { titles: interleave(pages.map((p) => p?.titles ?? [])), sub, grid: { title: person.name, eyebrow, kinds, load } };
}
