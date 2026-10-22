/**
 * The jump bubble: pressing ←/→ (or the jump buttons) again and again builds
 * one "+30 s" on the side it goes to, instead of a flash per press. A press
 * the other way, or a pause between presses, starts a new count.
 */
import { icon } from '../../components/icons';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { formatNumber } from './format';

/** Presses closer together than this add up. */
export const GATHER_MS = 900;

/** The running total after a jump of `seconds`: added on in the same direction within the window, else a fresh start. */
export function gather(previous: { total: number; at: number } | null, seconds: number, now: number): number {
  if (previous && now - previous.at < GATHER_MS && Math.sign(previous.total) === Math.sign(seconds)) return previous.total + seconds;
  return seconds;
}

export function createSeekBubble() {
  let last: { total: number; at: number } | null = null;
  let hideTimer: number | undefined;
  const value = h('span', { class: 'seek-bubble-value' });
  const glyph = h('span', { class: 'seek-bubble-icon' });
  const element = h('div', { class: 'seek-bubble', 'aria-hidden': 'true', hidden: true }, glyph, value);

  return {
    element,
    /** A jump of `seconds` (negative is back) was asked for. */
    add(seconds: number): void {
      if (!seconds) return;
      const now = Date.now();
      const total = gather(last, seconds, now);
      const restart = !last || total === seconds;
      last = { total, at: now };
      element.hidden = false;
      element.classList.toggle('back', total < 0);
      glyph.replaceChildren(icon(total < 0 ? 'rewind' : 'forward'));
      value.textContent = t(total < 0 ? 'playerplus.bubble.back' : 'playerplus.bubble.ahead', { seconds: formatNumber(Math.abs(total)) });
      // A fresh count pops in; one being added to just pulses.
      element.classList.remove('pop', 'pulse');
      void element.offsetWidth;
      element.classList.add(restart ? 'pop' : 'pulse');
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        element.hidden = true;
        last = null;
      }, GATHER_MS);
    },
  };
}
