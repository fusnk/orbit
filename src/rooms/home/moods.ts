/**
 * Mood rows ("Something short", "Late night"…): picked locally from titles
 * Home's catalogs already returned, plus the person's own history. Pure, so
 * the choices are testable; Home supplies the inputs (see row-render.ts).
 */
import { genreTags, type GenreTag as Tag } from '../../catalog/genre-tags';
import type { Title } from '../../catalog/titles';

export { genreTags };

// 'still-on-list' is the person's own saved titles; 'seasonal' is TMDB's list for the time of year (catalog/whats-new.ts).
export const MOODS = ['short', 'comfort', 'mind-bending', 'late-night', 'feel-good', 'hidden-gems', 'still-on-list', 'seasonal'] as const;
export type MoodId = (typeof MOODS)[number];

/** On by default for a new setup (existing Homes aren't changed). */
export const DEFAULT_MOODS: readonly MoodId[] = ['short', 'mind-bending', 'feel-good'];

/** The genres a mood draws on, for asking catalogs that filter by genre. */
export const MOOD_GENRES: Partial<Record<MoodId, readonly Tag[]>> = {
  'mind-bending': ['scifi', 'mystery'],
  'late-night': ['horror', 'thriller'],
  'feel-good': ['comedy', 'animation'],
};

/** "98 min", "1h 38min", "1h38m", "2 h" → minutes; null when unreadable. */
export function runtimeMinutes(runtime: string | undefined): number | null {
  if (!runtime) return null;
  const text = runtime.toLowerCase();
  const hours = /(\d+(?:\.\d+)?)\s*h/.exec(text);
  const minutes = /(\d+)\s*m/.exec(text);
  if (!hours && !minutes) {
    const bare = /^\s*(\d+)\s*$/.exec(text);
    return bare ? Number(bare[1]) : null;
  }
  const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  return total > 0 ? Math.round(total) : null;
}

/** A movie under this many minutes counts as short. */
const SHORT_MOVIE = 100;
/** A series whose episodes run up to this long counts as short. */
const SHORT_EPISODE = 30;
/** "Comfort rewatch": finished at least this long ago. */
const COMFORT_AGE_MS = 182 * 24 * 60 * 60 * 1000;
/** "Hidden gems": at least this IMDb rating… */
const GEM_RATING = 7.2;
/** …and never this high up in any catalog it appears in (catalogs list popular titles first). */
const GEM_RANK = 20;

export interface MoodInput {
  /** Titles from Home's catalogs, with their position in the catalog they came from (0 = first). */
  pool: readonly { title: Title; rank: number }[];
  /** Finished titles; `loved` when the person kept it (My Library, a list) or rated it. */
  finished: readonly { title: Title; finishedAt: number; loved: boolean }[];
  /** Titles the person has started or finished, left out of discovery moods. */
  seen: ReadonlySet<string>;
  now: number;
}

const rating = (title: Title) => {
  const value = Number.parseFloat(title.rating ?? '');
  return Number.isFinite(value) ? value : 0;
};

function matches(mood: MoodId, title: Title): boolean {
  const tags = genreTags(title.genres);
  switch (mood) {
    case 'short': {
      const minutes = runtimeMinutes(title.runtime);
      if (minutes === null) return false;
      return title.type === 'series' ? minutes <= SHORT_EPISODE : minutes < SHORT_MOVIE;
    }
    case 'mind-bending':
      // A mix: at least two of the three.
      return ['scifi', 'mystery', 'thriller'].filter((tag) => tags.has(tag as Tag)).length >= 2;
    case 'late-night':
      return tags.has('horror') || tags.has('thriller');
    case 'feel-good':
      return (tags.has('comedy') || tags.has('family') || tags.has('animation')) && !tags.has('horror') && !tags.has('thriller') && !tags.has('war');
    case 'hidden-gems':
      return rating(title) >= GEM_RATING;
    case 'comfort':
    case 'still-on-list':
    case 'seasonal':
      return false;
  }
}

/** "Still on your list": titles saved to My Library and never started, the longest-waiting first. */
export function stillOnList(saved: readonly { title: Title; addedAt: number }[], seen: ReadonlySet<string>, limit = 20): Title[] {
  return saved
    .filter((entry) => !seen.has(entry.title.id))
    .sort((a, b) => a.addedAt - b.addedAt)
    .slice(0, limit)
    .map((entry) => entry.title);
}

/** Up to `limit` titles for a mood, best first; empty when nothing fits (the row then hides). */
export function selectMood(mood: MoodId, input: MoodInput, limit = 20): Title[] {
  if (mood === 'comfort') {
    return input.finished
      .filter((f) => f.loved && input.now - f.finishedAt >= COMFORT_AGE_MS)
      .sort((a, b) => b.finishedAt - a.finishedAt)
      .slice(0, limit)
      .map((f) => f.title);
  }
  // One entry per title, at its best (lowest) position across catalogs.
  const best = new Map<string, { title: Title; rank: number; order: number }>();
  input.pool.forEach(({ title, rank }, order) => {
    const seen = best.get(title.id);
    if (!seen) best.set(title.id, { title, rank, order });
    else if (rank < seen.rank) seen.rank = rank;
  });
  const fits = [...best.values()].filter(({ title }) => !input.seen.has(title.id) && matches(mood, title));
  if (mood === 'hidden-gems') {
    return fits
      .filter((f) => f.rank >= GEM_RANK)
      .sort((a, b) => rating(b.title) - rating(a.title) || a.order - b.order)
      .slice(0, limit)
      .map((f) => f.title);
  }
  // Interleave catalogs by position, so one catalog doesn't fill the row.
  return fits
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map((f) => f.title);
}
