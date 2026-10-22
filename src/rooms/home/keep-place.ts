/**
 * Redraws a slot that holds one rail (Continue Watching) without losing the
 * person's place in it: the rail stays scrolled where it was, and focus in it
 * stays on the same title's card, or, when that card went (removed from the
 * row, or finished), the one that took its place. Otherwise a remote or
 * keyboard user removing a card was left with focus on nothing.
 */
export function redrawKeepingPlace(slot: HTMLElement, draw: () => void): void {
  const active = document.activeElement;
  const card = active instanceof HTMLElement && slot.contains(active) ? active.closest<HTMLElement>('[data-focus-id]') : null;
  const at = card ? [...slot.querySelectorAll<HTMLElement>('[data-focus-id]')].indexOf(card) : -1;
  const scrolled = slot.querySelector('.rail-track')?.scrollLeft ?? 0;
  draw();
  const track = slot.querySelector('.rail-track');
  if (track) track.scrollLeft = scrolled;
  if (!card) return;
  const cards = [...slot.querySelectorAll<HTMLElement>('[data-focus-id]')];
  const target = cards.find((other) => other.dataset.focusId === card.dataset.focusId) ?? cards[Math.min(at, cards.length - 1)];
  target?.focus();
}

/** What can take focus: not disabled, and not left out of the tab order (a rail's scroll arrows). */
const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), [tabindex="0"]';

/**
 * Hides a card on Home (`hide`) that holds focus (its close button), and
 * moves focus to the first thing shown below it, or else the banner's main
 * button, so a keyboard or remote user isn't left with focus on nothing.
 */
export function dismissKeepingFocus(card: HTMLElement, hide: () => void): void {
  const had = card.contains(document.activeElement);
  hide();
  if (!had) return;
  const shown = (el: Element | null): el is HTMLElement => el instanceof HTMLElement && !el.closest('[hidden]');
  let target: HTMLElement | null = null;
  for (let next = card.nextElementSibling; next && !target; next = next.nextElementSibling) {
    if (!shown(next)) continue;
    target = next.matches(FOCUSABLE) ? next : ([...next.querySelectorAll(FOCUSABLE)].find(shown) ?? null);
  }
  target ??= card.closest('.home')?.querySelector<HTMLElement>('[data-autofocus]') ?? null;
  target?.focus();
}
