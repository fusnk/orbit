/**
 * The Next Up bridge: when Next Up (its countdown, its card or the credits)
 * hands off to the next episode, the picture eases out to black, a blurred
 * still of that episode comes up with the show's logo and S · E, and once
 * the episode's first frame is showing the still dissolves into it. A hard
 * cut to the loading screen reads as the app reloading; this reads as the
 * show going on.
 *
 * It only covers the hand-off: the next episode is loaded at once, as
 * before, so when Next Up fires and when the episode left counts as watched
 * are unchanged (index.ts `load`). Like the smooth skip, it's a layer over
 * the video (the page sits above mpv), animating only opacity and transform,
 * so it stays on the compositor on a high refresh rate screen; the still is
 * blurred once, never per frame. With Reduce motion on, or on Android (where
 * the video isn't under the page), the loading screen shows as it always did.
 */
import type { Title } from '../../catalog/titles';
import { artImage } from '../../components/cards';
import { titleHeading } from '../../components/title-logo';
import { t } from '../../i18n';
import { episodeName, hiddenFor } from '../../library/spoilers';
import { episodeState } from '../../library/watch';
import { h } from '../../lib/dom';
import { isAndroid } from '../../lib/platform';
import { effectsReduced, reducedMotion } from '../../theme/appearance';
import type { EpisodeRef } from '../detail/title-actions';
import type { PlayRequest } from './index';
import './next-up-bridge.css';

/** The dissolve into the video (keep in step with next-up-bridge.css). */
const BRIDGE_OUT_MS = 800;
/** The still stays at least this long, so a fast start doesn't flash it. */
const MIN_HOLD_MS = 1600;
/** A slow start gives way to the loading screen (its spinner, its Cancel). */
const MAX_HOLD_MS = 6000;

/** The next episode's picture: its own, or the show's backdrop while spoiler protection blurs it (as on the Next Up card). */
export function episodeStill(title: Title, ref: EpisodeRef): string | undefined {
  const blurred = hiddenFor(episodeState(title, ref.season, ref.episode).kind).thumbnail;
  return blurred ? title.background : (ref.episode.thumbnail ?? title.background);
}

/** Its element goes straight inside the player view, above the loading screen. */
export function createNextUpBridge() {
  const still = h('div', { class: 'next-up-bridge-still' });
  const text = h('div', { class: 'next-up-bridge-text', role: 'status' });
  const element = h('div', { class: 'next-up-bridge', 'aria-hidden': 'true' }, h('div', { class: 'next-up-bridge-veil' }), still, h('div', { class: 'next-up-bridge-shade' }), text);
  /** Bumped by every hand-off and cancel: an older one's timers stop. */
  let run = 0;
  let active = false;
  let begunAt = 0;
  let timer: number | undefined;
  let maxTimer: number | undefined;

  function clear(): void {
    window.clearTimeout(timer);
    window.clearTimeout(maxTimer);
    element.parentElement?.classList.remove('bridging', 'bridge-leaving');
  }

  /** Dissolves into what's under it: the video once it shows, else the loading screen. */
  function leave(id: number): void {
    if (id !== run || !active) return;
    clear();
    element.parentElement?.classList.add('bridge-leaving');
    element.classList.add('leaving');
    element.classList.remove('on', 'instant');
    timer = window.setTimeout(() => {
      if (id !== run) return;
      active = false;
      element.parentElement?.classList.remove('bridge-leaving');
      element.classList.remove('leaving');
      still.replaceChildren();
      text.replaceChildren();
    }, BRIDGE_OUT_MS);
  }

  return {
    element,
    /**
     * Next Up is handing off to `next`. `instant`: the picture was in the
     * corner for the credits and is about to fill the window again, so the
     * black comes at once rather than fading over that jump.
     */
    begin(next: PlayRequest, instant: boolean): void {
      const ref = next.episode;
      if (!ref || isAndroid || reducedMotion() || next.live || next.trailer) return;
      clear();
      const id = ++run;
      active = true;
      begunAt = performance.now();
      const image = episodeStill(next.title, ref);
      still.replaceChildren(image ? artImage(image, 'next-up-bridge-art', true) : '');
      const hide = hiddenFor(episodeState(next.title, ref.season, ref.episode).kind);
      text.replaceChildren(
        h('span', { class: 'next-up-bridge-eyebrow' }, t('player.next-up.label')),
        titleHeading('span', 'next-up-bridge-show', next.title),
        h('span', { class: 'next-up-bridge-episode' }, t('player.episode.short-title', { season: String(ref.season), episode: String(ref.episode.number), title: episodeName(ref.episode.number, ref.episode.title, hide.title) })),
        h('span', { class: 'next-up-bridge-line', 'aria-hidden': 'true' }),
      );
      element.classList.remove('leaving');
      element.classList.toggle('instant', instant);
      element.classList.toggle('flat', effectsReduced());
      // The loading screen stays out of sight (and out of reach) behind the still.
      element.parentElement?.classList.add('bridging');
      // A frame first, so the layer starts from transparent and its transitions run.
      void element.offsetWidth;
      element.classList.add('on');
      maxTimer = window.setTimeout(() => leave(id), MAX_HOLD_MS);
    },
    /** The next episode's first frame is showing. */
    ready(): void {
      if (!active || !element.classList.contains('on')) return;
      const id = run;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => leave(id), Math.max(0, MIN_HOLD_MS - (performance.now() - begunAt)));
    },
    /** An error, a resume question, or the player closing: gone at once, so what's under it is seen. */
    cancel(): void {
      if (!active) return;
      run++;
      clear();
      active = false;
      element.classList.remove('on', 'instant', 'leaving');
      still.replaceChildren();
      text.replaceChildren();
    },
  };
}
