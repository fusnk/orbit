/**
 * Fades a horizontal scroller's edges where there's more to scroll to, so a
 * row that runs off the page reads as "more this way" instead of being cut
 * off mid-poster. CSSOM classes only (see .scroll-fade in styles.css).
 */
import { VIEW_SHOWN } from '../app/router';
import { isShown } from '../lib/shown';
import { reducedMotion } from '../theme/appearance';

/** Rows that changed while their page was kept hidden (router.ts `keep`): updated when a view shows. */
const missed = new Set<() => void>();
let listening = false;

function missedWhileHidden(update: () => void): void {
  missed.add(update);
  if (listening) return;
  listening = true;
  // VIEW_SHOWN doesn't bubble, but capture still sees it on its way to the view.
  document.addEventListener(
    VIEW_SHOWN,
    () => {
      const pending = [...missed];
      missed.clear();
      for (const again of pending) again();
    },
    { capture: true },
  );
}

/** Scrolls a row a page toward its end (1) or its start (-1), whichever way the language reads. */
export function scrollRow(el: HTMLElement, dir: 1 | -1): void {
  const rtl = getComputedStyle(el).direction === 'rtl';
  el.scrollBy({ left: dir * (rtl ? -1 : 1) * el.clientWidth * 0.8, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

export function scrollFade<T extends HTMLElement>(el: T): T {
  const update = () => {
    // In a page kept hidden (router.ts `keep`), measuring the row would lay it out unseen: it's
    // looked at once its page shows. Its size doesn't change there, so nothing else would.
    if (el.isConnected && !isShown(el)) return missedWhileHidden(update);
    // Out of the page (a kept view while another shows) or hidden, the row measures 0 wide: keep the
    // fades it had. Clearing them here and setting them back on return made every row on a page
    // force its own style and layout pass when the page was shown again (~150 ms on Home).
    if (!el.clientWidth) return;
    // Right to left, scrollLeft runs from 0 down to negative values.
    const scrolled = Math.abs(el.scrollLeft);
    el.classList.toggle('more-before', scrolled > 4);
    el.classList.toggle('more-after', scrolled + el.clientWidth < el.scrollWidth - 4);
  };
  el.classList.add('scroll-fade');
  // Arrows from outside the row skip the cards scrolled out of it (spatial.ts).
  el.dataset.navScroller = '';
  el.addEventListener('scroll', update, { passive: true });
  // Cards arrive after the row is drawn, and the window resizes.
  new ResizeObserver(update).observe(el);
  new MutationObserver(update).observe(el, { childList: true });
  requestAnimationFrame(update);
  return el;
}
