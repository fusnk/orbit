import { onBack } from '../app/back';
import { isRtl } from '../i18n';
import { h } from '../lib/dom';
import { icon } from './icons';
import { pushLayer } from './layers';

export interface MenuItem {
  label: string;
  action(): void;
  /** A labelled group the item sits in, with the items next to it that share it. */
  group?: string;
  /** For a choice: whether it's the chosen one now (a check shows, and the menu opens on it). */
  checked?: () => boolean;
  /** Choosing it leaves the menu open, for one of several boxes to tick (with `checked`). */
  keepOpen?: boolean;
  /** A colour shown as a dot before the label. */
  swatch?: string;
  /** The typeface the label is shown in (a font choice). */
  font?: string;
}

interface Edges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const MARGIN = 8;

/**
 * Where a menu of `size` goes beside `anchor` (a button, or a point where all
 * four edges meet): below it, starting at its inline start edge (the right one
 * in a right-to-left layout), or lined up with its end edge for `align: 'end'`
 * (a value at the end of a row, so the menu opens over the row rather than
 * past it), above it when there's no room below, and always inside the window.
 */
export function placeMenu(anchor: Edges, gap: number, size: { width: number; height: number }, view: { width: number; height: number }, rtl: boolean, align: 'start' | 'end' = 'start'): { left: number; top: number } {
  const clamp = (value: number, max: number) => Math.max(MARGIN, Math.min(value, max));
  const fromRight = rtl !== (align === 'end');
  const left = clamp(fromRight ? anchor.right - size.width : anchor.left, view.width - size.width - MARGIN);
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const fitsBelow = below + size.height <= view.height - MARGIN;
  const top = !fitsBelow && above >= MARGIN ? above : clamp(below, view.height - size.height - MARGIN);
  return { left, top };
}

/**
 * A small popover menu (the ⋯ button, or right-click on a card). It's a modal
 * layer, so whatever is behind (the page, or a drawer it opened from) is
 * `inert` while it's open and arrow keys stay inside it; any click outside,
 * Back, or choosing an item closes it and focus returns to where it was.
 */
function open(anchor: Edges, gap: number, items: MenuItem[], opener?: HTMLElement, align: 'start' | 'end' = 'start'): void {
  const returnFocus = document.activeElement;
  const marks: (() => void)[] = [];
  const buttons = items.map((item) => {
    const role = !item.checked ? 'menuitem' : item.keepOpen ? 'menuitemcheckbox' : 'menuitemradio';
    const button = h('button', { class: 'menu-item', role }, item.label);
    if (item.swatch) {
      const dot = h('span', { class: 'menu-swatch', 'aria-hidden': 'true' });
      dot.style.setProperty('--swatch', item.swatch);
      button.prepend(dot);
    }
    if (item.font) button.style.fontFamily = item.font;
    if (item.checked) {
      button.append(icon('check'));
      marks.push(() => button.setAttribute('aria-checked', String(item.checked!())));
    }
    button.addEventListener('click', () => {
      if (!item.keepOpen) close();
      item.action();
      // Ticking one box can untick another (e.g. two rules that can't both be on).
      marks.forEach((mark) => mark());
    });
    return button;
  });
  marks.forEach((mark) => mark());
  // Named after the button that opened it (a menu at a point has none to borrow).
  const name = opener?.getAttribute('aria-label') || opener?.textContent?.trim();
  const menu = h('div', { class: 'menu', role: 'menu', ...(name ? { 'aria-label': name } : {}) });
  let group: HTMLElement | null = null;
  items.forEach((item, i) => {
    if (!item.group) {
      group = null;
      menu.append(buttons[i]!);
      return;
    }
    if (item.group !== items[i - 1]?.group) {
      group = h('div', { class: 'menu-group', role: 'group', 'aria-label': item.group }, h('div', { class: 'menu-group-label', 'aria-hidden': 'true' }, item.group));
      menu.append(group);
    }
    group!.append(buttons[i]!);
  });
  // Screen readers say the opener has a menu and whether it's open.
  opener?.setAttribute('aria-haspopup', 'menu');
  opener?.setAttribute('aria-expanded', 'true');

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    removeBack();
    removeLayer();
    document.removeEventListener('pointerdown', onOutside, true);
    menu.remove();
    opener?.setAttribute('aria-expanded', 'false');
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  }
  const removeBack = onBack(close);
  const onOutside = (event: PointerEvent) => {
    if (!menu.contains(event.target as Node)) close();
  };
  document.addEventListener('pointerdown', onOutside, true);

  // A value's choices are never narrower than the value they open from, so the two read as one.
  if (opener && align === 'end') menu.style.minWidth = `max(220px, ${Math.ceil(anchor.right - anchor.left)}px)`;
  document.body.append(menu);
  const { width, height } = menu.getBoundingClientRect();
  const at = placeMenu(anchor, gap, { width, height }, { width: innerWidth, height: innerHeight }, isRtl(), align);
  menu.style.left = `${at.left}px`;
  menu.style.top = `${at.top}px`;
  const removeLayer = pushLayer(menu, close);
  (buttons.find((b) => b.getAttribute('aria-checked') === 'true') ?? buttons[0])?.focus({ preventScroll: true });
}

/** Opens the menu at a point (e.g. where the user right-clicked). */
export function openMenu(at: { x: number; y: number }, items: MenuItem[]): void {
  open({ left: at.x, right: at.x, top: at.y, bottom: at.y }, 0, items);
}

/** Opens the menu below an anchor element (e.g. the ⋯ button), from its start edge or, with `align: 'end'`, its end edge. */
export function openMenuFrom(anchor: HTMLElement, items: MenuItem[], align: 'start' | 'end' = 'start'): void {
  open(anchor.getBoundingClientRect(), 8, items, anchor, align);
}

/**
 * Wires right-click, the keyboard Menu key and Shift+F10 on `el` to a menu,
 * so the context menu is reachable without a mouse.
 */
export function withContextMenu<T extends HTMLElement>(el: T, items: () => MenuItem[]): T {
  // A card with a menu shows its ⋯ quick action (components/card-actions.ts).
  el.dataset.hasMenu = '';
  el.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openMenu({ x: event.clientX, y: event.clientY }, items());
  });
  el.addEventListener('keydown', (event) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      // Taken: not also a shortcut someone bound to the key (main.ts), or a menu on what holds this item.
      event.stopPropagation();
      const rect = el.getBoundingClientRect();
      openMenu({ x: isRtl() ? rect.right - 16 : rect.left + 16, y: rect.top + 16 }, items());
    }
  });
  return el;
}
