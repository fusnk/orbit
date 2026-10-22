/**
 * The launch ident (Settings → Appearance → Little extras → Launch
 * animation): the Orbit ring draws itself, the moon swings into place and
 * the wordmark settles, then it fades away, about 1.7 s in all. It sits over
 * the app while startup carries on underneath, so it never delays anything.
 *
 * Shown once per launch (a reload, e.g. after changing language, doesn't
 * replay it), never under Reduce motion, and never over the player. Any key
 * or click ends it at once. It's decoration, so it's hidden from screen
 * readers and takes no focus.
 */
import { h } from '../lib/dom';
import { reducedMotion } from '../theme/appearance';
import { funPrefs } from './fun-settings';
import { brandMark } from './titlebar';
import './fun.css';

/** sessionStorage outlives a reload of the window but not a restart of the app. */
const SHOWN_KEY = 'orbit.intro-shown';
/** The ident's own animations (fun.css), before it fades. */
const HOLD_MS = 1450;
const FADE_MS = 260;
const SKIP_FADE_MS = 120;

export function playLaunchIntro(overPlayer: () => boolean): void {
  if (!funPrefs().intro || reducedMotion() || overPlayer() || shownThisLaunch()) return;

  const mark = brandMark('launch-intro-mark');
  // A path length of 100 lets the CSS draw the ring with one dash.
  mark.querySelector('.wordmark-ring')?.setAttribute('pathLength', '100');
  const overlay = h('div', { class: 'launch-intro', 'aria-hidden': 'true' }, h('div', { class: 'launch-intro-ident' }, mark, h('span', { class: 'launch-intro-word' }, 'orbit')));
  document.body.append(overlay);

  let ended = false;
  const end = (fade: number) => {
    if (ended) return;
    ended = true;
    window.clearTimeout(timer);
    window.clearInterval(watch);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointer, true);
    overlay.classList.add('leaving');
    window.setTimeout(() => overlay.remove(), fade);
  };
  // The key or click that skips does only that; shortcuts with a modifier (Alt+F4…) still pass.
  const onKey = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
    }
    end(SKIP_FADE_MS);
  };
  const onPointer = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    end(SKIP_FADE_MS);
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPointer, true);
  const timer = window.setTimeout(() => end(FADE_MS), HOLD_MS);
  // Should anything open the player meanwhile, it isn't kept waiting behind the ident.
  const watch = window.setInterval(() => {
    if (overPlayer()) end(0);
  }, 100);
}

function shownThisLaunch(): boolean {
  try {
    if (sessionStorage.getItem(SHOWN_KEY)) return true;
    sessionStorage.setItem(SHOWN_KEY, '1');
  } catch {
    // Without storage it may show again after a reload; that's all.
  }
  return false;
}
