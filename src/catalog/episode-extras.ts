/**
 * Extras for a show's episode list from TMDB (needs a TMDB token): each
 * episode's rating, a season at a time, and the show's story arcs where
 * TMDB has them (long shows such as One Piece). Rust fetches and keeps both
 * for the session; this side checks their shape and keeps them too.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import type { Episode, Season, Title } from './titles';

const Count = v.pipe(v.number(), v.integer(), v.minValue(0));
const RatingSchema = v.object({ episode: Count, rating: v.pipe(v.number(), v.minValue(0), v.maxValue(10)), votes: Count });
const ArcSchema = v.object({ name: v.pipe(v.string(), v.maxLength(120)), episodes: v.pipe(v.array(v.object({ season: Count, episode: Count })), v.maxLength(5000)) });

export interface EpisodeRating {
  rating: number;
  votes: number;
}

export interface StoryArc {
  /** May be empty: the page then numbers it. */
  name: string;
  episodes: { season: number; episode: number }[];
}

const seasons = new Map<string, Promise<Map<number, EpisodeRating> | null>>();
const arcLists = new Map<string, Promise<StoryArc[] | null>>();

const isShow = (title: Pick<Title, 'id' | 'type'>) => /^tt\d+$/.test(title.id) && title.type === 'series';

/** The most lookups each cache keeps (as many as Rust keeps): the oldest goes first. */
const MAX_CACHED = 500;

/** Remembers a lookup for the session, unless it fails (then it's asked again next time). */
function cached<T>(cache: Map<string, Promise<T | null>>, key: string, fetch: () => Promise<T | null>): Promise<T | null> {
  let found = cache.get(key);
  if (!found) {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    found = fetch().catch((err: unknown) => {
      cache.delete(key);
      console.warn('No TMDB episode extras', err);
      return null;
    });
    cache.set(key, found);
  }
  return found;
}

/** TMDB's ratings for a season's episodes, by episode number; null without a TMDB token or for titles TMDB can't look up. */
export function seasonRatings(title: Pick<Title, 'id' | 'type'>, season: number): Promise<Map<number, EpisodeRating> | null> {
  if (!isShow(title) || !Number.isInteger(season) || season < 0) return Promise.resolve(null);
  return cached(seasons, `${title.id}:${season}`, async () => {
    const raw = await invoke<unknown>('tmdb_season_ratings', { imdbId: title.id, season });
    return raw === null ? null : new Map(v.parse(v.array(RatingSchema), raw).map(({ episode, rating, votes }) => [episode, { rating, votes }]));
  });
}

/** The show's story arcs (empty when TMDB has none); null without a TMDB token. */
export function storyArcs(title: Pick<Title, 'id' | 'type'>): Promise<StoryArc[] | null> {
  if (!isShow(title)) return Promise.resolve(null);
  return cached(arcLists, title.id, async () => {
    const raw = await invoke<unknown>('tmdb_story_arcs', { imdbId: title.id });
    return raw === null ? null : v.parse(v.array(ArcSchema), raw);
  });
}

export type RatingHeat = 'high' | 'mid' | 'low';

/** Green, yellow or red for an episode's rating. */
export const ratingHeat = (rating: number): RatingHeat => (rating >= 8 ? 'high' : rating >= 6.5 ? 'mid' : 'low');

export interface ArcView {
  name: string;
  /** The show's own episodes (from its addon), with their real season and number. */
  episodes: { season: number; episode: Episode }[];
}

/** Fewer of an arc list's episodes than this found in the show's own seasons, and it isn't offered (the two number episodes differently). */
const MIN_MATCHED = 0.5;

/**
 * TMDB's arcs over the show's own episodes, matched by season and episode
 * number, or else by the order they aired in (the Nth episode overall, specials
 * left out: TMDB numbers some shows, like One Piece, differently from their
 * addon); arcs with none of them are dropped. Null when neither lines up with
 * TMDB's or there's only one arc left.
 */
export function arcsFor(arcs: readonly StoryArc[], showSeasons: readonly Season[]): ArcView[] | null {
  const key = (ref: { season: number; episode: number }) => `${ref.season}:${ref.episode}`;
  const own = showSeasons.flatMap((s) => s.episodes.map((e) => ({ season: s.number, episode: e })));
  const byKey = new Map(own.map((ref) => [key({ season: ref.season, episode: ref.episode.number }), ref] as const));
  const bySeason = matchArcs(arcs, (ref) => byKey.get(key(ref)));
  if (bySeason) return bySeason;
  const byOrder = (a: { season: number; episode: number }, b: { season: number; episode: number }) => a.season - b.season || a.episode - b.episode;
  const aired = own.filter((ref) => ref.season > 0).sort((a, b) => byOrder({ season: a.season, episode: a.episode.number }, { season: b.season, episode: b.episode.number }));
  const listed = [...new Map(arcs.flatMap((arc) => arc.episodes).filter((ref) => ref.season > 0).map((ref) => [key(ref), ref] as const)).values()].sort(byOrder);
  const rank = new Map(listed.map((ref, index) => [key(ref), index] as const));
  return matchArcs(arcs, (ref) => {
    const index = rank.get(key(ref));
    return index === undefined ? undefined : aired[index];
  });
}

/** The arcs over the episodes `find` matches; null when fewer than MIN_MATCHED of them match or there's only one arc left. */
function matchArcs(arcs: readonly StoryArc[], find: (ref: { season: number; episode: number }) => ArcView['episodes'][number] | undefined): ArcView[] | null {
  let listed = 0;
  let matched = 0;
  const views: ArcView[] = [];
  for (const arc of arcs) {
    const episodes = arc.episodes.flatMap((ref) => {
      listed++;
      const found = find(ref);
      return found ? [found] : [];
    });
    matched += episodes.length;
    if (episodes.length) views.push({ name: arc.name, episodes });
  }
  return views.length >= 2 && matched >= listed * MIN_MATCHED ? views : null;
}

/** The arc holding an episode, or -1. */
export const arcIndexOf = (arcs: readonly ArcView[], season: number, episode: number) => arcs.findIndex((arc) => arc.episodes.some((e) => e.season === season && e.episode.number === episode));
