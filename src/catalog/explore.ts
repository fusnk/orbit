/**
 * Discover (the "explore" page): its sections and their saved order, and
 * the tables its tiles browse by (TMDB genres, original languages, awards,
 * countries). Kept free of the page so it can be tested; the taste side
 * (what the person likes) is taste.ts.
 */
import * as v from 'valibot';
import type { MessageKey } from '../i18n';
import { settings } from '../lib/ipc';
import { profileSetting } from '../library/profiles';
import type { Award } from './tmdb';

/** Discover's own sections, in their default order. */
export const SECTIONS = [
  'featured',
  'surprise',
  'queue',
  'in-cinemas',
  'new-to-stream',
  'airing-week',
  'upcoming',
  'genres',
  'top-rated',
  'languages',
  'award-winning',
  'awards',
  'top-genre',
  'country',
  'services',
  'genre-mix',
  'actor',
  'gems',
  'critics',
  'seasonal',
  'collections',
  'letterboxd-top',
] as const;
export type SectionId = (typeof SECTIONS)[number];

/** Letterboxd's public list behind the built-in Letterboxd row. */
export const LETTERBOXD_TOP = { owner: 'official', slug: 'letterboxds-top-500-films' } as const;

/** A Letterboxd list the person added, shown as a section with this id. */
export const listSectionId = (list: { owner: string; slug: string }) => `lb:${list.owner}/${list.slug}`;

export interface ExploreLayout {
  /** Section ids in the chosen order (unsaved ones keep their default place). */
  order: string[];
  hidden: string[];
}

const LAYOUT_KEY = 'explore.layout';
/** Dispatched on `document` when the layout or the added lists change. */
export const EXPLORE_CHANGED = 'orbit:explore-changed';
/** More than every built-in section plus every list that can be added. */
const MAX_IDS = 80;
const SectionIdText = v.pipe(v.string(), v.maxLength(260));

/** A saved layout, keeping only well-formed ids (it can come from a hand-edited backup). */
export function parseLayout(value: unknown): ExploreLayout {
  const saved = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const ids = (list: unknown) => [...new Set(Array.isArray(list) ? list.filter((id): id is string => v.is(SectionIdText, id)) : [])].slice(0, MAX_IDS);
  return { order: ids(saved.order), hidden: ids(saved.hidden) };
}

export async function exploreLayout(): Promise<ExploreLayout> {
  return parseLayout((await profileSetting(LAYOUT_KEY)).value);
}

export async function saveExploreLayout(layout: ExploreLayout): Promise<void> {
  await settings.set((await profileSetting(LAYOUT_KEY)).key, parseLayout(layout));
  document.dispatchEvent(new Event(EXPLORE_CHANGED));
}

/** TMDB's movie genres Discover browses by, with the matching TV genre (none where TV lacks one). */
export const GENRES = [
  { key: 'action', movie: 28, tv: 10759, hue: 8 },
  { key: 'adventure', movie: 12, tv: 10759, hue: 32 },
  { key: 'animation', movie: 16, tv: 16, hue: 190 },
  { key: 'comedy', movie: 35, tv: 35, hue: 48 },
  { key: 'crime', movie: 80, tv: 80, hue: 350 },
  { key: 'documentary', movie: 99, tv: 99, hue: 150 },
  { key: 'drama', movie: 18, tv: 18, hue: 275 },
  { key: 'family', movie: 10751, tv: 10751, hue: 95 },
  { key: 'fantasy', movie: 14, tv: 10765, hue: 300 },
  { key: 'history', movie: 36, tv: null, hue: 30 },
  { key: 'horror', movie: 27, tv: null, hue: 0 },
  { key: 'music', movie: 10402, tv: null, hue: 320 },
  { key: 'mystery', movie: 9648, tv: 9648, hue: 250 },
  { key: 'romance', movie: 10749, tv: null, hue: 335 },
  { key: 'scifi', movie: 878, tv: 10765, hue: 205 },
  { key: 'thriller', movie: 53, tv: null, hue: 225 },
  { key: 'war', movie: 10752, tv: 10768, hue: 70 },
  { key: 'western', movie: 37, tv: 37, hue: 25 },
] as const;
export type GenreKey = (typeof GENRES)[number]['key'];

export const GENRE_LABELS: Record<GenreKey, MessageKey> = {
  action: 'explore.genre.action',
  adventure: 'explore.genre.adventure',
  animation: 'explore.genre.animation',
  comedy: 'explore.genre.comedy',
  crime: 'explore.genre.crime',
  documentary: 'explore.genre.documentary',
  drama: 'explore.genre.drama',
  family: 'explore.genre.family',
  fantasy: 'explore.genre.fantasy',
  history: 'explore.genre.history',
  horror: 'explore.genre.horror',
  music: 'explore.genre.music',
  mystery: 'explore.genre.mystery',
  romance: 'explore.genre.romance',
  scifi: 'explore.genre.scifi',
  thriller: 'explore.genre.thriller',
  war: 'explore.genre.war',
  western: 'explore.genre.western',
};

export const genreOf = (key: GenreKey) => GENRES.find((g) => g.key === key)!;

/** Genre names as addons (Cinemeta) and TMDB write them, folded, to Discover's genres. */
const GENRE_NAMES: Record<string, GenreKey> = {
  action: 'action',
  'action & adventure': 'action',
  adventure: 'adventure',
  animation: 'animation',
  anime: 'animation',
  comedy: 'comedy',
  crime: 'crime',
  documentary: 'documentary',
  drama: 'drama',
  family: 'family',
  kids: 'family',
  fantasy: 'fantasy',
  history: 'history',
  horror: 'horror',
  music: 'music',
  musical: 'music',
  mystery: 'mystery',
  romance: 'romance',
  'sci-fi': 'scifi',
  'science fiction': 'scifi',
  'sci-fi & fantasy': 'scifi',
  thriller: 'thriller',
  war: 'war',
  'war & politics': 'war',
  western: 'western',
};

/** Discover's genre for a genre name a title lists, if it has one. */
export const genreKeyOf = (name: string): GenreKey | undefined => (Object.hasOwn(GENRE_NAMES, name.trim().toLowerCase()) ? GENRE_NAMES[name.trim().toLowerCase()] : undefined);

/** The genre filter of a streaming service's page (src-tauri/src/tmdb.rs `GENRES`) closest to a Discover genre. */
export function serviceGenre(key: GenreKey, kind: 'movie' | 'series' = 'movie'): string | undefined {
  const same = ['action', 'comedy', 'drama', 'crime', 'scifi', 'horror', 'thriller', 'romance', 'mystery', 'animation', 'documentary', 'family'];
  const found = same.includes(key) ? key : key === 'adventure' ? 'action' : key === 'fantasy' ? 'scifi' : undefined;
  // TMDB has no TV genre for these (a service page refuses them for shows).
  return kind === 'series' && (found === 'horror' || found === 'thriller' || found === 'romance') ? undefined : found;
}

/** Original languages Discover browses by, each with its own name in its own script. */
export const LANGUAGES = [
  { code: 'ko', native: '한국어', hue: 215 },
  { code: 'ja', native: '日本語', hue: 350 },
  { code: 'es', native: 'Español', hue: 25 },
  { code: 'fr', native: 'Français', hue: 230 },
  { code: 'zh', native: '中文', hue: 5 },
  { code: 'hi', native: 'हिन्दी', hue: 35 },
  { code: 'de', native: 'Deutsch', hue: 50 },
  { code: 'it', native: 'Italiano', hue: 140 },
  { code: 'pt', native: 'Português', hue: 160 },
  { code: 'tr', native: 'Türkçe', hue: 0 },
] as const;

/** Awards Discover browses by, with the category it follows. */
export const AWARD_TILES: { key: Award; name: MessageKey; category: MessageKey; hue: number }[] = [
  { key: 'oscars', name: 'explore.award.oscars', category: 'explore.award.best-picture', hue: 45 },
  { key: 'golden-globes', name: 'explore.award.golden-globes', category: 'explore.award.best-film', hue: 40 },
  { key: 'bafta', name: 'explore.award.bafta', category: 'explore.award.best-film', hue: 30 },
  { key: 'emmys', name: 'explore.award.emmys', category: 'explore.award.drama-series', hue: 260 },
  { key: 'cannes', name: 'explore.award.cannes', category: 'explore.award.palme', hue: 150 },
  { key: 'venice', name: 'explore.award.venice', category: 'explore.award.golden-lion', hue: 20 },
  { key: 'berlinale', name: 'explore.award.berlinale', category: 'explore.award.golden-bear', hue: 0 },
];

/** Countries whose films "{Country} films" rotates through, one a day. */
export const COUNTRIES = ['IT', 'FR', 'KR', 'JP', 'ES', 'DE', 'GB', 'IN', 'BR', 'MX', 'SE', 'DK'] as const;
/** A country for each interface language other than English: its own films come first. */
const LANGUAGE_COUNTRIES: Record<string, string> = { es: 'ES', fr: 'FR', pt: 'BR', de: 'DE', it: 'IT', nl: 'NL', pl: 'PL', cs: 'CZ', sv: 'SE', id: 'ID', ru: 'RU', uk: 'UA', ar: 'EG', he: 'IL' };

/** Days since 1970 in UTC, so a daily pick changes at the same moment everywhere it's shown. */
export const dayNumber = (now: number) => Math.floor(now / 86_400_000);

/** The country of the day: the interface language's, or the rotation's. */
export function countryOfDay(language: string, now: number): string {
  return LANGUAGE_COUNTRIES[language] ?? COUNTRIES[dayNumber(now) % COUNTRIES.length]!;
}

/** "YYYY-MM-DD" `years` before `now`, for "released since" filters. */
export function yearsAgo(now: number, years: number): string {
  const date = new Date(now);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}
