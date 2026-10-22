/**
 * A browsing card in the profile's card shape (Settings → Appearance → Card
 * shape): a poster, or a logo card with its "New episode" / "New season"
 * tag (its logo looked up when it's in a rail). Pages kept by the router redraw their cards in the new shape
 * when they're next shown; cards on screen at the change redraw at once.
 */
import { VIEW_SHOWN } from '../app/router';
import type { Title } from '../catalog/titles';
import { landscapeCard, posterCard, type CardOptions } from '../components/cards';
import { appearance, ROW_STYLE_CHANGED, type CardShape } from '../theme/appearance';
import { tagCard } from './home/card-tags';

/** Draws a card again, in the shape asked for. */
const remakes = new WeakMap<HTMLElement, (shape: CardShape) => HTMLElement>();

/**
 * `finish` adds what the page puts on every card (its menu, a focus id); it
 * runs again on a redraw, so the new card works like the old one.
 */
export function titleCard(title: Title, onOpen: () => void, options: CardOptions = {}, finish: (card: HTMLElement) => HTMLElement = (card) => card): HTMLElement {
  const make = (shape: CardShape) => {
    const card = shape === 'landscape' ? tagCard(landscapeCard(title, onOpen, { ...options, lookUpLogo: 'in-rail' }), title) : posterCard(title, onOpen, options);
    card.dataset.shape = shape;
    const done = finish(card);
    remakes.set(done, make);
    return done;
  };
  listen();
  return make(appearance().rowStyle);
}

/** Redraws the cards under `root` drawn in another shape than the setting's. */
function reshape(root: ParentNode): void {
  const shape = appearance().rowStyle;
  for (const card of root.querySelectorAll<HTMLElement>('[data-shape]')) {
    const make = remakes.get(card);
    if (!make || card.dataset.shape === shape) continue;
    const next = make(shape);
    // Where the keyboard starts on the page (router.ts), and the card that has it now.
    if (card.dataset.autofocus !== undefined) next.dataset.autofocus = '';
    const focused = card.contains(document.activeElement);
    card.replaceWith(next);
    if (focused) next.focus({ preventScroll: true });
  }
}

let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener(ROW_STYLE_CHANGED, () => reshape(document));
  // VIEW_SHOWN doesn't bubble, but capture still sees it on its way to the view.
  document.addEventListener(VIEW_SHOWN, (event) => event.target instanceof HTMLElement && reshape(event.target), { capture: true });
}
