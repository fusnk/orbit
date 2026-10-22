/**
 * The command palette (Ctrl+K): one field that finds titles across addons,
 * the person's own things, Settings, addons and actions, and runs the chosen
 * one. It's opened by an explicit shortcut, so its field is ready for typing
 * at once (like choosing Search). Keyboard-first: ↑/↓ move, Enter runs,
 * Tab/Shift+Tab or Ctrl+↑/↓ jump between groups, Escape closes; the mouse
 * works too.
 *
 * It's a modal layer, so it closes on Back, a click outside, and when the
 * page changes. Everything shown that came from an addon (titles, addon
 * names) goes in as text, never markup.
 */
import { onBack } from '../back';
import { canPlayLink, linkIn, linkLine, openTorrentSetting, playLink } from '../play-link';
import { toggleHistoryPause } from '../quick-settings';
import { startRemote } from '../remote-status';
import { connectState, startConnect } from '../connect-state';
import { chooseDeviceToControl } from '../connect-ui';
import { playTargets } from '../../lib/connect';
import { errorText } from '../../components/state-message';
import { reportError } from '../errors';
import type { Room, RoomContext } from '../router';
import { list as installedAddons } from '../../addons/registry';
import type { InstalledAddon } from '../../addons/types';
import { mergeResults, rankResults, searchableCatalogs } from '../../catalog/search';
import { allowedTitles, verdictNow } from '../../catalog/parental';
import { loadCatalog, usableAddons } from '../../catalog/service';
import { isShowType, type CatalogRef, type Title } from '../../catalog/titles';
import { parseTitleRef, resolveTitleRef } from '../../catalog/title-ref';
import { icon, type IconName } from '../../components/icons';
import { pushLayer } from '../../components/layers';
import { beginEditing } from '../../components/text-field';
import { toast } from '../../components/toast';
import { t, type MessageKey } from '../../i18n';
import { en } from '../../i18n/locales/en';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { firstKey, keyLabel } from '../../lib/keymap';
import type { PastedLink } from '../../lib/pasted-link';
import { allDownloads } from '../../library/downloads';
import { libraryEntries } from '../../library/library';
import { customLists, type CustomList } from '../../library/lists';
import { customCollections } from '../../library/collections';
import { historyPaused } from '../../library/history-pause';
import { activeProfileId, profileSetting } from '../../library/profiles';
import { queueItems } from '../../library/queue';
import { fromSnapshot, snapshot } from '../../library/snapshot';
import { continueWatching, recentlyWatched } from '../../library/watch';
import { titleHandlers } from '../../rooms/detail/open';
import { createListPage } from '../../rooms/lists/lists';
import { createCollectionPage } from '../../rooms/collections/page';
import { createCollectionsPage } from '../../rooms/collections/overview';
import { createImportPage } from '../../rooms/collections/import';
import { openProfileSwitcher } from '../../rooms/profiles/picker';
import { searchNextFor } from '../../rooms/search';
import { openSettingsTo } from '../../rooms/settings';
import { dependentParent } from '../../rooms/settings/dependent-rows';
import { showSection } from '../../rooms/settings/disclosure';
import { unfold } from '../../rooms/settings/fold';
import { addRecent, candidate, GROUP_LIMITS, orderGroups, parseRecentEntry, parseRecents, rankGroups, RECENT_KEY, recentsFor, TITLES_RANK, withQueuedRecents, type Candidate, type GroupId, type Recent } from './model';
import { currentSettingId, SETTINGS_CATEGORIES, SETTINGS_ENTRIES, SHORTCUT_ENTRIES, SHORTCUT_ITEMS, shortcutDetail, type SettingsEntry } from './settings-index';
import { openThemeStudio } from '../../rooms/studio';
import { openTonight } from '../../rooms/tonight';
import './palette.css';

export interface PaletteHost {
  ctx: RoomContext;
  /** `root`: the page's own view, not a title page left open on it. */
  go(id: string, options?: { root?: boolean }): void;
  /** Pages it can go to: the nav's, then Settings. */
  rooms: readonly Room[];
  /** Whether an optional page (Anime, Live TV, Downloads) is in the nav right now. */
  shown(id: string): boolean;
}

interface Item {
  key: string;
  label: string;
  detail?: string;
  icon: IconName;
  run(): void;
  /** What to remember when it's picked; none for things that can't be found again. */
  recent?: () => Recent | null;
}

interface ShownGroup {
  id: GroupId;
  best: number;
  items: Item[];
  /** A line under the heading, e.g. "Searching your addons…". */
  note?: string;
}

const GROUP_LABELS: Record<GroupId, MessageKey> = {
  recent: 'palette.group.recent',
  suggested: 'palette.group.suggested',
  yours: 'palette.group.yours',
  titles: 'palette.group.titles',
  settings: 'palette.group.settings',
  addons: 'palette.group.addons',
  actions: 'palette.group.actions',
};

const PAGE_ICONS: Partial<Record<string, IconName>> = { explore: 'compass', search: 'search', movie: 'film', series: 'episodes', anime: 'star', live: 'tv', library: 'list', downloads: 'download', addons: 'addons', settings: 'sliders' };
const SUGGESTED = ['page:search', 'page:library', 'action:profile', 'action:shortcuts', 'page:settings'];
const DEBOUNCE_MS = 250;
/** Addon searches start at two characters: one matches nearly everything and costs every addon a request. */
const MIN_TITLE_QUERY = 2;
/** How long a jump into Settings waits for the page to draw what it points at. */
const REVEAL_MS = 2000;
/** Recently watched titles beyond this many aren't offered (the list is only for finding things fast). */
const MAX_WATCHED = 200;
/** Searching only Settings, there's room for more of them than beside titles and actions. */
const SETTINGS_SCOPE_LIMITS = { ...GROUP_LIMITS, settings: 14 };

let host: PaletteHost | null = null;
let closeOpen: (() => void) | null = null;
/** Settings never change while the window is open (a new language reloads it), so they're indexed once, on first open. */
let settingsIndex: Candidate<Item>[] | null = null;
let recents: Recent[] | null = null;
/** Picks made before `recents` was read, oldest first: saved with them once it is. */
let queuedRecents: Recent[] = [];
/** Where they're saved: the profile's own copy (profiles.rs `PROFILE_SETTINGS`). */
let recentsKey = RECENT_KEY;
const saveRecents = () => void settings.set(recentsKey, recents).catch((err: unknown) => console.warn('Could not save recent palette picks', err));
let profile: string | null | undefined;

export function installPalette(next: PaletteHost): void {
  host = next;
}

/** Opens the palette, or closes it if it's open (its shortcut toggles it). */
export function togglePalette(): void {
  if (closeOpen) closeOpen();
  else if (host) open(host);
}

export interface PaletteOptions {
  /** Starts with this already typed. */
  query?: string;
  /** 'settings': only Settings is searched (Settings → Search settings); everything else works as usual. */
  scope?: 'settings';
}

/** Opens the palette (afresh, if it's open), e.g. limited to Settings. */
export function openPalette(options: PaletteOptions = {}): void {
  closeOpen?.();
  if (host) open(host, options);
}

/** Matches people's typing in English as well as the interface's language (most keywords are the same everywhere). */
function keywords(key: MessageKey): string {
  // (A joke language draws in English but its words aren't English: compare the words.)
  const text = t(key);
  return text === en[key] ? text : `${text} ${en[key]}`;
}

// ── Going places ──

/**
 * Opens Settings on `category` (and `tab`), then waits (a few frames, as panels
 * fill in from saved settings) for `find` to locate a part of it and hands that to `act`.
 */
function openSettingsAt(category: string, find?: (pane: Element) => HTMLElement | null | undefined, act: (el: HTMLElement) => void = reveal, tab?: string): void {
  openSettingsTo(category, undefined, tab);
  host?.go('settings');
  if (!find) return;
  const until = performance.now() + REVEAL_MS;
  const tick = () => {
    const pane = document.querySelector('.settings-pane');
    if (!pane) return;
    const found = find(pane);
    if (found) act(found);
    else if (performance.now() < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const FOCUSABLE = '[data-focus-id]:not(:disabled), button:not(:disabled), input:not(:disabled), [tabindex="0"]';

/** Scrolls to a row or section and focuses its first control (for a heading, the first one after it). */
function reveal(el: HTMLElement): void {
  el.scrollIntoView({ block: 'start' });
  let target = el.querySelector<HTMLElement>(FOCUSABLE);
  for (let next = el.nextElementSibling; !target && next && next.matches(':not(h2, h3)'); next = next.nextElementSibling) {
    target = next.matches(FOCUSABLE) ? (next as HTMLElement) : next.querySelector<HTMLElement>(FOCUSABLE);
  }
  target?.focus({ preventScroll: true });
}

/**
 * A row folded under "More options" opens its group first. A row that only
 * shows after another choice (e.g. the Next Up countdown while autoplay is
 * Never) can't be focused: go to the row that reveals it instead, and say
 * what to change.
 */
function revealSetting(el: HTMLElement): void {
  unfold(el);
  // A row can be hidden on its own, or with others in one container (Discord's options): either has the parent.
  const hiddenBy = el.closest<HTMLElement>('[hidden]');
  const parent = hiddenBy ? (dependentParent(el) ?? dependentParent(hiddenBy)) : undefined;
  if (!parent) return reveal(el);
  unfold(parent);
  reveal(parent);
  const name = (row: HTMLElement) => row.querySelector('.setting-label')?.textContent ?? '';
  toast(t('palette.setting-hidden', { setting: name(el), parent: name(parent) }));
}

const byText = (pane: Element, selector: string, text: string) => [...pane.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent === text);

function findEntry(entry: SettingsEntry, label: string) {
  return (pane: Element) => {
    if (entry.find === 'row') return byText(pane, '.setting-label', label)?.closest<HTMLElement>('.setting-row');
    if (entry.find === 'heading') return byText(pane, '.settings-subheading', label);
    return pane.querySelector<HTMLElement>(entry.find);
  };
}

/** Presses a button the page draws, as if chosen there (the addons panel's own actions). */
const press = (el: HTMLElement) => {
  el.scrollIntoView({ block: 'nearest' });
  if (!(el as HTMLButtonElement).disabled) el.click();
};

// ── What it offers ──

function settingsCandidates(): Candidate<Item>[] {
  const out: Candidate<Item>[] = [];
  for (const category of SETTINGS_CATEGORIES) {
    const label = t(category.label);
    out.push(
      candidate(
        'settings',
        `setting:${category.id}`,
        { key: `setting:${category.id}`, label, detail: t('palette.kind.category'), icon: 'sliders', run: () => openSettingsAt(category.id), recent: () => ({ kind: 'setting', id: category.id }) },
        label,
        keywords(category.keywords),
      ),
    );
  }
  for (const entry of SETTINGS_ENTRIES) {
    const category = SETTINGS_CATEGORIES.find((c) => c.id === entry.category)!;
    const label = t(entry.label);
    const categoryLabel = t(category.label);
    out.push(
      candidate(
        'settings',
        `setting:${entry.id}`,
        {
          key: `setting:${entry.id}`,
          label,
          // Edited in Theme Studio: straight there, at its place.
          detail: entry.studio ? t('studio.title') : t('palette.kind.setting', { category: categoryLabel }),
          icon: entry.studio ? 'palette' : 'sliders',
          run: entry.studio ? () => openThemeStudio(entry.studio) : () => openSettingsAt(entry.category, findEntry(entry, label), revealSetting, entry.tab),
          recent: () => ({ kind: 'setting', id: entry.id }),
        },
        label,
        `${entry.hint ? t(entry.hint) : ''} ${categoryLabel}`,
      ),
    );
  }
  return out;
}

function actionCandidates(target: PaletteHost): Candidate<Item>[] {
  const action = (id: string, label: string, iconName: IconName, run: () => void): Candidate<Item> =>
    candidate('actions', id, { key: id, label, icon: iconName, run, recent: () => ({ kind: 'action', id }) }, label);
  const pages = target.rooms
    .filter((room) => target.shown(room.id))
    .map((room) => {
      const c = action(`page:${room.id}`, room.label, PAGE_ICONS[room.id] ?? 'chevronRight', () => target.go(room.id));
      c.value.detail = t('palette.kind.page');
      return c;
    });
  // Each shortcut the palette can't run here (the player's, saving a card) opens its row in Settings → Shortcuts.
  const shortcuts = SHORTCUT_ENTRIES.map(({ id, label }): Candidate<Item> => {
    const name = t(label);
    const run = () => openSettingsAt('shortcuts', (pane) => pane.querySelector<HTMLElement>(`.shortcut-row[data-action="${CSS.escape(id)}"]`));
    return candidate<Item>('actions', `shortcut:${id}`, { key: `shortcut:${id}`, label: name, detail: shortcutDetail(id), icon: 'keyboard', run, recent: () => ({ kind: 'action', id: `shortcut:${id}` }) }, name, keywords('settings.nav.shortcuts'));
  });
  const all = [
    ...pages,
    action('action:profile', t('palette.action.profile'), 'sliders', () => void openProfileSwitcher().catch((err: unknown) => reportError('Could not open the profile switcher', err))),
    action('action:shortcuts', t('palette.action.shortcuts'), 'keyboard', () => openSettingsAt('shortcuts')),
    historyPaused() ? action('action:pause-history', t('quick.palette.resume'), 'play', () => void toggleHistoryPause()) : action('action:pause-history', t('quick.palette.pause'), 'pause', () => void toggleHistoryPause()),
    action('action:theme-studio', t('studio.palette.open'), 'palette', () => openThemeStudio()),
    action('action:tonight', t('tonight.palette'), 'moon', () => openTonight(target.ctx)),
    // Turns the phone remote on and shows its pairing code (Settings → General).
    action('action:phone-remote', t('remote.palette'), 'phone', () =>
      void startRemote()
        .then(() =>
          openSettingsAt(
            'general',
            (pane) => pane.querySelector<HTMLElement>('.remote-section [data-focus-id="remote-pair"]'),
            (button) => showSection(button, '.remote-section'),
          ),
        )
        .catch((err: unknown) => toast(errorText(err, { fallback: 'remote.settings.failed' }))),
    ),
    // Turns Orbit Connect on and shows its devices and pairing (Settings → General).
    action('action:orbit-connect', t('connect.palette'), 'cast', () =>
      void startConnect()
        .then(() =>
          openSettingsAt(
            'general',
            (pane) => pane.querySelector<HTMLElement>('.connect-section [data-focus-id="connect-pair"]'),
            (button) => showSection(button, '.connect-section'),
          ),
        )
        .catch((err: unknown) => toast(errorText(err, { fallback: 'connect.failed' }))),
    ),
    // Another device's playback, from here (only while one is online to control).
    ...(playTargets(connectState()).length ? [action('action:connect-control', t('connect.palette-control'), 'cast', () => chooseDeviceToControl())] : []),
    action('action:install-addon', t('palette.action.install-addon'), 'addons', () =>
      openSettingsAt(
        'addons',
        (pane) => pane.querySelector<HTMLInputElement>('.addons-panel .install input'),
        (input) => {
          input.scrollIntoView({ block: 'nearest' });
          // Chosen from the palette, it's an explicit request to type the URL.
          if (input instanceof HTMLInputElement) beginEditing(input);
        },
      ),
    ),
    action('action:collections', t('collections.palette.open'), 'list', () => target.ctx.open(createCollectionsPage(target.ctx))),
    action('action:import-collections', t('collections.palette.import'), 'upload', () => target.ctx.open(createImportPage(target.ctx))),
    action('action:addon-updates', t('palette.action.addon-updates'), 'addons', () =>
      openSettingsAt('addons', (pane) => pane.querySelector<HTMLElement>('[data-focus-id="check-updates"]'), (button) => {
        press(button);
        button.focus({ preventScroll: true });
      }),
    ),
    ...shortcuts,
  ];
  // Search, Settings and the shortcut list are shortcuts' own actions: they say the key too.
  for (const c of all) {
    const id = SHORTCUT_ITEMS[c.key as keyof typeof SHORTCUT_ITEMS];
    const key = id ? firstKey(id) : null;
    if (key) c.value.detail = c.value.detail ? t('browse.nav.with-shortcut', { label: c.value.detail, shortcut: key }) : shortcutDetail(id);
  }
  return all;
}

function titleItem(title: Title, detail: string, openDetail: (title: Title) => void): Item {
  return {
    key: `title:${title.id}`,
    label: title.name,
    detail,
    icon: title.type === 'movie' ? 'film' : 'episodes',
    run: () => openDetail(title),
    recent: () => (profile ? parseRecentEntry({ kind: 'title', title: snapshot(title), profile }) : null),
  };
}

/** A pasted stream or magnet link: played, or (a magnet with torrents off) why it can't be. Never remembered: the address may hold a key. */
function linkItem(link: PastedLink, ctx: RoomContext): Item {
  if (!canPlayLink(link)) return { key: 'link', label: t('pastelink.torrents-off.title'), detail: t('pastelink.torrents-off.open'), icon: 'sliders', run: () => openTorrentSetting(ctx) };
  return { key: 'link', label: t(link.kind === 'magnet' ? 'pastelink.play-magnet' : 'pastelink.play'), detail: linkLine(link), icon: 'play', run: () => playLink(link, ctx) };
}

const kindOf = (title: Title) => t(title.type === 'movie' ? 'palette.kind.movie' : isShowType(title.type) ? 'palette.kind.series' : 'palette.kind.title');

function listItem(list: CustomList, ctx: RoomContext): Item {
  return {
    key: `list:${list.id}`,
    label: list.name,
    detail: t('palette.from.list'),
    icon: 'list',
    run: () => ctx.open(createListPage(list.id, ctx)),
    recent: () => (profile ? { kind: 'list', id: list.id, profile } : null),
  };
}

function addonItem(key: string, name: string): Item {
  return {
    key: `addon:${key}`,
    label: name,
    detail: t('palette.kind.addon'),
    icon: 'addons',
    run: () => openSettingsAt('addons', (pane) => pane.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(key)}:details"]`), press),
    recent: () => (profile ? { kind: 'addon', key, name, profile } : null),
  };
}

/** The person's own titles and lists, from memory (no network), in the order duplicates should resolve. */
function yourCandidates(ctx: RoomContext, openDetail: (title: Title) => void): Candidate<Item>[] {
  const out: Candidate<Item>[] = [];
  const add = (title: Title, from: MessageKey) => {
    // Only titles the profile's content limit is known to allow (an unknown one is looked up for next time).
    if (verdictNow(title) === 'allowed') out.push(candidate('yours', `title:${title.id}`, titleItem(title, t(from), openDetail), title.name));
  };
  for (const entry of continueWatching()) add(entry.title, 'palette.from.continue');
  for (const item of queueItems()) add(item.title, 'palette.from.queue');
  for (const entry of libraryEntries()) add(entry.title, 'palette.from.library');
  for (const item of allDownloads()) if (item.state === 'done') add(item.title, 'palette.from.downloads');
  for (const title of recentlyWatched().slice(0, MAX_WATCHED)) add(title, 'palette.from.watched');
  for (const list of customLists()) out.push(candidate('yours', `list:${list.id}`, listItem(list, ctx), list.name));
  // Collections aren't remembered among recent picks (they can be found again by name).
  for (const c of customCollections()) {
    out.push(candidate('yours', `collection:${c.id}`, { key: `collection:${c.id}`, label: c.name, detail: t('collections.palette.kind'), icon: 'list', run: () => ctx.open(createCollectionPage(c.id, ctx)) }, c.name, c.group));
  }
  return out;
}

// ── The overlay ──

function open(target: PaletteHost, options: PaletteOptions = {}): void {
  const { ctx } = target;
  const settingsOnly = options.scope === 'settings';
  const { openDetail } = titleHandlers(ctx);
  settingsIndex ??= settingsCandidates();
  const actions = actionCandidates(target);
  const yours = yourCandidates(ctx, openDetail);
  let addons: Candidate<Item>[] = [];
  /** The installed addons' keys once read: a recent pick of one removed since isn't offered. */
  let installedKeys: Set<string> | null = null;
  const staticItems = new Map([...settingsIndex, ...actions].map((c) => [c.key, c.value]));

  let query = options.query ?? '';
  let groups: ShownGroup[] = [];
  let flat: Item[] = [];
  let buttons: HTMLElement[] = [];
  let active = 0;

  // Titles from addons, searched as the person types.
  // `exact`: the title a pasted id or link names (catalog/title-ref.ts), shown as the top result.
  type TitleState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; titles: Title[]; failed: boolean; exact?: boolean } | { kind: 'none-can-search' };
  let titles: TitleState = { kind: 'idle' };
  let generation = 0;
  let timer: number | undefined;
  let refs: Promise<CatalogRef[]> | undefined;

  const input = h('input', {
    class: 'palette-input',
    type: 'text',
    role: 'combobox',
    'aria-label': t('palette.label'),
    'aria-expanded': 'true',
    'aria-controls': 'palette-results',
    'aria-autocomplete': 'list',
    placeholder: settingsOnly ? t('settingshome.search.placeholder') : t('palette.placeholder'),
    autocomplete: 'off',
    spellcheck: 'false',
  });
  input.value = query;
  const results = h('div', { class: 'palette-results', id: 'palette-results', role: 'listbox', 'aria-label': t('palette.label') });
  const hint = (keys: string, label: MessageKey) => h('span', {}, h('kbd', {}, keys), t(label));
  const footer = h(
    'div',
    { class: 'palette-footer', 'aria-hidden': 'true' },
    hint('↑ ↓', 'palette.hint.move'),
    hint(keyLabel('Enter'), 'palette.hint.open'),
    hint(keyLabel('Tab'), 'palette.hint.groups'),
    hint(keyLabel('Escape'), 'palette.hint.close'),
  );
  // Limited to Settings, the field says so, so a missing title isn't a mystery.
  const scope = settingsOnly ? h('span', { class: 'palette-scope' }, t('palette.group.settings')) : '';
  const dialog = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('palette.label') }, h('div', { class: 'palette-field' }, icon('search'), scope, input), results, footer);
  const scrim = h('div', { class: 'scrim' });
  const layer = h('div', { class: 'palette-layer' }, scrim, dialog);

  const returnFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    generation++;
    window.clearTimeout(timer);
    removeBack();
    removeLayer();
    layer.remove();
    closeOpen = null;
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  };
  const removeBack = onBack(close);
  scrim.addEventListener('click', close);

  function run(item: Item): void {
    close();
    const entry = item.recent?.();
    if (entry) remember(entry);
    try {
      item.run();
    } catch (err) {
      reportError('A command palette action failed', err);
    }
  }

  function remember(entry: Recent): void {
    // Not read yet: the profile's key isn't known, so the pick waits rather than landing elsewhere.
    if (recents === null) return void queuedRecents.push(entry);
    recents = addRecent(recents, entry);
    saveRecents();
  }

  function resolveRecent(entry: Recent): Item | null {
    switch (entry.kind) {
      case 'setting': {
        // Older picks find rows and categories where they moved to (see currentSettingId).
        const current = currentSettingId(entry.id);
        return current ? (staticItems.get(`setting:${current}`) ?? null) : null;
      }
      case 'action':
        return staticItems.get(entry.id) ?? null;
      case 'addon':
        return installedKeys && !installedKeys.has(entry.key) ? null : addonItem(entry.key, entry.name);
      case 'list': {
        const found = customLists().find((l) => l.id === entry.id);
        return found ? listItem(found, ctx) : null;
      }
      case 'title': {
        const title = fromSnapshot(entry.title);
        return verdictNow(title) === 'allowed' ? titleItem(title, kindOf(title), openDetail) : null;
      }
    }
  }

  function emptyGroups(): ShownGroup[] {
    if (settingsOnly) {
      const categories = SETTINGS_CATEGORIES.map((c) => staticItems.get(`setting:${c.id}`)).filter((item): item is Item => item !== undefined);
      return [{ id: 'settings', best: 0, items: categories }];
    }
    const recent = recentsFor(recents ?? [], profile ?? null)
      .map(resolveRecent)
      .filter((item): item is Item => item !== null)
      .slice(0, GROUP_LIMITS.recent);
    const taken = new Set(recent.map((i) => i.key));
    const suggested = SUGGESTED.filter((key) => !taken.has(key))
      .map((key) => staticItems.get(key))
      .filter((item): item is Item => item !== undefined);
    return [
      ...(recent.length ? [{ id: 'recent' as const, best: 0, items: recent }] : []),
      { id: 'suggested' as const, best: 0, items: suggested.slice(0, GROUP_LIMITS.suggested) },
    ];
  }

  function queryGroups(): ShownGroup[] {
    if (settingsOnly) {
      const found: ShownGroup[] = rankGroups(settingsIndex!, query, SETTINGS_SCOPE_LIMITS);
      return found.length ? found : [{ id: 'settings', best: 0, items: [], note: t('settingshome.search.none') }];
    }
    // A pasted link is the only answer: it isn't searched for anywhere.
    const link = linkIn(query);
    if (link) return [{ id: 'actions', best: 0, items: [linkItem(link, ctx)] }];
    const local: ShownGroup[] = rankGroups([...yours, ...settingsIndex!, ...addons, ...actions], query);
    const searchAll: Item = {
      key: 'search-all',
      label: t('palette.search-all', { query: query.trim() }),
      icon: 'search',
      run: () => {
        searchNextFor(query);
        // The results, not a title page Search was left on.
        target.go('search', { root: true });
      },
    };
    const exact = titles.kind === 'done' && !!titles.exact;
    const found = titles.kind === 'done' ? titles.titles.slice(0, GROUP_LIMITS.titles).map((title) => titleItem(title, [exact ? t('pages.ref.top') : '', title.year, kindOf(title)].filter(Boolean).join(' · '), openDetail)) : [];
    const note =
      titles.kind === 'loading'
        ? t('palette.titles.searching')
        : titles.kind === 'none-can-search'
          ? t('palette.titles.none-can-search')
          : titles.kind === 'done' && !found.length
            ? t(titles.failed ? 'palette.titles.failed' : 'palette.titles.none')
            : undefined;
    // An id or link names one title: it leads, above anything that merely matched the text.
    const titleGroup: ShownGroup = { id: 'titles', best: exact && found.length ? Number.MAX_SAFE_INTEGER : TITLES_RANK, items: [...found, searchAll], ...(note ? { note } : {}) };
    return orderGroups([...local, titleGroup]);
  }

  /** Draws the groups; keeps the highlighted item when it's still there (results arriving), else the first. */
  function render(keepActive: boolean): void {
    const activeKey = keepActive ? flat[active]?.key : undefined;
    groups = query.trim() ? queryGroups() : emptyGroups();
    flat = groups.flatMap((g) => g.items);
    const found = activeKey ? flat.findIndex((item) => item.key === activeKey) : -1;
    active = found >= 0 ? found : 0;
    buttons = [];
    const fragment = document.createDocumentFragment();
    for (const group of groups) {
      const labelId = `palette-group-${group.id}`;
      const element = h('div', { class: 'palette-group', role: 'group', 'aria-labelledby': labelId }, h('div', { class: 'palette-group-label', id: labelId }, t(GROUP_LABELS[group.id])));
      if (group.note) element.append(h('div', { class: 'palette-note' }, group.note));
      for (const item of group.items) element.append(option(item, buttons.length));
      fragment.append(element);
    }
    results.replaceChildren(fragment);
    highlight(active, false);
  }

  function option(item: Item, index: number): HTMLElement {
    const button = h(
      'button',
      { class: 'palette-item', type: 'button', role: 'option', id: `palette-option-${index}`, tabindex: '-1', 'aria-selected': 'false' },
      icon(item.icon),
      h('span', { class: 'palette-item-label' }, item.label),
      item.detail ? h('span', { class: 'palette-item-detail' }, item.detail) : '',
    );
    // Typing stays in the field: clicking an option mustn't move focus to it.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('pointermove', () => {
      if (active !== index) highlight(index, false);
    });
    button.addEventListener('click', () => run(item));
    buttons.push(button);
    return button;
  }

  function highlight(index: number, scroll: boolean): void {
    buttons[active]?.classList.remove('active');
    buttons[active]?.setAttribute('aria-selected', 'false');
    active = index;
    const button = buttons[index];
    if (!button) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    button.classList.add('active');
    button.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', button.id);
    if (scroll) button.scrollIntoView({ block: 'nearest' });
  }

  /** The first item of the group `step` groups away from the highlighted one's, wrapping around. */
  function groupJump(step: 1 | -1): number {
    const starts: number[] = [];
    let index = 0;
    for (const group of groups) {
      if (group.items.length) starts.push(index);
      index += group.items.length;
    }
    if (!starts.length) return 0;
    let current = starts.length - 1;
    while (current > 0 && starts[current]! > active) current--;
    return starts[(current + step + starts.length) % starts.length]!;
  }

  let frame = 0;
  /** Results arriving one addon at a time are drawn at most once a frame. */
  function renderSoon(): void {
    if (frame || closed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!closed) render(true);
    });
  }

  function searchTitles(): void {
    // Limited to Settings: addons aren't asked at all.
    if (settingsOnly) return;
    const q = query.trim();
    const current = ++generation;
    window.clearTimeout(timer);
    // A pasted link never goes to addons as a search: it may hold a key.
    if (q.length < MIN_TITLE_QUERY || linkIn(q)) {
      titles = { kind: 'idle' };
      return;
    }
    titles = { kind: 'loading' };
    timer = window.setTimeout(() => void loadTitles(q, current), DEBOUNCE_MS);
  }

  /** Every searchable catalog's answer, merged and ranked as Search does, drawn as each addon answers. */
  async function loadTitles(q: string, current: number): Promise<void> {
    const ref = parseTitleRef(q);
    if (ref) {
      // Thrown when it couldn't be looked up at all (offline): that's a failure, not "no such title".
      const found = await resolveTitleRef(ref).catch(() => undefined);
      if (current !== generation) return;
      titles = { kind: 'done', titles: found ? [found] : [], failed: found === undefined, exact: true };
      return renderSoon();
    }
    try {
      refs ??= usableAddons().then(searchableCatalogs);
      const catalogs = await refs;
      if (current !== generation) return;
      if (!catalogs.length) {
        titles = { kind: 'none-can-search' };
        return renderSoon();
      }
      const lists: Title[][] = catalogs.map(() => []);
      let pending = catalogs.length;
      let failures = 0;
      await Promise.all(
        catalogs.map((ref, i) =>
          loadCatalog(ref, [['search', q]])
            // Only titles the profile's content limit allows (waits briefly for their ratings).
            .then((found) => allowedTitles(found))
            .then((found) => (lists[i] = found))
            .catch(() => failures++)
            .finally(() => {
              if (current !== generation) return;
              pending--;
              const ranked = rankResults(mergeResults(lists), q);
              if (ranked.length || !pending) {
                titles = { kind: 'done', titles: ranked, failed: failures === catalogs.length };
                renderSoon();
              }
            }),
        ),
      );
    } catch (err) {
      refs = undefined;
      if (current !== generation) return;
      console.warn('Command palette: could not search addons', err);
      titles = { kind: 'done', titles: [], failed: true };
      renderSoon();
    }
  }

  input.addEventListener('input', () => {
    query = input.value;
    searchTitles();
    render(false);
  });

  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    const count = flat.length;
    const vertical = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (vertical && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      if (count) highlight(event.ctrlKey || event.metaKey ? groupJump(vertical) : (active + vertical + count) % count, true);
    } else if (event.key === 'Tab' && !event.ctrlKey && !event.altKey) {
      // Focus stays in the field; Tab moves between groups instead.
      event.preventDefault();
      if (count) highlight(groupJump(event.shiftKey ? -1 : 1), true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = flat[active];
      if (item) run(item);
    }
  });

  document.body.append(layer);
  const removeLayer = pushLayer(layer, close);
  closeOpen = close;
  render(false);
  // Opened by an explicit shortcut: ready to type, like choosing Search.
  input.focus({ preventScroll: true });

  // Saved picks, the profile they belong to, and installed addons: read once, drawn when they come.
  if (recents === null || profile === undefined) {
    // The list once shared by every profile moves to the first profile that opens the palette.
    void Promise.all([profileSetting(RECENT_KEY), activeProfileId().catch(() => null)]).then(([saved, id]) => {
      recentsKey = saved.key;
      if (recents === null) {
        recents = withQueuedRecents(parseRecents(saved.value), queuedRecents);
        if (queuedRecents.length) saveRecents();
        queuedRecents = [];
      }
      profile = id;
      renderSoon();
    });
  }
  void installedAddons()
    .then((list: InstalledAddon[]) => {
      addons = list.map((addon) => {
        const name = addon.manifest?.name ?? addon.displayHost;
        return candidate('addons', `addon:${addon.key}`, addonItem(addon.key, name), name);
      });
      installedKeys = new Set(list.map((addon) => addon.key));
      renderSoon();
    })
    .catch((err: unknown) => console.warn('Command palette: could not list addons', err));
}
