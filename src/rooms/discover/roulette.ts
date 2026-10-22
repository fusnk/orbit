/**
 * Surprise Me's roulette (Settings → Appearance → Little extras): before the
 * pick is shown, posters from the same pool spin past and slow to a stop on
 * it, in about 2.3 s. A click or any key (but Esc, which closes the drawer)
 * skips to the end. The pick itself is already chosen (catalog/surprise.ts);
 * this only presents it. Callers skip it under Reduce motion.
 *
 * The reel runs right to left, and left to right in a right-to-left
 * interface, always ending with the pick in the centre slot.
 */
import '../../app/fun.css';
import { fallbackHue, type Title } from '../../catalog/titles';
import { artImage, withHue } from '../../components/cards';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { rouletteReel } from '../../lib/fun';

const REEL_LENGTH = 18;
/** Card width plus the gap between cards (fun.css). */
const CARD = 120;
const STEP = CARD + 12;
const SPIN_MS = 2300;
/** A beat on the pick before it's drawn, so the stop registers. */
const REST_MS = 150;

/** Spins in `container` (replacing what's there); resolves once it has stopped or was skipped. */
export async function spinRoulette(container: HTMLElement, pick: Title, others: readonly Title[]): Promise<void> {
  const rtl = getComputedStyle(container).direction === 'rtl';
  const reel = rouletteReel(pick, others, REEL_LENGTH);
  if (rtl) reel.reverse();
  const track = h(
    'div',
    { class: 'roulette-track', dir: 'ltr' },
    ...reel.map((title) => withHue(h('div', { class: 'roulette-card' }, title.name, title.poster ? artImage(title.poster, 'art', true) : ''), fallbackHue(title.id))),
  );
  const view = h('div', { class: 'roulette', 'aria-hidden': 'true' }, h('div', { class: 'roulette-window' }, track), h('p', { class: 'roulette-skip muted' }, t('fun.roulette.skip')));
  container.replaceChildren(view);

  const centre = (track.parentElement!.clientWidth - CARD) / 2;
  const far = centre - (reel.length - 1) * STEP;
  const [from, to] = rtl ? [far, centre] : [centre, far];
  const spin = track.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration: SPIN_MS, easing: 'cubic-bezier(0.1, 0.55, 0.12, 1)', fill: 'forwards' });

  const skip = () => spin.finish();
  const onKey = (event: KeyboardEvent) => {
    // Once the drawer has closed, keys belong to the page again.
    if (!view.isConnected) return skip();
    if (event.key === 'Escape' || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    skip();
  };
  view.addEventListener('pointerdown', skip);
  document.addEventListener('keydown', onKey, true);
  try {
    await spin.finished;
    await new Promise((resolve) => window.setTimeout(resolve, REST_MS));
  } catch {
    // Cancelled (the drawer closed under it): nothing left to show.
  } finally {
    document.removeEventListener('keydown', onKey, true);
  }
}
