import { VIEW_DISCARDED, VIEW_HIDDEN, VIEW_SHOWN, type Room, type RoomContext } from '../../app/router';
import { loadCatalog, usableAddons } from '../../catalog/service';
import { browsableCatalogs, showKind, type Title } from '../../catalog/titles';
import { continueCard, gridSkeletons, rail, titleMeta } from '../../components/cards';
import { icon } from '../../components/icons';
import { openMenuFrom, withContextMenu, type MenuItem } from '../../components/menu';
import { createTextField, editingAt, resumeEditing } from '../../components/text-field';
import { toast } from '../../components/toast';
import { verdictFor, verdictNow } from '../../catalog/parental';
import { locale, t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { filtersActive, filtersOn, genresOf, gridState, matchesFilters, nameOrder, NO_FILTERS, parseSavedFilters, ratingOf, releaseYear, restoreFilters, SAVED_FILTERS_PREFIX, savedFilters, type LibraryFilters, type RatedFilter, type SavedFilters, type WatchStatus } from '../../library/filters';
import { profileSetting } from '../../library/profiles';
import { hasRatings, onRatingsChange, userRating } from '../../library/ratings';
import { libraryEntries, libraryLoadError, loadLibrary, onLibraryChange } from '../../library/library';
import { errorState, errorText } from '../../components/state-message';
import type { StatsRange } from '../../library/stats';
import { customLists, listsLoadError, loadLists, onListsChange } from '../../library/lists';
import { clearQueue, dequeue, moveQueued, onQueueChange, queueItems } from '../../library/queue';
import { fillContinueWatching, fillLibraryGenres, genresKnown } from '../../library/genre-fill';
import { continueWatching, isWatched, lastWatchedAt, newEpisodeCount, onWatchChange, readWatch, watchedTitles, watchLoadError, type ContinueEntry } from '../../library/watch';
import { spotlight } from '../../library/spotlight';
import { askStremioAccount, STREMIO_SYNC_CHANGED, stremioSyncState } from '../../library/stremio-sync';
import { titleHandlers } from '../detail/open';
import { titleCard } from '../title-card';
import { playQueued } from '../detail/queue-actions';
import { playTitle } from '../detail/streams';
import { continueMenu, primaryLabel } from '../detail/title-actions';
import { openSettingsTo } from '../settings';
import { fillFeatured } from '../discover/featured';
import { openSurprise } from '../discover/surprise';
import { ageRatingSlot } from '../../components/age-rating';
import { createListPage, importListButton, listTile } from '../lists/lists';
import { shownTabs } from './tabs';
import { CLOUD_CHANGED, cloudAccounts } from '../../library/cloud';
import { calendarCount, calendarSources, createCalendar } from './calendar';
import { createCloudView } from './cloud';
import { createCollectionsPage } from '../collections/overview';
import { createHistoryView, historyCount } from './history';
import { favouritesCount, favouritesSection } from './favourites';
import { onFavouriteEpisodesChange } from '../../library/favourite-episodes';
import { createStats } from './stats';
import '../discover/discover.css';
import './library.css';

const SUGGESTION_COUNT = 6;

type TabId = 'all' | 'continue' | 'queue' | 'watched' | 'favourites' | 'history' | 'lists' | 'calendar' | 'stats' | 'cloud';
/** The tabs that are filtered, sorted title grids. */
const GRID_TABS: readonly TabId[] = ['all', 'continue', 'watched'];
type Kind = 'movie' | 'series';

/** Spec: tabs appear only when they have content. */
const TABS: { id: TabId; label: string; grid: string }[] = [
  { id: 'all', label: t('titles.library.all'), grid: t('titles.library.saved') },
  { id: 'continue', label: t('titles.common.continue-watching'), grid: t('titles.common.continue-watching') },
  { id: 'queue', label: t('watching.queue.title'), grid: t('watching.queue.title') },
  { id: 'watched', label: t('titles.common.watched'), grid: t('titles.common.watched') },
  { id: 'favourites', label: t('favourites.tab'), grid: t('favourites.tab') },
  { id: 'history', label: t('insights.history.tab'), grid: t('insights.history.tab') },
  { id: 'lists', label: t('titles.library.lists'), grid: t('titles.library.lists') },
  { id: 'calendar', label: t('titles.library.calendar'), grid: t('titles.library.calendar') },
  { id: 'stats', label: t('insights.stats.tab'), grid: t('insights.stats.tab') },
  // While a debrid account is connected (Settings → Integrations).
  { id: 'cloud', label: t('cloud.tab'), grid: t('cloud.tab') },
];

/** One poster in a Library grid. */
interface Item {
  title: Title;
  /** When it was saved, or for history tabs when it was last watched. */
  at: number;
  progress?: number;
  watched?: boolean;
  /** Continue Watching items play; the rest open their page. */
  plays?: boolean;
}

// A–Z in the app's language, not Windows': the same list sorts the same for everyone who reads it in that language.
let names: { locale: string; compare: (a: string, b: string) => number } | undefined;
const byName = (a: Item, b: Item) => {
  if (names?.locale !== locale()) names = { locale: locale(), compare: nameOrder(locale()) };
  return names.compare(a.title.name, b.title.name);
};
/** The profile's own stars for a title (library/ratings.ts), 0 when unrated. */
const ownRating = (title: Title) => userRating(title.id)?.rating ?? 0;

/** Remembered by id in the `library.sort` setting. */
const SORTS: { id: string; label: string; sort(a: Item, b: Item): number }[] = [
  { id: 'added', label: t('titles.library.sort-added'), sort: (a, b) => b.at - a.at },
  { id: 'watched', label: t('titles.library.sort-watched'), sort: (a, b) => lastWatchedAt(b.title.id) - lastWatchedAt(a.title.id) || b.at - a.at },
  { id: 'az', label: t('titles.library.sort-az'), sort: byName },
  // Titles without a year or rating go last.
  { id: 'year', label: t('titles.library.sort-year'), sort: (a, b) => releaseYear(b.title.year) - releaseYear(a.title.year) || byName(a, b) },
  { id: 'rating', label: t('titles.library.sort-rating'), sort: (a, b) => ratingOf(b.title.rating) - ratingOf(a.title.rating) || byName(a, b) },
  // Your own stars, best first; unrated titles go last.
  { id: 'mine', label: t('ratings.sort'), sort: (a, b) => ownRating(b.title) - ownRating(a.title) || byName(a, b) },
];
const SORT_KEY = 'library.sort';

/** Named apart from the Watched view (watch history), which sits in the same strip. */
const STATUSES: { id: WatchStatus | null; label: string }[] = [
  { id: null, label: t('librarystrip.status.any') },
  { id: 'unstarted', label: t('librarystrip.status.unstarted') },
  { id: 'started', label: t('librarystrip.status.started') },
  { id: 'watched', label: t('librarystrip.status.finished') },
];

const RATED: { id: RatedFilter | null; label: string }[] = [
  { id: null, label: t('ratings.filter-any') },
  { id: 'rated', label: t('ratings.filter-rated') },
  { id: 'unrated', label: t('ratings.filter-unrated') },
];

/** Movies or TV Shows, on any grid tab (once both kinds are in it). */
const TYPES: { id: Kind | null; label: string }[] = [
  { id: null, label: t('librarystrip.type.any') },
  { id: 'movie', label: t('titles.library.movies') },
  { id: 'series', label: t('titles.library.series') },
];

const statusOf = (title: Title): WatchStatus => (isWatched(title) ? 'watched' : lastWatchedAt(title.id) > 0 ? 'started' : 'unstarted');

/** My Library: saved titles by type, what's in progress, and what's been watched. */
/** The views another page can ask for (Settings' profile tiles). */
export type LibraryTab = 'all' | 'continue' | 'watched' | 'stats';
/** A tab asked for before the page was drawn, shown when it is. */
let requestedTab: LibraryTab | undefined;
let showTab: ((id: LibraryTab) => void) | undefined;

/** Shows `id` the next time My Library is on screen (the caller goes there). */
export function openLibraryTab(id: LibraryTab): void {
  requestedTab = id;
  showTab?.(id);
}

export const libraryRoom: Room = {
  id: 'library',
  label: t('titles.common.my-library'),
  render(ctx) {
    return libraryPage(ctx);
  },
};


/**
 * The page follows Movies / TV Shows (discover.css): the title row with
 * "Pick for me" at its end, a featured banner, then the floating filter
 * strip (the views, then a line of filter dropdowns, sort and the name) that
 * sticks while the view under it scrolls.
 */
function libraryPage(ctx: RoomContext): HTMLElement {
  const { openDetail, play, withMenu } = titleHandlers(ctx);
  let tabId: TabId = requestedTab ?? 'all';
  requestedTab = undefined;
  showTab = (id) => {
    requestedTab = undefined;
    if (id === tabId) return;
    // Asked for from another page: this one shows next, at the new view's own place rather than the old view's.
    if (!page.isConnected) topOnShow = scrolls.get(id) ?? 0;
    switchTab(id);
    render();
  };
  let sort = SORTS[0]!;
  /** Whether a sort was chosen here, which the saved one (still loading at first) then leaves alone. */
  let sortPicked = false;
  let filters: LibraryFilters = NO_FILTERS;
  /** Movies or TV Shows only, on the grid tabs; not remembered, like the tab. */
  let kind: Kind | null = null;
  /** Filters picked before the saved ones loaded, which those then leave alone. */
  const picked = new Set<keyof SavedFilters>();
  let suggestions: HTMLElement | undefined;
  /** The month Release Radar's grid shows. */
  let calendarMonth = new Date();
  /** A calendar filter that had focus when the page redrew; the new calendar focuses it once drawn. */
  let calendarFocus: string | undefined;
  /** The period the Stats tab covers. */
  let statsRange: StatsRange = 'year';
  /** Whether the profile has a debrid account, and My cloud (made when first shown, then kept). */
  let cloudOn = false;
  let cloudView: ReturnType<typeof createCloudView> | undefined;
  /** History (made when first shown, then kept, so its filter stays). */
  let historyView: ReturnType<typeof createHistoryView> | undefined;
  /** How far the page was scrolled in each view, so coming back to one returns to its place. */
  const scrolls = new Map<TabId, number>();
  /** Set by a tab switch: the page scrolls to the new view's place once it's drawn. */
  let switched: { from: number; stuck: number } | undefined;
  /** Where the page scrolls to when next shown, after a view was chosen from another page (see `showTab`). */
  let topOnShow: number | undefined;
  /** What the banner shows, so a redraw for an unrelated change doesn't reload its art. */
  let featuredKey = '';
  /** Titles whose rating the banner has waited for once (waited for again, one still unrated would redraw for ever). */
  const awaitedRatings = new Set<string>();

  const count = h('span', { class: 'count' });
  const collections = h('button', { class: 'button' }, t('collections.overview.title'));
  collections.addEventListener('click', () => ctx.open(createCollectionsPage(ctx)));
  // "Pick for me": Surprise Me's drawer over the library's own titles.
  const pickButton = h('button', { class: 'button glass', hidden: true }, t('librarylook.pick.open'));
  pickButton.addEventListener('click', () => openSurprise(pickKind(), { play, openDetail }, () => libraryEntries().map((e) => e.title)));
  const featured = h('section', { class: 'featured', hidden: true, 'data-nav-banner': true });
  const welcome = h('section', { class: 'featured library-welcome', hidden: true });
  /** Where the strip sits when it isn't stuck (see `switchTab`). */
  const anchor = h('div', { class: 'library-bar-anchor', 'aria-hidden': 'true' });
  const bar = h('div', { class: 'discover-bar library-bar' });
  const body = h('div', { class: 'library-body' });
  /** The title grid, redrawn alone while typing so the name field keeps focus. */
  const results = h('div', { class: 'library-results' });
  const search = createTextField({ label: t('titles.library.filter-name'), placeholder: t('titles.library.filter-name'), onSubmit: () => {}, className: 'library-search' });
  search.addEventListener('input', () => {
    const was = filtersActive(filters);
    filters = { ...filters, query: search.value };
    // On All the Continue Watching rail shows only while nothing filters: the first letter typed (or the last erased) redraws it.
    if (tabId === 'all' && filtersActive(filters) !== was) render();
    else drawResults();
  });
  const page = h(
    'div',
    { class: 'library' },
    h('div', { class: 'discover-head' }, h('h1', { class: 'page-title discover-title' }, t('titles.common.my-library'), count), h('div', { class: 'library-head-actions' }, collections, pickButton)),
    welcome,
    featured,
    anchor,
    bar,
    body,
  );

  const isGrid = (id: TabId) => GRID_TABS.includes(id);
  const ofKind = (title: Title) => kind === null || showKind(title.type) === kind;

  /** The type the drawer opens on: the one chosen, else the one the library has more of. */
  function pickKind(): Kind {
    if (kind) return kind;
    const saved = libraryEntries();
    return saved.filter((e) => showKind(e.title.type) === 'series').length > saved.filter((e) => e.title.type === 'movie').length ? 'series' : 'movie';
  }

  function itemsFor(id: TabId): Item[] {
    switch (id) {
      case 'continue':
        return continueWatching().map((e) => ({ title: e.title, at: lastWatchedAt(e.title.id), progress: e.progress, plays: true }));
      case 'watched':
        return watchedTitles().map((w) => ({ title: w.title, at: w.updatedAt, watched: true }));
      case 'all':
        return libraryEntries().map((e) => ({ title: e.title, at: e.addedAt }));
      // The queue, lists, the calendar and stats aren't filtered title grids (see draw).
      default:
        return [];
    }
  }

  /**
   * The grid's cards by title, kept from one redraw to the next until something changes
   * (`render` clears them): typing in the name filter only narrows the grid, so each
   * keystroke reuses them rather than building a card for every title in a large library.
   */
  const drawnCards = new Map<string, HTMLElement>();
  function gridCard(item: Item, used: Set<string>): HTMLElement {
    const key = `${tabId}|${item.title.id}`;
    // The same title twice in one grid gets a card of its own.
    if (used.has(key)) return card(item);
    used.add(key);
    let found = drawnCards.get(key);
    if (!found) {
      found = card(item);
      drawnCards.set(key, found);
    }
    return found;
  }

  function card(item: Item): HTMLElement {
    const fresh = newEpisodeCount(item.title.id);
    const stars = ownRating(item.title);
    const options = { ...(item.watched ? { watched: true } : {}), ...(item.progress ? { progress: item.progress } : {}), ...(fresh ? { badge: tn('titles.library.new', fresh) } : {}), ...(stars ? { ownRating: stars } : {}) };
    return titleCard(item.title, () => (item.plays ? play(item.title) : openDetail(item.title)), options, (c) => withMenu(c, item.title));
  }

  // Once ratings the content limit waited for are in (catalog/parental.ts `shownNow`): one function each, so a wait isn't queued again on every draw.
  const redrawStats = () => tabId === 'stats' && render();
  const redrawFavourites = () => tabId === 'favourites' && render();

  /** Redraws, keeping keyboard focus on the same card or control (e.g. after "Mark as watched" from a card's menu). */
  function render(): void {
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement && page.contains(active) ? active.closest<HTMLElement>('[data-focus-id]')?.dataset.focusId : undefined;
    // Cards in the queue, favourite episodes (each a card and its heart), a grid's cards and a row's (Continue Watching).
    const LISTED = '.library-queue > [data-focus-id], .fav-episode-item, .library-results [data-focus-id^="poster:"], .rail-track > [data-focus-id]';
    const listed = () => [...page.querySelectorAll<HTMLElement>(LISTED)];
    const listItem = active instanceof HTMLElement ? active.closest<HTMLElement>(LISTED) : null;
    const listIndex = listItem ? listed().indexOf(listItem) : -1;
    const onHeart = active instanceof HTMLElement && active.classList.contains('fav-episode-heart');
    // A name field being typed in is moved by the redraw, and moving it ends its editing (on blur).
    const typing = active instanceof HTMLInputElement && page.contains(active) ? editingAt(active) : null;
    calendarFocus = focusId?.startsWith('calendar-') ? focusId : undefined;
    drawnCards.clear();
    draw();
    calendarFocus = undefined;
    // The old card was replaced: focus its replacement.
    if (focusId && active instanceof HTMLElement && !active.isConnected) page.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
    // A kept view (History, My cloud) is put back in place, which drops focus from inside it: give it back.
    else if (active instanceof HTMLElement && active.isConnected && page.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
    // Typing goes on where it was (the person was already editing: not a new activation).
    if (typing && active instanceof HTMLInputElement && document.activeElement === active && active.readOnly) resumeEditing(active, typing);
    // A queued card, favourite episode, grid or row card that left (removed, played, taken out of the library): focus stays at its place in the list.
    if (listIndex >= 0 && !page.contains(document.activeElement)) {
      const items = listed();
      const next = items[Math.min(listIndex, items.length - 1)];
      // On a favourite, the same control as before: removing several in a row stays on the hearts.
      const target = next?.matches('.fav-episode-item') ? next.querySelector<HTMLElement>(onHeart ? '.fav-episode-heart' : '.fav-episode') : next;
      (target ?? page.querySelector<HTMLElement>('.library-tabs [aria-pressed="true"]'))?.focus({ preventScroll: true });
    }
    if (switched) placeSwitched(switched);
    switched = undefined;
    fillGenres();
  }

  /** The outlet the page scrolls in. */
  const scroller = () => page.closest<HTMLElement>('.outlet');

  /**
   * Switching views keeps each view's place: one seen before returns to it;
   * a new one starts at its top, under the strip if the strip was stuck
   * (rather than leaving the page scrolled deep into a shorter view).
   */
  function switchTab(id: TabId): void {
    const outlet = scroller();
    if (outlet) {
      scrolls.set(tabId, outlet.scrollTop);
      // How far the strip has slid from its place to stay stuck (0 when it isn't).
      const stuck = Math.max(0, bar.getBoundingClientRect().top - anchor.getBoundingClientRect().top - parseFloat(getComputedStyle(bar).marginTop));
      switched = { from: outlet.scrollTop, stuck };
    }
    tabId = id;
  }

  function placeSwitched(at: { from: number; stuck: number }): void {
    scroller()?.scrollTo({ top: scrolls.get(tabId) ?? at.from - at.stuck, behavior: 'instant' });
  }

  function draw(): void {
    const counts = new Map(
      TABS.map((t) => [
        t.id,
        t.id === 'lists' ? customLists().length : t.id === 'calendar' ? calendarSources() : t.id === 'queue' ? queueItems().length : t.id === 'cloud' ? Number(cloudOn) : t.id === 'history' ? historyCount() : t.id === 'favourites' ? favouritesCount() : itemsFor(t.id).length,
      ]),
    );
    const tabs = shownTabs(TABS, counts, tabId);
    const saved = libraryEntries();
    count.textContent = saved.length ? tn('browse.discover.titles', saved.length) : '';
    pickButton.hidden = saved.filter((e) => showKind(e.title.type) !== null).length < 2;
    if (!tabs.length) {
      featured.hidden = true;
      featuredKey = '';
      anchor.hidden = true;
      bar.hidden = true;
      // Saved titles or history that couldn't be read aren't an empty library: say so, with Try again.
      if (loadFailures().length) {
        welcome.hidden = true;
        body.replaceChildren(loadFailed());
        return;
      }
      drawWelcome();
      suggestions ??= loadSuggestions();
      body.replaceChildren(suggestions);
      return;
    }
    welcome.hidden = true;
    anchor.hidden = false;
    bar.hidden = false;
    drawFeatured();
    if (!tabs.some((t) => t.id === tabId)) tabId = tabs[0]!.id;
    const tab = TABS.find((t) => t.id === tabId)!;
    const grid = isGrid(tabId);
    drawBar(tabs, tab, counts);
    const listTiles = tabId === 'lists' ? customLists().map((list) => listTile(list, () => ctx.open(createListPage(list.id, ctx)))) : [];

    // On All, what's in progress leads, as on Home (unless filtering).
    const cw = tabId === 'all' && !filtersActive(filters) ? continueWatching().filter((entry) => ofKind(entry.title)) : [];
    void fillContinueWatching(cw.map((entry) => entry.title));
    // The rail is drawn anew, which would put it back at its start: it keeps how far it was scrolled.
    const CW_TRACK = '.rail-track.continue';
    const cwScroll = body.querySelector(CW_TRACK)?.scrollLeft ?? 0;
    body.replaceChildren(
      loadFailures().length ? loadFailed() : '',
      cw.length ? rail({ title: t('titles.common.continue-watching'), cards: cw.map((entry) => withMenu(continueCard(entry, () => play(entry.title)), entry.title, continueMenu(entry.title))), variant: 'continue' }) : '',
      grid ? results : '',
      // Lists keep their own order; the calendar is by date.
      tabId === 'lists'
        ? h(
            'section',
            { class: 'library-section' },
            h('div', { class: 'list-section-head' }, h('h2', { class: 'library-heading' }, tab.grid), importListButton(ctx)),
            listTiles.length ? h('div', { class: 'list-grid' }, ...listTiles) : h('div', { class: 'library-empty' }, h('span', { class: 'library-empty-title' }, t('titles.lists.tab-empty')), h('p', { class: 'muted' }, t('titles.lists.empty'))),
          )
        : '',
      tabId === 'calendar'
        ? h(
            'section',
            { class: 'library-section' },
            createCalendar({
              month: calendarMonth,
              onMonth: (month) => {
                calendarMonth = month;
                render();
              },
              openDetail,
              // An episode of a followed series plays itself; anything else as its card would.
              play: (title, episode) => (episode ? void playTitle(title, { episode, ctx }) : play(title)),
              focusId: calendarFocus,
              go: ctx.go,
              // Only the number changes: the strip isn't drawn again under the Radar.
              onCount: () => {
                const count = bar.querySelector(`[data-focus-id="${CSS.escape(`${t('titles.library.show')}:calendar`)}"] .segment-count`);
                if (count) count.textContent = tabCount('calendar', new Map());
              },
            }),
          )
        : '',
      tabId === 'queue' ? queueSection() : '',
      tabId === 'cloud' ? cloudSection() : '',
      tabId === 'history' ? historySection() : '',
      tabId === 'favourites' ? favouritesSection(ctx, { openDetail, redraw: redrawFavourites }) : '',
      tabId === 'stats'
        ? createStats({
            range: statsRange,
            onRange: (range) => {
              statsRange = range;
              render();
              // The page redrew under the focused button; keep focus on the choice.
              body.querySelector<HTMLElement>('.stats-bar [aria-pressed="true"]')?.focus({ preventScroll: true });
            },
            openDetail,
            onBrowse: () => ctx.go('home'),
            redraw: redrawStats,
          })
        : '',
    );
    if (cwScroll) body.querySelector(CW_TRACK)?.scrollTo({ left: cwScroll, behavior: 'instant' });
    if (grid) drawResults();
  }

  /** The banner: what you'd most likely resume, else the latest addition. */
  function drawFeatured(): void {
    // A title whose rating is still being looked up is passed over for now; once it's known the banner may change.
    const pending: Title[] = [];
    const pick = spotlight(continueWatching(), libraryEntries(), (title) => {
      const verdict = verdictNow(title);
      if (verdict === 'pending' && !awaitedRatings.has(title.id)) pending.push(title);
      return verdict === 'allowed';
    });
    if (pending.length) {
      for (const title of pending) awaitedRatings.add(title.id);
      void Promise.all(pending.map((title) => verdictFor(title))).then(redraw, () => {});
    }
    const entry: ContinueEntry | undefined = pick?.kind === 'resume' ? pick.entry : undefined;
    const label = pick ? primaryLabel(pick.title) : '';
    const key = pick ? [pick.title.id, label, entry?.sub, entry?.left, entry?.badge, Math.round((entry?.progress ?? 0) * 100)].join('|') : '';
    if (key === featuredKey) return;
    featuredKey = key;
    if (!pick) return fillFeatured(featured, page, undefined);
    const title = pick.title;
    // A resumable title says where you are in it (spoiler-safe, as its Continue Watching card does).
    const where = entry ? [entry.badge, entry.sub, entry.left].filter((part): part is string => Boolean(part)) : [];
    const meta = where.length ? where.flatMap((part, i) => [...(i ? [h('span', { class: 'meta-dot', 'aria-hidden': 'true' }, '·')] : []), h('span', { dir: 'auto' }, part)]) : [...titleMeta(title), ageRatingSlot(title, { dot: true })];
    const progress = entry && entry.progress > 0 ? h('span', { class: 'featured-progress', 'aria-hidden': 'true' }, h('span', { class: 'progress-fill' })) : undefined;
    if (entry && progress) progress.style.setProperty('--progress', String(entry.progress));
    fillFeatured(featured, page, title, {
      playLabel: label,
      play: () => play(title),
      openDetail: () => openDetail(title),
      meta,
      ...(progress ? { extra: progress } : {}),
    });
  }

  /** The views; on grid tabs one line of dropdowns, sort and the name under them. */
  function drawBar(tabs: typeof TABS, tab: (typeof TABS)[number], counts: Map<TabId, number>): void {
    // Redrawn each time: the scrolling line of views keeps how far it was scrolled.
    const tabsScroll = bar.querySelector('.library-tabs')?.scrollLeft ?? 0;
    const views = segments(
      t('titles.library.show'),
      tabs,
      tab,
      (t) => {
        if (t.id !== tabId) switchTab(t.id);
      },
      // "All" can show with nothing saved (only history); a 0 there would read oddly. My cloud counts its own.
      (t) => h('span', { class: 'segment-count' }, tabCount(t.id, counts)),
    );
    views.classList.add('library-tabs');
    const grid = isGrid(tabId);
    bar.replaceChildren(h('div', { class: 'discover-bar-row' }, views), grid ? filterRow() : '');
    if (tabsScroll) views.scrollLeft = tabsScroll;
    // The chosen view stays in sight in a narrow window (only while the strip is on screen, so this never scrolls the page).
    const chosen = views.querySelector<HTMLElement>('[aria-pressed="true"]');
    const strip = views.getBoundingClientRect();
    const at = chosen?.getBoundingClientRect();
    if (chosen && at && strip.top >= 0 && strip.bottom <= innerHeight && (at.left < strip.left || at.right > strip.right)) chosen.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }

  /**
   * The number on a view's button. Release Radar's is the releases coming (known once it has
   * looked them up), not the shows and films it follows, which only decide whether it shows.
   */
  function tabCount(id: TabId, counts: Map<TabId, number>): string {
    const n = id === 'calendar' ? calendarCount() : counts.get(id);
    return n && id !== 'cloud' ? String(n) : '';
  }

  /**
   * A compact dropdown, as Discover's source button: it names what's chosen
   * ("Movies ▾") and its menu opens on that choice. `active` marks a filter
   * that narrows the view.
   */
  function dropdown<T extends { label: string }>(o: { id: string; name?: string; options: readonly T[]; current: T; choose(option: T): void; active?: boolean; text?: string; count?(option: T): number }): HTMLElement {
    const button = h(
      'button',
      // Said to open a menu from the start, not only once it has opened one (menu.ts sets these on opening).
      { class: 'source-button library-pick', 'data-focus-id': `filter:${o.id}`, 'aria-label': o.text ?? `${o.name}: ${o.current.label}`, 'aria-pressed': String(Boolean(o.active)), 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
      h('span', { class: 'library-pick-value', dir: 'auto' }, o.text ?? o.current.label),
      icon('chevronDown'),
    );
    button.addEventListener('click', () =>
      openMenuFrom(
        button,
        o.options.map((option) => {
          const n = o.count?.(option);
          // A dot rather than brackets, which a right-to-left menu would turn around a left-to-right genre name.
          return { label: n ? `${option.label} · ${n}` : option.label, checked: () => option === o.current, action: () => o.choose(option) };
        }),
      ),
    );
    return button;
  }

  function sortButton(): HTMLElement {
    return dropdown({
      id: 'sort',
      text: t('titles.library.sort', { sort: sort.label }),
      options: SORTS,
      current: sort,
      choose: (s) => {
        sort = s;
        sortPicked = true;
        void settings.set(SORT_KEY, s.id).catch(() => {});
        render();
      },
    });
  }

  /** Type, status, genre and your ratings as dropdowns, then sort and the name: one line, on the grid tabs. */
  function filterRow(): HTMLElement {
    const items = itemsFor(tabId);
    // Movies / TV Shows once the view has both (or while one is chosen).
    const kinds = TYPES.map((k) => ({ ...k, count: k.id ? items.filter((i) => showKind(i.title.type) === k.id).length : items.length }));
    const typeFilter =
      kind !== null || kinds.filter((k) => k.id && k.count).length > 1
        ? dropdown({
            id: 'type',
            name: t('insights.surprise.type'),
            options: kinds,
            current: kinds.find((k) => k.id === kind)!,
            active: kind !== null,
            count: (k) => k.count,
            choose: (k) => {
              kind = k.id;
              render();
            },
          })
        : '';
    // Continue Watching is all started and Watched all watched, so status only filters the others.
    const statusFilter =
      tabId === 'continue' || tabId === 'watched'
        ? ''
        : dropdown({ id: 'status', name: t('titles.library.status'), options: STATUSES, current: STATUSES.find((s) => s.id === filters.status)!, active: filters.status !== null, choose: (s) => setFilters({ status: s.id }) });
    // Your ratings: only once the profile has rated something (or while filtering by it).
    const rated =
      hasRatings() || filters.rated !== null
        ? dropdown({ id: 'rated', name: t('ratings.sort'), options: RATED, current: RATED.find((r) => r.id === filters.rated)!, active: filters.rated !== null, choose: (r) => setFilters({ rated: r.id }) })
        : '';
    const clear = h('button', { class: 'source-button', 'data-focus-id': 'filter:clear', hidden: !narrowed() }, t('titles.common.clear-filters'));
    clear.addEventListener('click', clearFilters);
    // In a slot of its own, redrawn alone as genres are found (see `genresArrived`).
    const genre = h('span', { class: 'library-genre-slot' }, genreFilter());
    return h('div', { class: 'discover-bar-row library-bar-filters' }, typeFilter, statusFilter, genre, rated, clear, h('span', { class: 'library-filters-gap' }), sortButton(), search);
  }

  /**
   * The view's genres, most common first, each with how many titles have it;
   * offered once most of the view has genres (see `fillGenres`), so it never
   * counts a handful of a large library.
   */
  function genreFilter(): HTMLElement | '' {
    const titles = itemsFor(tabId)
      .filter((i) => ofKind(i.title))
      .map((i) => i.title);
    const genres = genresOf(titles);
    // A saved genre this view doesn't have still shows, so it can be turned off.
    if (filters.genre !== null && !genres.some((g) => g.genre === filters.genre)) genres.unshift({ genre: filters.genre, count: 0 });
    if (filters.genre === null && (genres.length < 2 || !genresKnown(titles))) return '';
    const options = [{ id: null, label: t('titles.library.all-genres'), count: 0 }, ...genres.map((g) => ({ id: g.genre, label: g.genre, count: g.count }))];
    return dropdown({ id: 'genre', name: t('insights.surprise.genre'), options, current: options.find((g) => g.id === filters.genre)!, active: filters.genre !== null, count: (g) => g.count, choose: (g) => setFilters({ genre: g.id }) });
  }

  /** Whether the grid shows less than the whole view: a filter that applies to it, or one type only. */
  const narrowed = () => filtersActive(filtersOn(tabId, filters)) || kind !== null;

  function clearFilters(): void {
    search.value = '';
    kind = null;
    setFilters(NO_FILTERS);
  }

  /** My cloud, kept across redraws (its search and filters stay), refreshed each time its tab shows. */
  function cloudSection(): HTMLElement {
    const first = !cloudView;
    cloudView ??= createCloudView(ctx);
    if (first || !cloudView.element.isConnected) cloudView.shown();
    return cloudView.element;
  }

  /** History, kept across redraws (its filter stays), read again each time it's drawn. */
  function historySection(): HTMLElement {
    historyView ??= createHistoryView(ctx, { openDetail });
    historyView.refresh();
    return historyView.element;
  }

  /** The queue as cards, in play order: each plays when picked; its menu moves or removes it. */
  function queueSection(): HTMLElement {
    const items = queueItems();
    if (!items.length) {
      return h('section', { class: 'library-section' }, h('div', { class: 'library-empty' }, h('span', { class: 'library-empty-title' }, t('watching.queue.empty')), h('p', { class: 'muted' }, t('watching.queue.empty-body'))));
    }
    // Clearing takes two presses: the first arms it, leaving the button disarms it.
    const clearLabel = t('watching.queue.clear');
    const clear = h('button', { class: 'button glass', 'data-focus-id': 'queue-clear' }, clearLabel);
    clear.addEventListener('click', () => {
      if (!clear.dataset.armed) {
        clear.dataset.armed = 'true';
        clear.textContent = t('watching.queue.clear-confirm');
        return;
      }
      // A save that fails puts the queue back and says so itself (queue.ts): "cleared" only when it was.
      void clearQueue().then(
        () => {
          if (!queueItems().length) toast(t('watching.queue.cleared'));
        },
        (err: unknown) => toast(errorText(err)),
      );
    });
    clear.addEventListener('blur', () => {
      delete clear.dataset.armed;
      clear.textContent = clearLabel;
    });
    const cards = items.map((item, i) => {
      const badge = item.episode ? t('titles.common.episode-code', { season: item.episode.season, episode: item.episode.number }) : undefined;
      const menu: MenuItem[] = [{ label: t('watching.queue.play-now'), action: () => playQueued(item, ctx) }];
      if (i > 0) menu.push({ label: t('watching.queue.move-earlier'), action: () => void moveQueued(item.id, -1) });
      if (i < items.length - 1) menu.push({ label: t('watching.queue.move-later'), action: () => void moveQueued(item.id, 1) });
      menu.push({ label: t('watching.queue.remove'), action: () => void dequeue(item.id) }, { label: t('titles.actions.view-details'), action: () => openDetail(item.title) });
      return titleCard(item.title, () => playQueued(item, ctx), badge ? { badge } : {}, (card) => {
        card.dataset.focusId = `queue:${item.id}`;
        return withContextMenu(card, () => menu);
      });
    });
    return h(
      'section',
      { class: 'library-section' },
      h('div', { class: 'library-queue-header' }, h('h2', { class: 'library-heading' }, t('watching.queue.title'), h('span', { class: 'segment-count' }, tn('watching.queue.count', items.length))), clear),
      h('div', { class: 'title-grid library-queue' }, ...cards),
    );
  }

  function setFilters(next: Partial<LibraryFilters>): void {
    filters = { ...filters, ...next };
    for (const key of ['genre', 'status', 'rated'] as const) if (key in next) picked.add(key);
    rememberFilters();
    render();
  }

  /** Genre, status and rated are kept per profile; the typed name isn't (and the sort is one setting for every profile). */
  function rememberFilters(): void {
    void profileSetting(SAVED_FILTERS_PREFIX)
      .then(({ key }) => settings.set(key, savedFilters(filters)))
      .catch((err: unknown) => console.warn('Could not save My Library’s filters', err));
  }

  function drawResults(): void {
    const tab = TABS.find((t) => t.id === tabId)!;
    // The whole view, so a type with nothing in it still says so and offers Clear filters, rather than leaving the grid blank.
    const all = itemsFor(tabId);
    const applied = filtersOn(tabId, filters);
    const shown = all.filter((i) => ofKind(i.title) && matchesFilters(i.title, applied, statusOf, (title) => ownRating(title) > 0)).sort(sort.sort);
    // Typing a name redraws only the grid: the strip's Clear filters follows it.
    const stripClear = bar.querySelector<HTMLElement>('[data-focus-id="filter:clear"]');
    if (stripClear) stripClear.hidden = !narrowed();
    const heading = h('h2', { class: 'library-heading' }, tab.grid, narrowed() ? h('span', { class: 'segment-count' }, t('titles.library.shown-of', { shown: shown.length, total: all.length })) : '');
    const state = gridState(all.length, shown.length);
    if (state === 'titles') {
      const used = new Set<string>();
      results.replaceChildren(h('section', { class: 'library-section' }, heading, h('div', { class: 'title-grid' }, ...shown.map((item) => gridCard(item, used)))));
      return;
    }
    // All shows with nothing saved when there's only watch history (or the last title was just removed): it says so rather than staying blank.
    if (state === 'empty') {
      results.replaceChildren(h('section', { class: 'library-section' }, h('div', { class: 'library-empty' }, h('span', { class: 'library-empty-title' }, t('titles.library.empty')), h('p', { class: 'muted' }, t('titles.library.empty-body')))));
      return;
    }
    const clear = h('button', { class: 'button glass' }, t('titles.common.clear-filters'));
    clear.addEventListener('click', clearFilters);
    results.replaceChildren(h('section', { class: 'library-section' }, heading, h('div', { class: 'library-none' }, h('p', { class: 'muted' }, t('titles.library.no-match')), clear)));
  }

  function segments<T extends { id: string; label: string }>(label: string, options: T[], current: T, select: (option: T) => void, extra?: (option: T) => Node): HTMLElement {
    return h(
      'div',
      { class: 'segments', role: 'group', 'aria-label': label },
      ...options.map((option) => {
        // Kept focused through the redraw choosing one causes (see `render`). By id, not place:
        // a view that appears or goes meanwhile (Release Radar once its count is in) would move focus to its neighbour.
        const button = h('button', { class: 'segment', 'data-focus-id': `${label}:${option.id}`, 'aria-pressed': String(option === current) }, option.label, extra?.(option) ?? '');
        button.addEventListener('click', () => {
          select(option);
          render();
        });
        return button;
      }),
    );
  }

  /**
   * Nothing saved, watched or listed yet: the banner's place holds an
   * invitation and, while Stremio isn't signed in, a way to bring its
   * Continue Watching and watched titles over.
   */
  function drawWelcome(): void {
    welcome.hidden = false;
    const browse = h('button', { class: 'button large primary', 'data-focus-id': 'welcome:browse' }, t('titles.library.browse-home'));
    browse.addEventListener('click', () => ctx.go('home'));
    const signedOut = stremioSyncState().signedIn === false;
    let stremio: HTMLElement | '' = '';
    if (signedOut) {
      stremio = h('button', { class: 'button large', 'data-focus-id': 'welcome:stremio' }, t('librarylook.stremio.sign-in'));
      stremio.addEventListener('click', () => {
        openSettingsTo('integrations', '.stremio-section');
        ctx.go('settings');
      });
    } else askStremioAccount();
    welcome.replaceChildren(
      h(
        'div',
        { class: 'library-welcome-content' },
        h('h2', { class: 'library-welcome-title' }, t('titles.library.empty')),
        h('p', { class: 'library-welcome-body' }, t('titles.library.empty-body')),
        signedOut ? h('p', { class: 'library-welcome-body' }, t('librarylook.stremio.body')) : '',
        h('div', { class: 'hero-actions' }, browse, stremio),
      ),
    );
  }

  /**
   * What couldn't be read (at startup or a profile switch), the saved titles first: without
   * them, or the watch history, the page would look empty. Lists only while none are shown
   * (a reload after a change that fails keeps the ones read before).
   */
  function loadFailures(): { title: string; err: unknown; retry: () => Promise<void> }[] {
    return [
      { title: t('states.library.failed'), err: libraryLoadError(), retry: loadLibrary },
      { title: t('states.library.history-failed'), err: watchLoadError(), retry: readWatch },
      { title: t('states.library.lists-failed'), err: customLists().length ? null : listsLoadError(), retry: loadLists },
    ].filter((failure) => failure.err !== null);
  }

  /** One message for what couldn't be read, about the first; Try again reads each of them again. */
  function loadFailed(): HTMLElement {
    const failures = loadFailures();
    const first = failures[0]!;
    // A load that works redraws through its change listener; one that fails again does too.
    return errorState({ title: first.title, err: first.err, retry: () => void Promise.allSettled(failures.map((failure) => failure.retry())) });
  }

  /** "Popular to start with": the top of the first movie catalog. */
  function loadSuggestions(): HTMLElement {
    const grid = h('div', { class: 'title-grid' }, ...gridSkeletons(SUGGESTION_COUNT));
    const section = h('section', { class: 'library-section' }, h('h2', { class: 'library-heading' }, t('titles.library.popular')), grid);
    void usableAddons()
      .then((addons) => {
        const refs = browsableCatalogs(addons);
        const ref = refs.find((r) => r.catalog.type === 'movie') ?? refs[0];
        return ref ? loadCatalog(ref) : [];
      })
      .then((titles) => {
        if (!titles.length) {
          // Not kept either, or the next redraw would put back a heading with nothing under it.
          section.remove();
          suggestions = undefined;
          return;
        }
        grid.replaceChildren(...titles.slice(0, SUGGESTION_COUNT).map((title) => titleCard(title, () => openDetail(title), {}, (card) => withMenu(card, title))));
      })
      .catch(() => {
        // Suggestions are optional; the page stays usable offline.
        section.remove();
        suggestions = undefined;
      });
    return section;
  }

  // While another page is up (e.g. the player, saving progress every few
  // seconds), the redraw waits until My Library shows again.
  let stale = false;
  const redraw = () => {
    if (page.isConnected) render();
    else stale = true;
  };
  // Each view's place, noted as the page is left, for a view chosen from another page meanwhile.
  page.addEventListener(VIEW_HIDDEN, () => {
    const outlet = scroller();
    if (outlet) scrolls.set(tabId, outlet.scrollTop);
  });
  page.addEventListener(VIEW_SHOWN, () => {
    if (topOnShow !== undefined) scroller()?.scrollTo({ top: topOnShow, behavior: 'instant' });
    topOnShow = undefined;
    fillGenres();
    if (!stale) return;
    stale = false;
    render();
  });

  /**
   * Genres for saved titles that have none are looked up while the page
   * shows (library/genre-fill.ts), and stop when it's left; a title added
   * meanwhile is picked up by the redraw that adds it.
   */
  let genreFill: AbortController | undefined;
  function fillGenres(): void {
    if (genreFill || !page.isConnected) return;
    const controller = new AbortController();
    genreFill = controller;
    void fillLibraryGenres(controller.signal, genresArrived)
      .catch((err: unknown) => console.warn('Could not look up genres for My Library', err))
      .finally(() => {
        if (genreFill === controller) genreFill = undefined;
      });
  }
  const stopGenres = () => {
    genreFill?.abort();
    genreFill = undefined;
  };
  page.addEventListener(VIEW_HIDDEN, stopGenres);
  page.addEventListener(VIEW_DISCARDED, stopGenres);

  /**
   * Some genres were found: the genre dropdown is redrawn alone, at most once
   * a second, so its counts grow (and it appears once most of the view has
   * genres) without moving focus or the page. A chosen genre's grid takes in
   * the new titles too.
   */
  let genreTimer = 0;
  function genresArrived(): void {
    if (genreTimer) return;
    genreTimer = window.setTimeout(() => {
      genreTimer = 0;
      if (!page.isConnected || !isGrid(tabId)) return;
      // A menu open from the strip returns focus to its button when it closes: wait for it.
      if (bar.querySelector('[aria-expanded="true"]')) return genresArrived();
      if (filters.genre !== null) return render();
      const slot = bar.querySelector('.library-genre-slot');
      if (!slot) return;
      const focused = slot.contains(document.activeElement);
      slot.replaceChildren(genreFilter());
      if (focused) slot.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    }, 1000);
  }
  onLibraryChange(redraw);
  onWatchChange(redraw);
  onListsChange(redraw);
  onQueueChange(redraw);
  onRatingsChange(redraw);
  onFavouriteEpisodesChange(redraw);
  // Signing in to or out of Stremio changes what the empty page offers.
  document.addEventListener(STREMIO_SYNC_CHANGED, () => {
    if (!welcome.hidden) redraw();
  });
  const checkCloud = () =>
    void cloudAccounts().then((accounts) => {
      const on = accounts.length > 0;
      // An account added or removed while My cloud shows: list again.
      if (on && cloudView?.element.isConnected) cloudView.shown();
      if (on === cloudOn) return;
      cloudOn = on;
      redraw();
    });
  document.addEventListener(CLOUD_CHANGED, checkCloud);
  checkCloud();
  render();
  void settings
    .get(SORT_KEY)
    .catch(() => null)
    .then((saved) => {
      const found = SORTS.find((s) => s.id === saved);
      // A sort chosen before the saved one loaded stays.
      if (found && found !== sort && !sortPicked) {
        sort = found;
        render();
      }
    });
  void profileSetting(SAVED_FILTERS_PREFIX)
    .then(({ value }) => {
      const saved = parseSavedFilters(value);
      if (!filtersActive({ ...saved, query: '' })) return;
      // The genres of the grid showing; a tab that isn't a title grid has none of its own, so any saved title's count.
      const own = itemsFor(tabId);
      const titles = (own.length ? own : GRID_TABS.flatMap(itemsFor)).map((i) => i.title);
      filters = restoreFilters(filters, saved, picked, genresOf(titles).map((g) => g.genre));
      render();
    })
    .catch(() => {});
  return page;
}
