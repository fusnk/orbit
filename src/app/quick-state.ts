/**
 * What Quick settings' shortcut switches show and write, for settings that
 * are finer in Settings: trailers (two switches there, one here) and skipping
 * intros (a mode per kind of segment there, on/off here).
 */
import type { SkipModes } from '../rooms/player/skip';

/** Trailers on title pages and on banners: both on, both off, or one of each. */
export type TrailerState = 'on' | 'off' | 'mixed';

export function trailerState(hero: unknown, banner: unknown): TrailerState {
  const on = [hero === true, banner === true].filter(Boolean).length;
  return on === 2 ? 'on' : on === 0 ? 'off' : 'mixed';
}

/** "Skip intros automatically" is on when intros are skipped without asking. */
export const skipIntrosOn = (modes: SkipModes): boolean => modes.intro === 'auto';

/**
 * Turning it on skips intros and recaps (what comes before the episode)
 * without asking; turning it off brings back the Skip button for whichever
 * of them was automatic, and leaves one that's off alone. Credits and
 * previews keep their own choice.
 */
export function withSkipIntros(modes: SkipModes, on: boolean): SkipModes {
  const next = { ...modes };
  for (const kind of ['intro', 'recap'] as const) {
    if (on) next[kind] = 'auto';
    else if (next[kind] === 'auto') next[kind] = 'button';
  }
  return next;
}
