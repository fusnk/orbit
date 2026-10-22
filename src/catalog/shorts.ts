/**
 * Shorts' feed, kept pure so it's testable: which titles it holds and in
 * what order, which slides play, wait ready or let go of their video, and
 * where the feed goes when a title leaves it. The page is rooms/shorts.
 */
import { interleave } from './taste';
import type { Title } from './titles';

/** Titles in one feed: enough for a long scroll, few enough to stay light. */
export const FEED_SIZE = 60;

/** A YouTube id, as Rust's trailer lookup accepts one. */
const YOUTUBE_ID = /^[\w-]{11}$/;

/** The title's first trailer that's a YouTube id; undefined without one. */
export const trailerId = (title: Pick<Title, 'trailers'>): string | undefined => title.trailers?.find((id) => YOUTUBE_ID.test(id));

/** Why a title stays out of the feed. */
export interface FeedSkip {
  /** Watched or started: its trailer would only show what they've seen. */
  seen(title: Title): boolean;
  /** Not interested or thumbed down. */
  unwanted: ReadonlySet<string>;
}

/**
 * The feed: one title from each list in turn (popular movies, popular
 * shows, then the person's genres), each once, only movies and shows with
 * an IMDb id (what trailers are found by), none skipped, capped.
 */
export function buildFeed(lists: readonly (readonly Title[])[], skip: FeedSkip, limit = FEED_SIZE): Title[] {
  return interleave(lists, (title) => !/^tt\d+$/.test(title.id) || (title.type !== 'movie' && title.type !== 'series') || skip.unwanted.has(title.id) || skip.seen(title), limit);
}

/** What a slide does: plays (the one on screen), gets ready (the next), or holds no video. */
export type SlideRole = 'play' | 'preload' | 'off';

export function slideRole(index: number, current: number): SlideRole {
  if (index === current) return 'play';
  return index === current + 1 ? 'preload' : 'off';
}

/** The slide `step` away from `current`, kept within the feed's `count` slides (its last is the end card). */
export const stepTo = (current: number, step: number, count: number): number => Math.max(0, Math.min(count - 1, current + step));

/**
 * The feed without the title at `index`, and the slide on screen after:
 * the same place (now the next title) when it was at or before the one on
 * screen, else unchanged; never past the end.
 */
export function withoutAt<T>(feed: readonly T[], index: number, current: number): { feed: T[]; current: number } {
  if (index < 0 || index >= feed.length) return { feed: [...feed], current };
  const next = feed.filter((_, i) => i !== index);
  const moved = index < current ? current - 1 : current;
  // The end card follows the last title, so `next.length` is still a place to be.
  return { feed: next, current: Math.max(0, Math.min(moved, next.length)) };
}
