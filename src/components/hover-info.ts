/**
 * Hover info: resting the mouse on a poster for a moment shows a small panel
 * beside it with the title's rating, year, runtime, genres and overview.
 * Mouse only (keyboard and controller users have the title page a press
 * away); off in Settings → Appearance → Details on hover.
 */
import { VIEW_SHOWN } from '../app/router';
import { h } from '../lib/dom';
import { settings } from '../lib/ipc';
import { isRtl } from '../i18n';
import { loadMeta } from '../catalog/service';
import type { Title } from '../catalog/titles';
import { titleMeta } from './cards';

export const HOVER_INFO_KEY = 'browse.hover-info';
const DELAY_MS = 550;
const GAP = 12;
const WIDTH = 320;

let enabled = true;
void settings
  .get(HOVER_INFO_KEY)
  .then((v) => (enabled = v !== false))
  .catch(() => {});

export function setHoverInfo(on: boolean): void {
  enabled = on;
  if (!on) hide();
}

let panel: HTMLElement | undefined;
let timer: number | undefined;
/** The card the panel (or its pending timer) belongs to. */
let owner: HTMLElement | undefined;
/** Watches for the owner leaving the page while the panel shows. */
let removal: MutationObserver | undefined;

function hide(): void {
  window.clearTimeout(timer);
  timer = undefined;
  removal?.disconnect();
  removal = undefined;
  panel?.remove();
  panel = undefined;
  owner = undefined;
}

function show(card: HTMLElement, title: Title): void {
  hide();
  if (!card.isConnected) return;
  owner = card;
  draw(card, title);
  // A card that is removed or re-rendered under a resting mouse never gets a
  // pointerleave (rows refreshing, the router swapping the page out), so the
  // panel would stay behind on its own.
  removal = new MutationObserver(() => {
    if (!card.isConnected) hide();
  });
  removal.observe(document.body, { childList: true, subtree: true });
  // Some rows (Letterboxd, TMDB) carry just a name and year: the full details fill the panel in.
  if (!title.description) {
    const shown = panel;
    void loadMeta(title.type, title.id)
      .then((full) => {
        if (full && panel === shown && card.isConnected) draw(card, { ...title, ...full, name: title.name });
      })
      .catch(() => {});
  }
}

function draw(card: HTMLElement, title: Title): void {
  panel?.remove();
  const meta = titleMeta(title);
  panel = h(
    'div',
    { class: 'hover-info', role: 'tooltip' },
    h('span', { class: 'hover-info-title' }, title.name),
    meta.length ? h('div', { class: 'hover-info-meta' }, ...meta) : '',
    title.description ? h('p', { class: 'hover-info-desc' }, title.description) : '',
  );
  document.body.append(panel);
  // Beside the poster, after it in reading order when there's room, else on the other side; kept inside the window.
  const rect = card.getBoundingClientRect();
  const height = panel.getBoundingClientRect().height;
  const fitsRight = rect.right + GAP + WIDTH <= innerWidth - 8;
  const right = isRtl() ? fitsRight && rect.left - GAP - WIDTH < 8 : fitsRight;
  const left = right ? rect.right + GAP : Math.max(8, rect.left - GAP - WIDTH);
  const top = Math.min(Math.max(8, rect.top), innerHeight - height - 8);
  panel.style.setProperty('--x', `${left}px`);
  panel.style.setProperty('--y', `${top}px`);
}

/** Shows `title`'s details beside `card` while the mouse rests on it. */
export function withHoverInfo<T extends HTMLElement>(card: T, title: Title): T {
  card.addEventListener('pointerenter', (event) => {
    if (!enabled || event.pointerType !== 'mouse') return;
    hide();
    owner = card;
    timer = window.setTimeout(() => show(card, title), DELAY_MS);
  });
  card.addEventListener('pointerleave', hide);
  card.addEventListener('pointerdown', hide);
  return card;
}

// Anything that moves the page or leaves it takes the panel away.
document.addEventListener('scroll', hide, { capture: true, passive: true });
window.addEventListener('blur', hide);
document.addEventListener('keydown', hide, { capture: true });
// VIEW_SHOWN doesn't bubble, but capture still sees it on its way to the view.
document.addEventListener(VIEW_SHOWN, hide, { capture: true });
// Focus moving elsewhere (a menu opening, a page focusing its first control) means attention left the card.
document.addEventListener(
  'focusin',
  (event) => {
    if (owner && !(event.target instanceof Node && owner.contains(event.target))) hide();
  },
  { capture: true },
);
