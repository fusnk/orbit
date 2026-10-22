/**
 * When a film's end screen shows and what it suggests (see end-screen.ts),
 * apart from the DOM so it can be tested.
 */
import type { Title } from '../../catalog/titles';
import { releasedAt } from '../../lib/air-date';
import type { Segment } from './skip';

/** Settings → Playback → When a film ends: 'next' (default) shows what's next, 'stop' lets the credits play out. */
export const FILM_END_KEY = 'playback.film-end';
export type FilmEnd = 'next' | 'stop';
export const parseFilmEnd = (value: unknown): FilmEnd => (value === 'stop' ? 'stop' : 'next');

/** This close to the end, Play starts over rather than playing the last moment. */
const LAST_FRAME_S = 0.5;

/**
 * Whether Play should start over from the beginning: at the end mpv holds the
 * last frame paused (keep-open), and unpausing there plays nothing.
 */
export function playsFromStart(status: { eof: boolean; timePos: number | null; duration: number | null }): boolean {
  return status.eof || (status.timePos !== null && !!status.duration && status.duration - status.timePos <= LAST_FRAME_S);
}

/**
 * A film that ended (and whose screen was set aside with "Watch credits") playing again from
 * before its end: no longer ended, so the screen can come back. Inside the credits it waits for
 * the end again ('credits'), as "Watch credits" there does; before them, for the credits.
 */
export function afterEnd<D extends 'credits' | 'end' | null>(state: { ended: boolean; dismissed: D; paused: boolean; timePos: number | null; duration: number | null; inCredits: boolean }): { ended: boolean; dismissed: D | 'credits' | null } {
  const { ended, dismissed, paused, timePos, duration, inCredits } = state;
  if (!ended || paused || timePos === null || !duration || timePos >= duration - 1) return { ended, dismissed };
  return { ended: false, dismissed: dismissed === 'end' ? (inCredits ? 'credits' : null) : dismissed };
}

/** One featured title and up to four smaller ones beside it. */
export const END_PICKS = 5;

/** Whether what plays is a film from an addon or server (not an episode, channel, catch-up, trailer, file from this PC or pasted link). */
export function isFilm(playing: { title: Pick<Title, 'type'>; episode?: unknown; live?: boolean | undefined; replay?: boolean | undefined; trailer?: boolean | undefined; local?: boolean | undefined; link?: boolean | undefined }): boolean {
  return playing.title.type === 'movie' && !playing.episode && !playing.live && !playing.replay && !playing.trailer && !playing.local && !playing.link;
}

/**
 * Whether a film's end screen is due: a film with nothing up next (the queue
 * has Next Up instead), once its credits start, or at the end when their time
 * isn't known. Never earlier: without credit times a fraction of the runtime
 * could cut into the last scene.
 */
export function endScreenDue(state: { film: boolean; upNext: boolean; started: boolean; ended: boolean; timePos: number | null; segments: readonly Segment[] }): boolean {
  if (!state.film || state.upNext || !state.started) return false;
  if (state.ended) return true;
  const credits = state.segments.find((segment) => segment.kind === 'credits');
  return !!credits && state.timePos !== null && state.timePos >= credits.start;
}

/**
 * Whether leaving a movie or episode counts as finishing it: a hand-off from
 * Next Up or the credits, any way out of a film's end screen (Play on a
 * pick, Details, Back), which only shows once the credits have started, or
 * leaving once they have (`inCredits`, see `creditsStarted`) with neither up:
 * autoplay off, "Let the credits play out", Back from Next Up's takeover.
 * Credits can start before the watched threshold (an anime's ending at 89 %).
 */
export const leavesFinished = (handedOff: boolean, endScreenUp: boolean, inCredits = false): boolean => handedOff || endScreenUp || inCredits;

/** Whether `timePos` is past where the closing credits (or the "next time" preview after them) start, when known. */
export const creditsStarted = (segments: readonly Segment[], timePos: number | null): boolean =>
  timePos !== null && segments.some((s) => (s.kind === 'credits' || s.kind === 'preview') && timePos >= s.start);

/** Whether a film's release date ("YYYY-MM-DD…") is known and has passed. */
const isOut = (released: string | undefined, now: number): boolean => {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(released ?? '')?.[0];
  const at = releasedAt(day);
  return !Number.isNaN(at) && at <= now;
};

/**
 * The film that follows `playingId` in its franchise (TMDB's parts, in
 * release order): the first later part that's out and not yet watched.
 * Undefined when the film isn't in `parts`, or nothing after it is out.
 */
export function nextInFranchise(parts: readonly Title[], playingId: string, watched: (title: Title) => boolean, now: number): Title | undefined {
  const at = parts.findIndex((part) => part.id === playingId);
  return at < 0 ? undefined : parts.slice(at + 1).find((part) => isOut(part.released, now) && !watched(part));
}

/**
 * What the screen suggests: the franchise's next film first, when there is
 * one, then TMDB's recommendations for the film (already within the
 * profile's content limit) in TMDB's order, without the film itself,
 * anything watched or in Continue Watching, or the same title twice.
 */
export function endPicks(recommended: readonly Title[], playingId: string, seen: (title: Title) => boolean, max = END_PICKS, next?: Title): Title[] {
  const picks: Title[] = next ? [next] : [];
  const ids = new Set([playingId, ...picks.map((title) => title.id)]);
  for (const title of recommended) {
    if (picks.length >= max) break;
    if (ids.has(title.id) || seen(title)) continue;
    ids.add(title.id);
    picks.push(title);
  }
  return picks;
}
