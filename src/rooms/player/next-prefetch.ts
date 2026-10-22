/**
 * Finds the next episode's sources early, so Next Up (and Next) can start it
 * straight away instead of asking the addons when the card appears.
 *
 * - When: 60% into the episode, or 3 minutes before its end credits start
 *   (when their time is known), whichever comes first.
 * - At most once per episode playing (another source of the same episode
 *   keeps what was found), so addons and debrid services aren't asked again
 *   and again.
 * - Only the next episode of the show playing, not a queued item (which may
 *   be meant for the picker), and not while autoplay is off.
 * - Dropped (and its requests cancelled) when what's next changes or another
 *   title or episode starts.
 *
 * The sources are ranked when found; which one plays is still picked at the
 * hand-off (see next-up-controller.ts `playNext`), so a source that failed in
 * the meantime is passed over as usual.
 */
import { sameUpNext, type UpNext } from './next-up';

/** How far into an episode its next one's sources are looked up. */
export const PREFETCH_AT = 0.6;
/** Or this long (seconds) before the end credits start, if that's sooner. */
export const PREFETCH_BEFORE_CREDITS_S = 180;

/** Whether it's time to look up the next episode's sources. */
export function prefetchDue(timePos: number | null, duration: number | null, creditsStart?: number): boolean {
  if (timePos === null || !duration || duration <= 0) return false;
  if (timePos / duration >= PREFETCH_AT) return true;
  return creditsStart !== undefined && creditsStart > 0 && timePos >= creditsStart - PREFETCH_BEFORE_CREDITS_S;
}

export interface Fetched<T> {
  next: UpNext;
  found: Promise<T>;
  /** Cancels the lookup (its addon requests). */
  abort: AbortController;
}

export function createPrefetch<T>(find: (next: UpNext, signal: AbortSignal) => Promise<T>) {
  let ahead: Fetched<T> | undefined;
  /** The episode playing whose next one has been looked up (once is enough). */
  let doneFor: string | undefined;

  const drop = () => {
    ahead?.abort.abort();
    ahead = undefined;
  };

  return {
    /**
     * Called with each position update. `playing` names the episode playing,
     * `next` is what plays after it, `allowed` is false while nothing should
     * play next by itself (autoplay off, a sleep timer, Next Up dismissed).
     */
    check(state: { playing: string; next: UpNext | undefined; allowed: boolean; timePos: number | null; duration: number | null; creditsStart?: number | undefined }): void {
      // What's next changed (shuffle, the queue): what was found is for something else.
      if (ahead && !sameUpNext(ahead.next, state.next)) drop();
      if (doneFor === state.playing || !state.allowed || state.next?.kind !== 'episode') return;
      if (!prefetchDue(state.timePos, state.duration, state.creditsStart)) return;
      doneFor = state.playing;
      const abort = new AbortController();
      ahead = { next: state.next, found: find(state.next, abort.signal), abort };
    },
    /** Hands over what was found for `next`, if anything was (only once); anything found for something else is dropped. */
    take(next: UpNext): Fetched<T> | undefined {
      const taken = ahead && sameUpNext(ahead.next, next) ? ahead : undefined;
      if (!taken) drop();
      ahead = undefined;
      return taken;
    },
    /** Another file starts. Another source of the same episode keeps the lookup; anything else drops it. */
    newFile(sameEpisode: boolean): void {
      if (sameEpisode) return;
      drop();
      doneFor = undefined;
    },
  };
}
