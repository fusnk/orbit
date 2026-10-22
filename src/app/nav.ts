import { t } from '../i18n';
import { icon, type IconName } from '../components/icons';
import { h } from '../lib/dom';
import type { Room } from './router';
import { showShortcut } from '../lib/keymap';
import { arrangeItems, currentNavLayout, NAV_LAYOUT_CHANGED, type NavLayout } from '../theme/layout';
import './nav-layouts.css';

const ICONS: Record<string, IconName> = { home: 'home', movies: 'film', series: 'episodes', anime: 'star', explore: 'compass', live: 'tv', search: 'search', library: 'list', downloads: 'download', addons: 'addons' };

let pages: readonly { id: string; label: string }[] = [];
/** The nav's pages, with Orbit's names for them, in Orbit's order (Theme Studio lists them). */
export const navPages = () => pages;

/**
 * The page nav: a floating pill in the title bar, or a sidebar, icon rail or
 * dock (Theme Studio → Layout; nav-layouts.css draws each from the same
 * element). Only the active item is in the Tab order (roving tabindex);
 * arrow keys reach the rest through spatial navigation.
 */
export function createNav(allRooms: readonly Room[], onActivate: (id: string) => void) {
  // Search is the pill's round icon button, so by default it ends the row (and the Tab order).
  // Theme Studio still moves, renames and hides it like any other page.
  const rooms = [...allRooms.filter((room) => room.id !== 'search'), ...allRooms.filter((room) => room.id === 'search')];
  pages = rooms.map((room) => ({ id: room.id, label: room.label }));
  /** Pages hidden for a reason of their own (Live TV without a source), and by the person. */
  const autoHidden = new Set<string>();
  let userHidden = new Set<string>();
  const labels = new Map<string, string>();
  let activeId = '';

  const items = rooms.map((room) => {
    const label = h('span', { class: 'nav-label' }, room.label);
    const item = h('button', { class: 'nav-item', 'data-room': room.id }, icon(ICONS[room.id] ?? 'chevronRight'), label);
    const name = () => labels.get(room.id) ?? room.label;
    if (room.shortcut) showShortcut(item, name, room.shortcut);
    else {
      // A tooltip only where the name isn't shown (icons only): one that repeats the name
      // beside it adds nothing and covers the next item in a sidebar.
      const tip = () => {
        if (label.getBoundingClientRect().width > 1) item.removeAttribute('title');
        else item.title = name();
      };
      item.addEventListener('pointerenter', tip);
      item.addEventListener('focus', tip);
    }
    item.addEventListener('click', () => onActivate(room.id));
    return item;
  });

  /** One highlight that glides to the active item, rather than each item lighting up its own. */
  const indicator = h('span', { class: 'nav-indicator', 'aria-hidden': 'true' });
  const element = h('nav', { class: 'nav', 'aria-label': t('browse.nav.main') }, indicator, ...items);

  let placed = '';
  /**
   * Puts the indicator under the active item. It glides only for a page
   * change; anything else (a layout switch, a renamed or hidden item, the
   * nav reappearing) jumps, so it never sweeps in from where another layout
   * had it. Offsets within the nav hold in every layout, scrolled or RTL.
   */
  function placeIndicator(glide: boolean): void {
    const item = items.find((i) => i.dataset.room === activeId && !i.hidden);
    const where = item && item.offsetWidth > 0 ? `${item.offsetLeft},${item.offsetTop},${item.offsetWidth},${item.offsetHeight}` : '';
    // Unchanged (a resize that moved nothing): leave a glide in progress alone.
    if (where === placed) return;
    const jump = !glide || !placed || !where;
    placed = where;
    indicator.classList.toggle('jump', jump);
    if (item && where) {
      indicator.style.width = `${item.offsetWidth}px`;
      indicator.style.height = `${item.offsetHeight}px`;
      indicator.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
    }
    indicator.classList.toggle('shown', !!where);
    if (jump) {
      void indicator.offsetWidth; // lands without a transition before they come back
      indicator.classList.remove('jump');
    }
  }

  /**
   * A title bar too narrow for every page's name (960px with every page shown, or the history
   * chip out) shows the pill's icons only (`compact`, nav-layouts.css), rather than squeezing
   * Search or scrolling pages out of sight. Measured with the names, so they come back once
   * they fit. A frame later, so a resize it causes isn't reported in the same frame.
   */
  let fitting = 0;
  function fit(): void {
    fitting = 0;
    // The bar's sides take room from the pill (the history chip coming or going, Back showing).
    for (const side of [element.previousElementSibling, element.nextElementSibling]) if (side) resized.observe(side);
    element.classList.remove('compact');
    element.classList.toggle('compact', element.scrollWidth > element.clientWidth + 1);
  }
  const refit = () => void (fitting ||= requestAnimationFrame(fit));

  // Items change size with fonts, names and layouts, and the nav with the window.
  const resized = new ResizeObserver(() => {
    placeIndicator(false);
    refit();
  });
  for (const target of [element, ...items]) resized.observe(target);
  // A wider window doesn't resize a pill that already fits its icons, but may have room for the names again.
  window.addEventListener('resize', refit);
  // A switch to or from right to left mirrors the row without resizing anything.
  new MutationObserver(() => placeIndicator(false)).observe(document.documentElement, { attributeFilter: ['dir'] });

  function setActive(id: string): void {
    activeId = id;
    syncItems();
    placeIndicator(true);
  }

  function syncItems(): void {
    const id = activeId;
    const activeIsInNav = items.some((item) => item.dataset.room === id && !item.hidden);
    const first = element.querySelector('.nav-item:not([hidden])');
    items.forEach((item) => {
      const active = item.dataset.room === id;
      item.classList.toggle('active', active);
      // Keep one nav item tabbable even when a page outside the nav (Settings) is shown.
      item.tabIndex = active || (!activeIsInNav && item === first) ? 0 : -1;
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
  }

  const showHidden = () => {
    for (const item of items) item.hidden = autoHidden.has(item.dataset.room!) || userHidden.has(item.dataset.room!);
    syncItems();
    placeIndicator(false);
  };

  /** Hides an optional page's item (e.g. Anime). */
  function setHidden(id: string, hidden: boolean): void {
    if (hidden) autoHidden.add(id);
    else autoHidden.delete(id);
    showHidden();
  }

  /** The person's order, names and hidden pages. */
  function arrange(layout: NavLayout): void {
    const prefs = arrangeItems(layout.items, pages.map((p) => p.id));
    labels.clear();
    for (const pref of prefs) {
      const item = items.find((i) => i.dataset.room === pref.id)!;
      const name = pref.label ?? pages.find((p) => p.id === pref.id)!.label;
      if (pref.label) labels.set(pref.id, pref.label);
      item.querySelector('.nav-label')!.textContent = name;
      element.append(item);
    }
    userHidden = new Set(prefs.filter((p) => p.hidden).map((p) => p.id));
    showHidden();
  }
  /**
   * Beside the page (the sidebar and the icon rail), the nav is a region for the arrow keys (spatial.ts):
   * Up and Down in the page go row to row there instead of stepping into the nav level with them.
   */
  const besidePage = (layout: NavLayout) => element.toggleAttribute('data-nav-region', layout.position === 'sidebar' || layout.position === 'rail');
  arrange(currentNavLayout());
  besidePage(currentNavLayout());
  document.addEventListener(NAV_LAYOUT_CHANGED, (event) => {
    arrange((event as CustomEvent<NavLayout>).detail);
    besidePage((event as CustomEvent<NavLayout>).detail);
  });

  return { element, setActive, setHidden };
}
