/**
 * A page's own "More …" group (General folds this way, rather than with
 * fold.ts's "More options" bar): a quiet bar that opens its rows under it, in
 * place. Open while "Show all settings" is on (fold.ts calls
 * `setDisclosures`), and whenever the palette or a link goes to something in
 * it (fold.ts `unfold`). Which are open is kept for the session, so a page
 * drawn again (a reset) keeps them open.
 */
import { icon } from '../../components/icons';
import { h } from '../../lib/dom';

/** Opened this session, by key. */
const opened = new Set<string>();
const drawn = new Set<{ el: HTMLElement; set(open: boolean): void }>();
let allOpen = false;

/** Opens (or closes) every disclosure on a kept page, and those drawn from now on; ones a redraw dropped are forgotten. */
export function setDisclosures(open: boolean): void {
  allOpen = open;
  for (const d of drawn) {
    if (d.el.closest('.settings-category')) d.set(open);
    else drawn.delete(d);
  }
}

/** Opens the disclosure `el` is in, if it is. */
export function openDisclosureOf(el: HTMLElement): void {
  for (const d of drawn) if (d.el.contains(el)) d.set(true);
}

/**
 * Shows the section (`selector`) `control` is in and focuses `control`: its disclosure opened first,
 * as General keeps the phone remote and Orbit Connect under "More general settings".
 */
export function showSection(control: HTMLElement, selector: string): void {
  openDisclosureOf(control);
  control.closest(selector)?.scrollIntoView({ block: 'start' });
  control.focus({ preventScroll: true });
}

export function disclosure(key: string, label: string, children: readonly HTMLElement[]): HTMLElement {
  const id = `settings-disclosure-${key}`;
  const toggle = h('button', { class: 'settings-disclosure-toggle', 'aria-expanded': 'false', 'aria-controls': id }, icon('chevronDown'), h('span', { class: 'settings-disclosure-label' }, label));
  const region = h('div', { class: 'settings-disclosure-body', id, role: 'region', 'aria-label': label }, ...children);
  const el = h('div', { class: 'settings-disclosure' }, toggle, region);
  const set = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    region.hidden = !open;
    if (open) opened.add(key);
    else opened.delete(key);
  };
  toggle.addEventListener('click', () => set(toggle.getAttribute('aria-expanded') !== 'true'));
  set(allOpen || opened.has(key));
  drawn.add({ el, set });
  return el;
}
