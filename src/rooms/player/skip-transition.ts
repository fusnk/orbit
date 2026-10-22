/**
 * The smooth skip (Settings → Playback → Smooth skip): the picture fades to
 * black and the sound dips for a moment, the player seeks, and both fade
 * back in, with what was skipped named on the black. A bare jump in the
 * middle of a shot reads as a playback glitch; a short fade reads as a skip.
 *
 * The fade is a black layer over the video (the page sits above mpv); the
 * dip is mpv's own, ramped in Rust (src-tauri/src/player/dip.rs), which
 * always puts the sound back exactly. With Reduce motion on, the smooth skip
 * off, or on Android (where the video isn't under the page), a skip is the
 * instant jump it always was.
 */
import { invoke } from '@tauri-apps/api/core';
import { h } from '../../lib/dom';
import { isAndroid } from '../../lib/platform';
import { reducedMotion } from '../../theme/appearance';
import './skip-transition.css';

/** Fade to black, and back (keep in step with skip-transition.css). */
export const FADE_OUT_MS = 250;
export const FADE_IN_MS = 500;
/** How long to wait for the seek to land before fading back anyway. */
const LAND_WAIT_MS = 1500;
const POLL_MS = 50;
/** Close enough to where the seek was going to count as landed. */
const LANDED_WITHIN = 1.5;

const dip = (down: boolean, ms: number) => void invoke('player_audio_dip', { down, ms }).catch(() => {});

export function createSkipTransition(position: () => number | null) {
  const label = h('div', { class: 'skip-fade-label', role: 'status' });
  const element = h('div', { class: 'skip-fade' }, label);
  let smooth = true;
  /** Bumped by every skip and cancel: a skip overtaken stops where it is. */
  let run = 0;
  let timer: number | undefined;
  /** A skip is under way (until its fade back ends), and whether the sound is down or going down. */
  let active = false;
  let dipped = false;

  const fades = () => smooth && !isAndroid && !reducedMotion();

  function fadeBack(id: number): void {
    if (id !== run) return;
    element.classList.remove('on');
    dipped = false;
    dip(false, FADE_IN_MS);
    timer = window.setTimeout(() => {
      if (id !== run) return;
      active = false;
      label.textContent = '';
    }, FADE_IN_MS);
  }

  /** Waits (in playback, polled) for the seek to `to` to land, then fades back. */
  function whenLanded(id: number, to: number, since: number): void {
    if (id !== run) return;
    const at = position();
    if ((at !== null && Math.abs(at - to) <= LANDED_WITHIN) || Date.now() - since >= LAND_WAIT_MS) return fadeBack(id);
    timer = window.setTimeout(() => whenLanded(id, to, since), POLL_MS);
  }

  return {
    element,
    /** Settings → Playback → Smooth skip. */
    configure(on: boolean): void {
      smooth = on;
    },
    /** Whether a skip now fades (true), or jumps at once (false: the caller says what was skipped as before). */
    fades,
    /** Skips to `to` with `seek`, fading out and back as `fades()` allows, naming it `text`. */
    skip(to: number, text: string, seek: (seconds: number) => void): void {
      if (!fades()) return seek(to);
      window.clearTimeout(timer);
      const id = ++run;
      // A second skip during a fade goes on from the black that's already there.
      label.textContent = text;
      element.classList.add('on');
      if (!dipped) dip(true, FADE_OUT_MS);
      active = dipped = true;
      timer = window.setTimeout(() => {
        if (id !== run) return;
        seek(to);
        whenLanded(id, to, Date.now());
      }, FADE_OUT_MS);
    },
    /** The player is closing, or another file loading: no black left over, the sound back at once. */
    cancel(): void {
      run++;
      window.clearTimeout(timer);
      element.classList.remove('on');
      label.textContent = '';
      if (active) dip(false, 0);
      active = dipped = false;
    },
  };
}
