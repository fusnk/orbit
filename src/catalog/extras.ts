/**
 * Extra ratings and logos for a title page: TMDB's score and the network or
 * studio logos (needs a TMDB token), and Letterboxd members' average (films
 * only, from Letterboxd's public page). Rust fetches both; each is optional.
 * The same TMDB request brings the Details facts and the Media row's videos
 * and images.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { language } from '../i18n';
import type { Title } from './titles';

const TmdbImage = v.pipe(v.string(), v.maxLength(300), v.startsWith('https://image.tmdb.org/'));
const MediaImageSchema = v.object({ thumb: TmdbImage, full: TmdbImage });

const STATUSES = ['released', 'returning', 'ended', 'canceled', 'in-production', 'post-production', 'planned', 'rumored', 'pilot'] as const;
const VIDEO_KINDS = ['trailer', 'teaser', 'clip', 'featurette', 'behind-the-scenes', 'bloopers', 'opening-credits', 'recap'] as const;
export type TitleStatus = (typeof STATUSES)[number];
export type VideoKind = (typeof VIDEO_KINDS)[number];

const VideoSchema = v.object({
  key: v.pipe(v.string(), v.regex(/^[\w-]{6,20}$/)),
  name: v.pipe(v.string(), v.maxLength(400)),
  kind: v.nullable(v.picklist(VIDEO_KINDS)),
});

/** A list from TMDB: entries that don't fit are dropped, not the whole list. */
const listOf = <T extends v.GenericSchema>(item: T, max: number) =>
  v.pipe(
    v.fallback(v.array(v.unknown()), []),
    v.transform((items) => items.flatMap((raw) => {
      const parsed = v.safeParse(item, raw);
      return parsed.success ? [parsed.output as v.InferOutput<T>] : [];
    }).slice(0, max)),
  );

const nullableNumber = v.fallback(v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(1e12))), null);

const ExtrasSchema = v.object({
  tmdb_id: v.fallback(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000_000))), null),
  rating: v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(10))),
  logos: v.array(v.object({ name: v.string(), logo: v.pipe(v.string(), v.startsWith('https://image.tmdb.org/')) })),
  name: v.fallback(v.nullable(v.pipe(v.string(), v.maxLength(300))), null),
  overview: v.fallback(v.nullable(v.pipe(v.string(), v.maxLength(2000))), null),
  votes: v.fallback(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
  status: v.fallback(v.nullable(v.picklist(STATUSES)), null),
  companies: listOf(v.pipe(v.string(), v.maxLength(160)), 3),
  language: v.fallback(v.nullable(v.pipe(v.string(), v.regex(/^[a-z]{2,3}$/))), null),
  genres: listOf(v.pipe(v.string(), v.maxLength(80)), 6),
  budget: nullableNumber,
  revenue: nullableNumber,
  videos: listOf(VideoSchema, 30),
  images: v.fallback(v.object({ backdrops: listOf(MediaImageSchema, 40), posters: listOf(MediaImageSchema, 40), logos: listOf(MediaImageSchema, 40) }), { backdrops: [], posters: [], logos: [] }),
});

export type MediaVideo = v.InferOutput<typeof VideoSchema>;
export type MediaImage = v.InferOutput<typeof MediaImageSchema>;

/** TMDB's facts for the Details list; empty without a TMDB token. */
export interface TitleFacts {
  status: TitleStatus | null;
  /** Studios (movies) or networks (shows). */
  companies: string[];
  /** The original language's ISO 639 code. */
  language: string | null;
  genres: string[];
  /** US dollars, movies only. */
  budget: number | null;
  revenue: number | null;
  /** TMDB's average and how many voted (the average only with enough votes). */
  rating: number | null;
  votes: number;
}

export interface TitleMedia {
  videos: MediaVideo[];
  backdrops: MediaImage[];
  posters: MediaImage[];
  logos: MediaImage[];
}

export interface TitleExtras {
  /** TMDB's id for the title (for links to TMDB and Letterboxd); null without a TMDB token. */
  tmdbId: number | null;
  /** TMDB, out of 10. */
  tmdb: number | null;
  /** Letterboxd, out of 5. */
  letterboxd: number | null;
  logos: { name: string; logo: string }[];
  /** The name and overview in Orbit's language, when it isn't English and TMDB has a translation. */
  name: string | null;
  overview: string | null;
  facts: TitleFacts | null;
  media: TitleMedia | null;
}

/** TMDB's and Letterboxd's scores for titles whose page was opened this session, for poster cards (components/poster-scores.ts). */
const seenScores = new Map<string, { tmdb: number | null; letterboxd: number | null }>();
const MAX_SEEN = 2000;
export const knownExtraScores = (id: string) => seenScores.get(id);

/** Titles' original languages (TMDB's code) seen this session, for the player's "Original language first". */
const seenLanguages = new Map<string, string | null>();

const hasExtras = (title: Pick<Title, 'id' | 'type'>) => /^tt\d+$/.test(title.id) && (title.type === 'movie' || title.type === 'series');

/** TMDB's answer for `title`, checked; null without a TMDB token or on failure. */
async function tmdbExtras(title: Pick<Title, 'id' | 'type'>): Promise<v.InferOutput<typeof ExtrasSchema> | null> {
  const parsed = v.safeParse(ExtrasSchema, await invoke<unknown>('tmdb_extras', { imdbId: title.id, kind: title.type }).catch(() => null));
  if (!parsed.success) return null;
  if (seenLanguages.size >= MAX_SEEN) seenLanguages.clear();
  seenLanguages.set(title.id, parsed.output.language);
  return parsed.output;
}

/** The language `title` was made in (TMDB's ISO 639 code): known from its page this session, else asked of TMDB; null if unknown. */
export async function originalLanguage(title: Pick<Title, 'id' | 'type'>): Promise<string | null> {
  if (!hasExtras(title)) return null;
  if (seenLanguages.has(title.id)) return seenLanguages.get(title.id) ?? null;
  return (await tmdbExtras(title))?.language ?? null;
}

export async function titleExtras(title: Pick<Title, 'id' | 'type'>): Promise<TitleExtras | null> {
  if (!hasExtras(title)) return null;
  const [found, letterboxd] = await Promise.all([
    tmdbExtras(title),
    // Letterboxd only lists films.
    title.type === 'movie' ? invoke<number | null>('letterboxd_rating', { imdbId: title.id }).catch(() => null) : Promise.resolve(null),
  ]);
  const scores = { tmdb: found?.rating ?? null, letterboxd: typeof letterboxd === 'number' && letterboxd >= 0.5 && letterboxd <= 5 ? letterboxd : null };
  if (seenScores.size >= MAX_SEEN) seenScores.clear();
  seenScores.set(title.id, scores);
  return {
    ...scores,
    tmdbId: found?.tmdb_id ?? null,
    logos: found?.logos ?? [],
    // Cinemeta's own text is English; TMDB's is only needed for other languages.
    name: found && language() !== 'en' ? found.name : null,
    overview: found && language() !== 'en' ? found.overview : null,
    facts: found && { status: found.status, companies: found.companies, language: found.language, genres: found.genres, budget: found.budget || null, revenue: found.revenue || null, rating: found.rating, votes: found.votes },
    media: found && { videos: found.videos, ...found.images },
  };
}
