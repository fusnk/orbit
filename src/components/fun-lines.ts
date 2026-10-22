/**
 * Lines that change on their own (Settings → Appearance → Little extras):
 * a loading quip under the player's and the source search's progress, and
 * example searches in the empty search field. Each line shows once per round
 * in a shuffled order (lib/fun.ts), and changes with a short fade (none under
 * Reduce motion, fun.css).
 */
import { funPrefs } from '../app/fun-settings';
import { t, type MessageKey } from '../i18n';
import { h } from '../lib/dom';
import { createRotation } from '../lib/fun';
import '../app/fun.css';

const QUIPS = Array.from({ length: 16 }, (_, i) => `fun.quip.${i + 1}` as MessageKey);
const HINTS = Array.from({ length: 7 }, (_, i) => `fun.hint.${i + 1}` as MessageKey);
const QUIP_MS = 3000;
const HINT_MS = 3500;
/** How long a line is faded out while it changes (the fade itself is in fun.css). */
const SWAP_MS = 200;

/**
 * A quip line for a loading screen, or nothing with the switch off. It's
 * decoration, so screen readers skip it (the screen's own status says what's
 * happening). It stops for good once taken off the page, and rests while
 * `paused()` (e.g. the video has started under the loading screen).
 */
export function quipLine(className: string, paused: (line: HTMLElement) => boolean = () => false): HTMLElement | '' {
  if (!funPrefs().quips) return '';
  const next = createRotation(QUIPS.length);
  const line = h('span', { class: `loading-quip ${className}`, 'aria-hidden': 'true', dir: 'auto' }, t(QUIPS[next()]!));
  // Both loading screens attach the line as they're drawn, so one that's off the page at
  // a tick is gone (a screen closed within the first few seconds included) and stops here.
  const timer = window.setInterval(() => {
    if (!line.isConnected) return window.clearInterval(timer);
    if (paused(line)) return;
    swap(line, () => (line.textContent = t(QUIPS[next()]!)));
  }, QUIP_MS);
  return line;
}

/**
 * Cycles example searches through `input`'s placeholder while it's empty,
 * on the page, seen and not focused; the first is the field's own placeholder. The
 * search page is drawn once and kept, so this runs for as long as the app
 * (a cheap check every few seconds).
 */
export function rotateSearchHints(input: HTMLInputElement): void {
  const own = input.placeholder;
  const next = createRotation(HINTS.length);
  window.setInterval(() => {
    // The switch is read each time, so turning it off (or on) applies without a restart.
    if (!funPrefs().hints) {
      input.placeholder = own;
      return;
    }
    // Nor while the window is minimised or in the tray: the search page may be left showing there for days.
    if (document.hidden || !input.isConnected || input.value || document.activeElement === input || !input.offsetParent) return;
    swap(input, () => (input.placeholder = t(HINTS[next()]!)));
  }, HINT_MS);
}

function swap(el: HTMLElement, change: () => void): void {
  el.classList.add('fun-swap');
  window.setTimeout(() => {
    change();
    el.classList.remove('fun-swap');
  }, SWAP_MS);
}
