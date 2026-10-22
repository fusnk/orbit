import { icon } from '../../components/icons';
import { createSwitch } from '../../components/switch';
import { openPalette } from '../../app/palette';
import { RECENT_KEY } from '../../app/palette/model';
import type { Room } from '../../app/router';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { SETTING_SAVED } from '../../lib/ipc';
import { firstKey } from '../../lib/keymap';
import { createAddonsPanel } from '../addons';
import { downloadsPanel } from '../downloads/settings';
import { appearancePanel } from './appearance';
import { CATEGORIES, GROUPS, resolvePlace, SHOW_TAB, type CategoryInfo } from './categories';
import { affects, PREFS, type Pref } from './defaults';
import { compactRows } from './compact';
import { externalPlayerSection } from './external-player';
import { allShown, foldAdvanced, loadShowAll, setShowAll, unfold } from './fold';
import { generalPanel } from './general';
import { integrationsPanel } from './integrations';
import { libraryPanel } from './library';
import { watchSummaries } from './nav-summary-live';
import { playbackPanel, sourcePreferencesPanel } from './playback';
import { playerBehaviourPanel, playerLookPanel } from './player';
import { createProfileHeader } from './profile-header';
import { resetFooter } from './reset';
import { createSaveIndicator } from './save-indicator';
import { shortcutsPanel } from './shortcuts';
import { soundPanel, subtitlesPanel } from './subtitles';
import { videoPanel } from './video';
import './settings.css';
import { isAndroid } from '../../lib/platform';

/** Addons & Sources → Source preferences, with its own reset (the addons themselves are never reset). */
function sourcesTab(name: string): HTMLElement {
  const holder = h('div', {});
  const draw = () => holder.replaceChildren(sourcePreferencesPanel(), resetFooter('addons', name, draw));
  draw();
  return holder;
}

/** What each category's page holds, in order. */
const CONTENT: Record<string, (category: CategoryInfo) => HTMLElement[]> = {
  general: () => [generalPanel()],
  appearance: () => [appearancePanel()],
  'home-library': () => [libraryPanel()],
  playback: () => [playbackPanel()],
  // External players open as programs on a PC; Android would need its own app chooser.
  player: () => [playerLookPanel(), playerBehaviourPanel(), ...(isAndroid ? [] : [externalPlayerSection()])],
  subtitles: () => [subtitlesPanel()],
  'picture-sound': () => [h('div', {}, h('h3', { class: 'settings-subheading' }, t('settings.picture.heading')), videoPanel()), soundPanel()],
  // Its Reset is named for the tab: the addons themselves are never reset.
  addons: () => [createAddonsPanel({ id: 'sources', label: t('settings.sources.tab'), render: () => sourcesTab(t('settings.sources.tab')) })],
  accounts: () => [integrationsPanel()],
  downloads: () => [downloadsPanel()],
  shortcuts: () => [shortcutsPanel()],
};

/** Categories whose page ends in "Reset this section" (Addons has it on its Source preferences tab; Shortcuts has its own "Reset all"). */
const RESET_AT_FOOT = new Set(Object.keys(PREFS).filter((id) => id !== 'addons' && PREFS[id]!.some((pref) => pref.reset)));

/** The settings each category's page shows: its rows' (defaults.ts), and on Appearance the theme's too (its cards, accent, fonts, menu). */
const SHOWN_KEYS: Readonly<Record<string, readonly Pick<Pref, 'keys'>[]>> = { ...PREFS, appearance: [...(PREFS.appearance ?? []), { keys: ['theme'] }] };

let selectCategory: ((id: string, tab?: string) => void) | null = null;
let refreshHeader: (() => void) | null = null;
let refreshSummaries: (() => void) | null = null;
let pending: { category: string; tab?: string; section?: string } | null = null;

/**
 * Makes the next visit to Settings open on category `id` (e.g. the welcome
 * card's "Install an addon"), on `tab` if it has tabs, scrolled to the part
 * matching `section` (a selector) with focus on its first control, if given.
 * Ids from before the categories were regrouped still work (categories.ts).
 */
export function openSettingsTo(id: string, section?: string, tab?: string): void {
  pending = resolvePlace(id, tab, section);
}

/**
 * "Search settings": looks like a field, but it's a button that opens the
 * command palette limited to Settings, where the typing happens. Its key hint
 * is read when it's drawn and again on hover or focus, so a changed shortcut shows.
 */
function searchButton(): HTMLElement {
  const hint = h('kbd', { class: 'settings-search-key', dir: 'ltr' });
  const button = h('button', { class: 'settings-search', 'aria-haspopup': 'dialog' }, icon('search'), h('span', { class: 'settings-search-label' }, t('settingshome.search.button')), hint);
  const refresh = () => {
    const key = firstKey('app.palette');
    hint.textContent = key ?? '';
    hint.hidden = !key;
  };
  refresh();
  button.addEventListener('pointerenter', refresh);
  button.addEventListener('focus', refresh);
  button.addEventListener('click', () => openPalette({ scope: 'settings' }));
  return button;
}

/** "Show all settings": every row on every page, nothing under "More options". Per device. */
function showAllSwitch(): HTMLElement {
  const control = createSwitch(t('settings.show-all'), allShown(), setShowAll);
  control.classList.add('settings-show-all');
  void loadShowAll().then((on) => control.setAttribute('aria-checked', String(on)));
  return control;
}

export const settingsRoom: Room = {
  id: 'settings',
  label: t('settings.nav.title'),
  shortcut: 'app.settings',
  render(ctx) {
    const pane = h('section', { class: 'settings-pane' });
    // Beside each category's title; the one button moves with the page shown.
    const search = searchButton();
    const rendered = new Map<string, { body: HTMLElement; refresh(): void }>();

    /** Each category's line saying what it's set to (nav-summary.ts), filled in once read. */
    const summaries = new Map<string, HTMLElement>();
    const items = CATEGORIES.map((category) => {
      const label = h('span', { class: 'settings-nav-label', id: `settings-nav-${category.id}` }, t(category.label));
      const summary = h('span', { class: 'settings-nav-summary', id: `settings-nav-${category.id}-summary` });
      summaries.set(category.id, summary);
      // Named by its label alone; the summary is read after it, as its description.
      const item = h(
        'button',
        { class: 'settings-nav-item', 'data-category': category.id, 'aria-labelledby': label.id, 'aria-describedby': summary.id },
        h('span', { class: 'settings-nav-tile' }, icon(category.icon)),
        h('span', { class: 'settings-nav-text' }, label, summary),
      );
      item.addEventListener('click', () => select(category.id));
      return item;
    });
    refreshSummaries = watchSummaries((lines) => {
      for (const [id, summary] of summaries) {
        const line = lines[id] ?? '';
        summary.textContent = line;
        // The whole line on hover when it's cut short.
        summary.title = line;
      }
    });

    /** Where each category was scrolled to, so going back to one returns to the same place. */
    const scrolled = new Map<string, number>();
    let shown = '';

    /**
     * Pages whose settings were saved from somewhere else since they were
     * drawn (Quick settings, a Look, Theme Studio, the player…), so they'd
     * show old values: drawn again when shown.
     */
    const outdated = new Set<string>();
    /** Each page's height when last left, which a page drawn again keeps while its panels fill in, so its scroll position holds. */
    const heights = new Map<string, number>();

    /** Builds a category's page (again, after a reset) in the same element, so its folding carries on. */
    function fill(category: CategoryInfo, body: HTMLElement): void {
      const redraw = () => fill(category, body);
      outdated.delete(category.id);
      body.replaceChildren(...CONTENT[category.id]!(category), ...(RESET_AT_FOOT.has(category.id) ? [resetFooter(category.id, t(category.label), redraw)] : []));
    }

    /** Draws a kept page again, at its height (see `heights`) until another category is shown. */
    function drawAgain(id: string): void {
      const page = rendered.get(id)!;
      const height = id === shown && page.body.isConnected ? page.body.offsetHeight : heights.get(id);
      if (height) page.body.style.minHeight = `${height}px`;
      fill(CATEGORIES.find((c) => c.id === id)!, page.body);
      page.refresh();
    }

    /** Whether focus is on the Settings page, its own Reset dialog (which redraws the page itself) or nowhere: where a change already shows as it's made. */
    const focusOnPage = (): boolean => {
      const active = document.activeElement;
      return !(active instanceof HTMLElement) || active === document.body || room.contains(active) || !!active.closest('.settings-reset-layer');
    };

    document.addEventListener(SETTING_SAVED, (event) => {
      const key = (event as CustomEvent<string>).detail;
      const elsewhere = !focusOnPage();
      for (const id of rendered.keys()) {
        if (!SHOWN_KEYS[id]?.some((pref) => affects(pref, key))) continue;
        if (id !== shown) outdated.add(id);
        else if (elsewhere && !outdated.has(id)) {
          outdated.add(id);
          // Several settings are often saved together (a Look): drawn once, after them, unless focus is back on the page by then.
          window.setTimeout(() => shown === id && outdated.has(id) && !focusOnPage() && drawAgain(id), 100);
        }
      }
    });

    function select(id: string, tab?: string): void {
      const category = CATEGORIES.find((c) => c.id === id)!;
      // The page scrolls in the outlet, which every category shares.
      const scroller = pane.closest<HTMLElement>('.outlet');
      if (scroller && shown) scrolled.set(shown, scroller.scrollTop);
      const left = rendered.get(shown);
      if (left) {
        heights.set(shown, left.body.offsetHeight);
        left.body.style.removeProperty('min-height');
      }
      shown = id;
      items.forEach((item) => {
        const active = item.dataset.category === id;
        item.classList.toggle('active', active);
        if (active) item.setAttribute('aria-current', 'true');
        else item.removeAttribute('aria-current');
      });
      // Pages are kept once built, so their state survives switching categories.
      let page = rendered.get(id);
      if (!page) {
        const body = h('div', { class: 'settings-category', 'data-category': id });
        fill(category, body);
        // Choice rows become a value and a menu (compact.ts), whenever a panel draws or redraws them.
        compactRows(body);
        new MutationObserver(() => compactRows(body)).observe(body, { childList: true, subtree: true });
        page = { body, ...foldAdvanced(body, id) };
        rendered.set(id, page);
      } else if (outdated.has(id)) drawAgain(id);
      else page.refresh();
      if (tab) page.body.firstElementChild?.dispatchEvent(new CustomEvent(SHOW_TAB, { detail: tab }));
      // General opens on its own pictures, so it goes without the line saying what's in it.
      const lede = id === 'general' ? [] : [h('p', { class: 'settings-lede' }, t(category.intro))];
      pane.replaceChildren(h('header', { class: 'settings-head' }, h('h2', { class: 'settings-title' }, t(category.label)), search, ...lede), page.body);
      scroller?.scrollTo({ top: scrolled.get(id) ?? 0, behavior: 'instant' });
    }
    select('general');
    selectCategory = select;

    const header = createProfileHeader(ctx);
    refreshHeader = header.refresh;
    const room = h('div', { class: 'room settings' });
    const nav = h(
      'nav',
      { class: 'settings-nav', 'aria-label': t('settings.nav.categories') },
      ...GROUPS.map((group) =>
        h(
          'div',
          { class: 'settings-nav-group', role: 'group', 'aria-labelledby': `settings-group-${group.id}` },
          h('span', { class: 'settings-nav-heading', id: `settings-group-${group.id}` }, t(group.label)),
          ...items.filter((item) => CATEGORIES.find((c) => c.id === item.dataset.category)!.group === group.id),
        ),
      ),
    );
    room.append(
      h(
        'aside',
        // A region (spatial.ts): it stays put while a long category scrolls, so the page's Down mustn't land in it.
        { class: 'settings-sidebar', 'data-nav-region': true },
        // Long one-word names (German, Portuguese, Italian, Dutch) are set smaller to fit unbroken (settings.css).
        h('h1', { class: t('settings.nav.title').length > 10 ? 'page-title long' : 'page-title' }, t('settings.nav.title')),
        header.element,
        nav,
        showAllSwitch(),
        // The palette's recent picks are saved as it's used, not set by the person.
        createSaveIndicator(room, [RECENT_KEY]),
      ),
      pane,
    );
    return room;
  },
  onShow() {
    refreshHeader?.();
    refreshSummaries?.();
    const place = pending;
    pending = null;
    if (place && selectCategory) selectCategory(place.category, place.tab);
    const section = place?.section;
    // A frame later, so a panel that fills in from saved settings has drawn its controls.
    if (section)
      requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(`.settings-pane ${section}`);
        if (!target) return;
        unfold(target);
        target.scrollIntoView({ block: 'start' });
        // Prefer a control in its list over a section-wide one like Reset, so a stray Enter changes little.
        (target.querySelector<HTMLElement>('[data-focus-id]:not(:disabled)') ?? target.querySelector<HTMLElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
      });
  },
};

