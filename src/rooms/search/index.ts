import { everyCatalogLoaded, everyTranslation, loadEveryCatalog, locale, t, tn } from '../../i18n';
import { rotateSearchHints } from '../../components/fun-lines';
import { canPlayLink, linkIn, linkLine, openTorrentSetting, playLink } from '../../app/play-link';
import { VIEW_SHOWN, type Room, type RoomContext } from '../../app/router';
import { GENRE_LABELS, type GenreKey } from '../../catalog/explore';
import { mergeResults, normalize, rankResults, recentSearches, searchableCatalogs, searchLeniently } from '../../catalog/search';
import { genreNames as genreNamesFrom, intentChips, intentStands, parseSearchIntent, type DiscoverIntent, type IntentChip, type LikeIntent, type SearchIntent } from '../../catalog/search-intent';
import { allowedTitles } from '../../catalog/parental';
import { parseTitleRef, resolveTitleRef } from '../../catalog/title-ref';
import { loadCatalog, usableAddons } from '../../catalog/service';
import { onAddonsChange } from '../../addons/registry';
import { searchPeople, tmdbConnected, type PersonHit } from '../../catalog/tmdb';
import { isShowType, showKind, type CatalogRef, type Title } from '../../catalog/titles';
import { gridSkeletons, rail } from '../../components/cards';
import { invoke } from '@tauri-apps/api/core';
import { icon } from '../../components/icons';
import { toast } from '../../components/toast';
import { isAndroid } from '../../lib/platform';
import { errorState, errorText, isOffline, retryWhenOnline, stateMessage } from '../../components/state-message';
import { beginEditing, createTextField } from '../../components/text-field';
import { settings } from '../../lib/ipc';
import { profileSetting } from '../../library/profiles';
import { h } from '../../lib/dom';
import type { PastedLink } from '../../lib/pasted-link';
import { firstKey } from '../../lib/keymap';
import { titleHandlers } from '../detail/open';
import { titleCard } from '../title-card';
import { primaryLabel } from '../detail/title-actions';
import { createGridPage } from '../explore/grid';
import { createPersonPage } from '../person/person';
import { openSettingsTo } from '../settings';
import { personCard, topResultCard } from './cards';
import { createIdle, type Tab } from './idle';
import { suggestionsFor, type Suggestions } from './suggest';
import './search.css';

const DEBOUNCE_MS = 380;
/** How long people and a person's suggestions are waited for after the addons' results are in. */
const EXTRAS_GRACE_MS = 1500;
const RECENT_KEY = 'search.recent';

const FILTERS: [Tab, string][] = [
  ['all', t('browse.search.all')],
  ['movie', t('browse.search.movies')],
  ['series', t('browse.search.series')],
];

interface Results {
  query: string;
  titles: Title[];
  /** Addons that couldn't answer, with why. */
  failures: { name: string; reason: string }[];
  people: PersonHit[];
  /** For a search for someone ("movies with Tom Hanks"), when it stands. */
  suggestions: Suggestions | null;
  /** For a search read as filters ("best horror movies"): the reading and what it found, shown in place of the plain results. */
  smart?: { intent: DiscoverIntent | LikeIntent; found: Suggestions } | undefined;
  /** The search reads as filters, but TMDB isn't connected to answer them. */
  needsTmdb?: boolean | undefined;
  /** The search was an id or a link (catalog/title-ref.ts): `titles` is the one title it names, if found. */
  exact?: boolean | undefined;
  /** No addon in use can search. */
  noneCanSearch?: boolean | undefined;
  /** Why TMDB couldn't answer a search read as filters (the plain results are shown instead). */
  smartFailed?: unknown;
}

let field: HTMLInputElement | undefined;
/** The search page's own "search for this" and key hint, once it's drawn. */
let searchNow: ((query: string) => void) | undefined;
let refreshKey: (() => void) | undefined;
let pendingQuery: string | null = null;

/** Makes the next visit to Search run `query` (e.g. the command palette's "Search all results"). */
export function searchNextFor(query: string): void {
  pendingQuery = query.trim() || null;
}

/** Whether a search is someone's name, as TMDB has it. */
const isPerson = (person: PersonHit, query: string) => normalize(person.name) === normalize(query);

/** Genre names in every interface language, normalized, for reading searches like "meilleurs films d'horreur". */
let genreNames: Record<string, GenreKey> | undefined;
function searchGenreNames(): Record<string, GenreKey> {
  if (genreNames) return genreNames;
  const names = genreNamesFrom((key) => everyTranslation(GENRE_LABELS[key]));
  // The other languages' catalogs load on the first search (they're kept out of startup); until
  // then the interface's language and English are read, and the names are made again once all are in.
  if (everyCatalogLoaded()) genreNames = names;
  else void loadEveryCatalog();
  return names;
}

/** A language's or country's name in the interface language, capitalized for a chip ("Korean", "India"). */
function placeName(code: string, type: 'language' | 'region'): string {
  let name = code;
  try {
    name = new Intl.DisplayNames([locale()], { type }).of(code) ?? code;
  } catch {
    // An engine without names for this code: the code itself.
  }
  return name.charAt(0).toLocaleUpperCase(locale()) + name.slice(1);
}

/** What a filter chip says. Years go in as text, so they aren't written "2,015". */
function chipLabel(chip: IntentChip): string {
  switch (chip.kind) {
    case 'words':
      return t('search.smart.words', { words: chip.text });
    case 'like':
      return t('search.suggestions.like', { title: chip.title });
    case 'genre':
      return t(GENRE_LABELS[chip.genre]);
    case 'anime':
      return t('search.smart.anime');
    case 'media':
      return t(chip.media === 'movie' ? 'browse.search.movies' : 'browse.search.series');
    case 'language':
      return placeName(chip.code, 'language');
    case 'country':
      return t('search.smart.country', { country: placeName(chip.code, 'region') });
    case 'years': {
      const { from, to } = chip;
      if (from !== undefined && to !== undefined) {
        if (from === to) return String(from);
        return from % 10 === 0 && to === from + 9 ? t('search.smart.decade', { decade: String(from) }) : `${from}–${to}`;
      }
      return from !== undefined ? t('search.smart.since', { year: String(from) }) : t('search.smart.before', { year: String(to! + 1) });
    }
    case 'runtime':
      return chip.max === 'short' ? t('search.smart.short') : t('search.smart.under', { minutes: String(chip.max) });
    case 'sort':
      return t(chip.sort === 'top' ? 'search.smart.top' : 'search.smart.new');
  }
}

/**
 * Search: one field across every addon that supports it, plus people and
 * natural-language suggestions from TMDB when a token is saved. Results are
 * merged by id (IMDb ids for Cinemeta-style addons), topped by the best
 * match and grouped into Movies, TV Shows and People.
 */
export const searchRoom: Room = {
  id: 'search',
  label: t('browse.nav.search'),
  shortcut: 'app.search',
  render(ctx) {
    return searchPage(ctx);
  },
  // Choosing Search (click, Enter, its shortcut or the command palette) is an explicit request to type.
  onShow() {
    refreshKey?.();
    const asked = pendingQuery;
    if (asked) searchNow?.(asked);
    pendingQuery = null;
    // Android: a search that arrived (voice, the system's) shows its results, not the on-screen keyboard over them.
    if (field?.isConnected && !(isAndroid && asked)) beginEditing(field);
  },
};

function searchPage(ctx: RoomContext): HTMLElement {
  const { openDetail, play, withMenu } = titleHandlers(ctx);
  let filter: Tab = 'all';
  /** Recent searches are kept per profile; saves go under the key `profileSetting` finds. */
  const recent = recentSearches(profileSetting(RECENT_KEY), (key, list) => settings.set(key, list));
  let results: Results | null = null;
  /** A pasted stream or magnet link: offered to play, never searched for or remembered (it may hold a key). */
  let link: PastedLink | null = null;
  let error: unknown = null;
  /** The search that `error` stopped, for Try again. */
  let failedQuery = '';
  let loading = false;
  let generation = 0;
  /** The words of the search shown or loading. */
  let searched = '';
  let timer: number | undefined;
  let refs: Promise<CatalogRef[]> | undefined;
  /** Whether a TMDB token is saved (null until known); checked again each time the page is shown. */
  let tmdb: boolean | null = null;
  let idle: ((tab: Tab) => HTMLElement) | undefined;

  const input = createTextField({
    label: t('browse.search.placeholder'),
    placeholder: t('search.placeholder'),
    className: 'search-input',
    onSubmit: (value) => {
      window.clearTimeout(timer);
      void run(value, true);
    },
  });
  field = input;
  // Example searches cycle through the empty field (Settings → Appearance → Little extras).
  rotateSearchHints(input);

  const clearButton = h('button', { class: 'search-clear', title: t('browse.search.clear'), 'aria-label': t('browse.search.clear-search') }, icon('close'));
  clearButton.addEventListener('click', () => clear());

  // Android TV: Android's own speech prompt fills the search, since typing with a remote is slow.
  const voiceButton = h('button', { class: 'search-clear search-voice', title: t('search.voice'), 'aria-label': t('search.voice') }, icon('mic'));
  voiceButton.addEventListener('click', () => {
    void invoke<string | null>('search_listen', { prompt: t('search.voice-prompt') })
      .then((heard) => heard && searchFor(heard))
      .catch(() => toast(t('search.voice-none')));
  });

  const segments = h('div', { class: 'segments', role: 'group', 'aria-label': t('browse.search.type') });
  const note = h('span', { class: 'search-note', role: 'status' });
  const recentSlot = h('div', { class: 'search-recent-slot' });
  const body = h('div', { class: 'search-body' });
  const notice = h('div', { class: 'search-notice-slot' });

  // Search's own key (/ by default), kept current when it's changed in Settings → Shortcuts.
  const kbd = h('kbd', { class: 'search-kbd' });
  refreshKey = () => {
    const key = firstKey('app.search');
    kbd.textContent = key ?? '';
    // No keyboard to press it on with a TV remote.
    kbd.hidden = !key || isAndroid;
  };
  refreshKey();

  const page = h(
    'div',
    { class: 'search' },
    h(
      'div',
      { class: 'search-head search-pad' },
      h('h1', { class: 'search-title' }, t('search.title')),
      h('div', { class: 'search-box' }, icon('search'), input, clearButton, isAndroid ? voiceButton : '', kbd),
      h('div', { class: 'search-options' }, segments, note),
    ),
    recentSlot,
    body,
    notice,
  );

  input.addEventListener('input', () => {
    clearButton.hidden = !input.value;
    window.clearTimeout(timer);
    if (!input.value.trim()) {
      generation++;
      results = null;
      link = null;
      error = null;
      loading = false;
      render();
      return;
    }
    // A space before the next word, or one taken off the end, is the same search: what's shown (or loading) stays.
    if (input.value.trim() === searched && (results || loading)) return;
    timer = window.setTimeout(() => void run(input.value, false), DEBOUNCE_MS);
  });

  function clear(): void {
    window.clearTimeout(timer);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    beginEditing(input);
  }

  function searchFor(query: string): void {
    input.value = query;
    clearButton.hidden = false;
    window.clearTimeout(timer);
    void run(query, true);
  }
  searchNow = searchFor;

  /** Every searchable catalog, in the user's addon order; loaded on first use. */
  function searchRefs(): Promise<CatalogRef[]> {
    if (!refs) {
      const current = usableAddons().then(searchableCatalogs);
      // Only this one: an addon change may already have replaced it.
      current.catch(() => refs === current && (refs = undefined));
      refs = current;
    }
    return refs;
  }

  /** Every addon's results for `query`, merged and ranked (as `rankAs`, when given), within the profile's content limit. */
  async function addonSearch(query: string, rankAs = query): Promise<{ titles: Title[]; failures: Results['failures']; allFailed: boolean; noneCanSearch: boolean }> {
    const catalogs = await searchRefs();
    const settled = await Promise.allSettled(catalogs.map((ref) => loadCatalog(ref, [['search', query]])));
    const failures = new Map<string, string>();
    settled.forEach((outcome, i) => {
      if (outcome.status === 'rejected') failures.set(catalogs[i]!.addon.manifest.name, errorText(outcome.reason));
    });
    const lists = settled.map((outcome) => (outcome.status === 'fulfilled' ? outcome.value : []));
    // Only titles the profile's content limit allows (this waits briefly for their ratings).
    const titles = await allowedTitles(rankResults(mergeResults(lists), rankAs));
    const allFailed = settled.length > 0 && settled.every((outcome) => outcome.status === 'rejected');
    return { titles, failures: [...failures].map(([name, reason]) => ({ name, reason })), allFailed, noneCanSearch: !catalogs.length };
  }

  /** `addonSearch`, and a looser query ("dune 2021" as "dune", "Amélie" as "amelie") when it finds nothing. */
  async function addonSearchLenient(query: string): Promise<{ titles: Title[]; failures: Results['failures']; noneCanSearch: boolean }> {
    const { titles, failures, noneCanSearch } = await searchLeniently(query, addonSearch);
    return { titles, failures, noneCanSearch };
  }

  /** The filter chip to focus once the next search is shown (one was just removed), if any. */
  let focusChip: number | null = null;

  /**
   * Runs a search. `reading` replaces how the words are read: a reading
   * with some filters removed, or null for a plain search of the words.
   */
  async function run(raw: string, remember: boolean, reading?: SearchIntent | null): Promise<void> {
    // This run's own: one a newer search replaces mustn't leave it for that search to pull focus out of the field.
    const focusTo = focusChip;
    focusChip = null;
    const query = raw.trim();
    if (!query) return;
    link = linkIn(query);
    if (link) {
      generation++;
      results = null;
      error = null;
      loading = false;
      render();
      return;
    }
    // Not waited for: a newer search (or clearing the field) while it saves must still win.
    if (remember) void rememberQuery(query);
    const current = ++generation;
    searched = query;
    loading = true;
    error = null;
    render();
    try {
      // An id or a pasted link names one title: that's the answer, not a text search for "tt0133093".
      const ref = parseTitleRef(query);
      if (ref) {
        const found = await resolveTitleRef(ref);
        if (current !== generation) return;
        results = { query, titles: found ? [found] : [], failures: [], people: [], suggestions: null, exact: true };
        loading = false;
        render();
        return;
      }
      const connected = tmdb ?? (await tmdbConnected());
      const parsed = reading === undefined ? parseSearchIntent(query, { genreNames: searchGenreNames() }) : reading;
      const intent = connected ? parsed : null;
      const smart = intent?.kind === 'discover' || intent?.kind === 'like' ? intent : null;
      // People and suggestions are extras: if TMDB can't answer, the addons' results still show.
      const findPeople = connected && !smart ? searchPeople(query).catch(() => null) : Promise.resolve(null);
      // A search for someone by name ("tom hanks") suggests their titles.
      const read = intent ? Promise.resolve(intent) : reading === null ? Promise.resolve(null) : findPeople.then((people) => (people?.[0] && isPerson(people[0], query) ? ({ kind: 'person', media: 'both', name: people[0].name } as const) : null));
      const searchWords = (words: string) => addonSearch(words).then((found) => found.titles);
      const addons = addonSearchLenient(query);
      // Once the addons have answered, extras get a moment more rather than TMDB's whole timeout
      // (10 s, longer when rate limited): a slow TMDB mustn't hold the results back.
      const extra = <T>(promise: Promise<T>): Promise<T | null> => Promise.race([promise, addons.then(() => new Promise<null>((resolve) => window.setTimeout(() => resolve(null), EXTRAS_GRACE_MS)))]);
      let suggestFailed: unknown;
      const suggested = read
        // A reading as filters loads movies and shows alike, whichever tab is open, so switching tabs needs no reload.
        .then((r) => (r ? suggestionsFor(r, query, smart ? 'all' : filter, searchWords) : null))
        .catch((err: unknown) => {
          console.warn('Could not load suggestions', err);
          suggestFailed = err;
          return null;
        });
      const [found, people, suggestions] = await Promise.all([
        addons,
        extra(findPeople),
        // A search read as filters has nothing else to show: its suggestions are waited for.
        smart ? suggested : extra(suggested),
      ]);
      if (current !== generation) return;
      // A reading the person chose by removing filters stands; one Orbit guessed gives way to a title called exactly that.
      const stands = reading !== undefined || intentStands(query, found.titles);
      if (smart && suggestions && stands) {
        results = { query, ...found, people: [], suggestions: null, smart: { intent: smart, found: suggestions } };
      } else {
        const person = !smart && suggestions && stands && suggestions.titles.length ? suggestions : null;
        results = { query, ...found, people: people ?? [], suggestions: person, needsTmdb: !connected && !!parsed && parsed.kind !== 'person', smartFailed: smart ? suggestFailed : undefined };
      }
    } catch (err) {
      if (current !== generation) return;
      error = err;
      failedQuery = query;
    }
    loading = false;
    render();
    restoreFocus(focusTo);
  }

  /** After a filter was removed: focus the chip that took its place (or the next best thing), so the keyboard isn't left on nothing. */
  function restoreFocus(index: number | null): void {
    if (index === null) return;
    const removes = [...body.querySelectorAll<HTMLElement>('.smart-chip .recent-remove')];
    const target = removes[Math.min(index, removes.length - 1)] ?? body.querySelector<HTMLElement>('.smart-plain') ?? body.querySelector<HTMLElement>('button, [tabindex="0"]');
    target?.focus({ preventScroll: true });
  }

  async function rememberQuery(query: string): Promise<void> {
    await recent.add(query).catch((err: unknown) => console.warn('Could not save recent searches', err));
  }

  /** The chip that takes the removed one's place (`focusAt`) gets focus, else the field: a keyboard or controller isn't left on nothing. */
  async function setRecent(next: string[], focusAt: number): Promise<void> {
    await recent.set(next).catch((err: unknown) => console.warn('Could not save recent searches', err));
    // Unless focus has moved on meanwhile.
    const hadFocus = !document.activeElement || document.activeElement === document.body || recentSlot.contains(document.activeElement);
    render();
    if (!hadFocus) return;
    const removes = [...recentSlot.querySelectorAll<HTMLElement>('.recent-remove')];
    (removes[Math.min(focusAt, removes.length - 1)] ?? input).focus({ preventScroll: true });
  }

  function render(): void {
    // The tabs and recent searches are drawn again on every render (a search finishing, TMDB found):
    // the keyboard stays on the one it was on, or goes to the field if that one has gone.
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement && (segments.contains(active) || recentSlot.contains(active)) ? active.dataset.focusId : undefined;
    segments.replaceChildren(
      ...FILTERS.map(([value, text]) => {
        const button = h('button', { class: 'segment', 'aria-pressed': String(filter === value), 'data-focus-id': `search-tab:${value}` }, text);
        button.addEventListener('click', () => {
          if (filter === value) return;
          filter = value;
          render();
          // The tabs redrew under the keyboard: keep focus on the one chosen.
          segments.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
        });
        return button;
      }),
    );

    const typing = !!results || loading || !!error || !!link;
    recentSlot.replaceChildren(typing ? '' : recentSection());
    notice.replaceChildren(!typing && tmdb === false ? noTmdbNotice() : '');
    const padded = (el: HTMLElement) => h('div', { class: 'search-pad' }, el);
    if (link) body.replaceChildren(padded(linkState(link)));
    else if (error) body.replaceChildren(padded(failedState(error, failedQuery)));
    else if (loading) body.replaceChildren(loadingState());
    else if (results?.smart) body.replaceChildren(smartState(results, results.smart));
    else if (results?.exact && !results.titles.length) body.replaceChildren(padded(stateMessage({ icon: 'search', title: t('pages.ref.none'), detail: t('pages.ref.none-detail') })));
    else if (results) body.replaceChildren(results.needsTmdb ? padded(needsTmdbLine()) : '', hasAnything(results) ? resultsState(results) : padded(noResults(results)));
    else body.replaceChildren(idle?.(filter) ?? '');
    if (focusId) (page.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`) ?? input).focus({ preventScroll: true });
  }

  /** A pasted link: Play, or (a magnet with torrents off) why it can't play and where to turn them on. */
  function linkState(found: PastedLink): HTMLElement {
    if (!canPlayLink(found)) {
      const open = h('button', { class: 'button primary' }, t('pastelink.torrents-off.open'));
      open.addEventListener('click', () => openTorrentSetting(ctx));
      return stateMessage({ icon: 'link', title: t('pastelink.torrents-off.title'), detail: t('pastelink.torrents-off.detail'), action: open });
    }
    const play = h('button', { class: 'button primary' }, icon('play'), t(found.kind === 'magnet' ? 'pastelink.play-magnet' : 'pastelink.play'));
    play.addEventListener('click', () => playLink(found, ctx));
    return stateMessage({ icon: 'link', title: linkLine(found), detail: t('pastelink.detail'), action: play });
  }

  function recentSection(): HTMLElement | '' {
    if (!recent.list.length) return '';
    const clearAll = h('button', { class: 'text-button' }, t('browse.search.clear'));
    clearAll.addEventListener('click', () => void setRecent([], 0));
    return h(
      'section',
      { class: 'search-section search-pad' },
      h('div', { class: 'search-section-head' }, h('h2', { class: 'search-heading' }, icon('clock'), t('browse.search.recent')), clearAll),
      h('div', { class: 'chips' }, ...recent.list.map((query, index) => recentChip(query, index))),
    );
  }

  function recentChip(query: string, index: number): HTMLElement {
    const pick = h('button', { class: 'recent-pick', title: query, 'data-focus-id': `recent:${query}` }, query);
    pick.addEventListener('click', () => searchFor(query));
    const remove = h('button', { class: 'recent-remove', title: t('browse.search.remove'), 'aria-label': t('browse.search.remove-query', { query }), 'data-focus-id': `recent-remove:${query}` }, icon('close'));
    remove.addEventListener('click', () => void setRecent(recent.list.filter((r) => r !== query), index));
    return h('span', { class: 'recent-chip' }, pick, remove);
  }

  function loadingState(): HTMLElement {
    return h(
      'div',
      { class: 'search-results search-pad', 'aria-busy': 'true' },
      h('div', { class: 'skeleton search-top-skeleton' }),
      h('div', { class: 'title-grid' }, ...gridSkeletons(8)),
    );
  }

  const hasAnything = (found: Results) => found.titles.length > 0 || found.people.length > 0 || !!found.suggestions;
  const ofTab = (titles: Title[]) => titles.filter((title) => filter === 'all' || showKind(title.type) === filter);

  function resultsState(found: Results): HTMLElement {
    const shown = ofTab(found.titles);
    const suggested = ofTab(found.suggestions?.titles ?? []);
    // The best match leads; for a natural-language search, the first suggestion with artwork.
    const fromSuggestions = suggested.find((title) => title.background);
    const top = fromSuggestions ?? shown[0];
    const parts: (HTMLElement | string)[] = [];
    if (top) parts.push(h('div', { class: 'search-pad' }, topResult(top, found.query, !!fromSuggestions, found.exact)));
    if (found.suggestions && suggested.length) parts.push(suggestionsRow(found.suggestions, suggested.filter((title) => title !== top), found.query));
    const movies = shown.filter((title) => title.type === 'movie' && title !== top);
    const series = shown.filter((title) => isShowType(title.type) && title !== top);
    // Someone searched for by name comes before titles that only mention them.
    const people = filter === 'all' && found.people.length ? peopleRow(found.people, found.query) : '';
    if (found.people[0] && isPerson(found.people[0], found.query)) parts.push(people);
    if (movies.length) parts.push(group('movie', movies, found.query));
    if (series.length) parts.push(group('series', series, found.query));
    if (!parts.includes(people)) parts.push(people);
    // All with only people found: their row is the answer, not "No TV shows match".
    if (filter !== 'all' && !top && !movies.length && !series.length) parts.push(h('p', { class: 'muted search-pad' }, t(filter === 'movie' ? 'browse.search.no-movies' : 'browse.search.no-series', { query: found.query })));
    if (found.failures.length) parts.push(h('div', { class: 'search-pad' }, failureLine(found.failures)));
    return h('div', { class: 'search-results' }, ...parts);
  }

  /** A search read as filters: what it was read as, then the titles found for it, laid out like plain results. */
  function smartState(found: Results, smart: NonNullable<Results['smart']>): HTMLElement {
    const shown = ofTab(smart.found.titles);
    // Words searched as a title lead with the best match; filters lead with the first suggestion with artwork.
    const words = smart.intent.kind === 'discover' && !!smart.intent.text;
    const top = words ? shown[0] : shown.find((title) => title.background);
    const parts: (HTMLElement | string)[] = [chipRow(found.query, smart)];
    if (top) parts.push(h('div', { class: 'search-pad' }, topResult(top, found.query, !words)));
    const movies = shown.filter((title) => title.type === 'movie' && title !== top);
    const series = shown.filter((title) => isShowType(title.type) && title !== top);
    if (movies.length) parts.push(group('movie', movies, found.query));
    if (series.length) parts.push(group('series', series, found.query));
    if (!shown.length) {
      const plain = h('button', { class: 'button' }, t('search.smart.plain'));
      plain.addEventListener('click', () => {
        focusChip = 0;
        void run(found.query, false, null);
      });
      parts.push(h('div', { class: 'search-pad' }, stateMessage({ icon: 'search', title: t('search.smart.empty.title'), detail: t('search.smart.empty.detail'), action: plain })));
    }
    return h('div', { class: 'search-results' }, ...parts);
  }

  /** "Showing: Horror · Movies · 2020s", each filter removable, with a way back to a plain search of the words. */
  function chipRow(query: string, smart: NonNullable<Results['smart']>): HTMLElement {
    const chips = intentChips(smart.intent).map(({ chip, without }, index) => {
      // A "like" search shows the title TMDB found ("Heat"), not the words typed ("heat").
      const label = chipLabel(chip.kind === 'like' ? { ...chip, title: smart.found.seed ?? chip.title } : chip);
      const remove = h('button', { class: 'recent-remove', title: t('search.smart.remove', { filter: label }), 'aria-label': t('search.smart.remove', { filter: label }) }, icon('close'));
      remove.addEventListener('click', () => {
        focusChip = index;
        void run(query, false, without);
      });
      return h('span', { class: 'recent-chip smart-chip' }, h('span', { class: 'smart-chip-label' }, label), remove);
    });
    const plain = h('button', { class: 'text-button smart-plain' }, t('search.smart.plain'));
    plain.addEventListener('click', () => {
      focusChip = 0;
      void run(query, false, null);
    });
    const { grid } = smart.found;
    const more = grid && smart.found.titles.length ? h('button', { class: 'text-button smart-discover' }, icon('compass'), t('search.suggestions.discover')) : '';
    if (more && grid) more.addEventListener('click', () => ctx.open(createGridPage(grid, ctx, filter === 'series' ? 'series' : 'movie')));
    return h(
      'div',
      { class: 'smart-row search-pad' },
      h('div', { class: 'smart-chips', role: 'group', 'aria-label': t('search.smart.showing') }, h('span', { class: 'smart-label' }, t('search.smart.showing')), ...chips),
      h('div', { class: 'smart-actions' }, plain, more),
    );
  }

  /** The search reads as filters, but only TMDB can answer them: the plain results follow. */
  function needsTmdbLine(): HTMLElement {
    const open = h('button', { class: 'text-button' }, t('search.no-tmdb.open'));
    open.addEventListener('click', () => {
      openSettingsTo('integrations', '.tmdb-row');
      ctx.go('settings');
    });
    return h('p', { class: 'smart-hint' }, icon('info'), h('span', {}, t('search.smart.no-tmdb')), open);
  }

  /** Opening a result counts as a finished search worth remembering. */
  function opener(title: Title, query: string) {
    return () => {
      void rememberQuery(query);
      openDetail(title);
    };
  }

  function topResult(title: Title, query: string, suggested: boolean, exact = false): HTMLElement {
    const eyebrow = exact ? t('pages.ref.top') : suggested ? t('search.suggestions.top') : t(isShowType(title.type) ? 'browse.search.top-series' : 'browse.search.top-movie');
    return withMenu(
      topResultCard(title, {
        eyebrow,
        playLabel: primaryLabel(title),
        open: opener(title, query),
        play: () => {
          void rememberQuery(query);
          play(title);
        },
      }),
      title,
    );
  }

  const posters = (titles: Title[], query: string) => titles.map((title) => titleCard(title, opener(title, query), {}, (card) => withMenu(card, title)));

  /** Movies or shows: a row under All (its "See all" picks the tab), every result as a grid on its own tab. */
  function group(kind: 'movie' | 'series', titles: Title[], query: string): HTMLElement {
    const label = t(kind === 'movie' ? 'browse.search.movies' : 'browse.search.series');
    if (filter === 'all') {
      return rail({
        title: label,
        source: String(titles.length),
        cards: posters(titles, query),
        onSeeAll: () => {
          filter = kind;
          render();
          segments.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
        },
      });
    }
    return h(
      'section',
      { class: 'search-section search-pad' },
      h('div', { class: 'search-section-head start' }, h('h2', { class: 'search-heading large' }, label), h('span', { class: 'count' }, String(titles.length))),
      h('div', { class: 'title-grid' }, ...posters(titles, query)),
    );
  }

  function suggestionsRow(suggestions: Suggestions, titles: Title[], query: string): HTMLElement {
    const { grid } = suggestions;
    const section = rail({ title: t('search.suggestions.title', { query }), source: suggestions.sub, cards: posters(titles, query), onSeeAll: grid && (() => ctx.open(createGridPage(grid, ctx, filter === 'series' ? 'series' : 'movie'))) });
    section.classList.add('search-suggestions');
    // "See in Discover" in place of the plain "See all": it opens a Discover grid, with its filters.
    const seeAll = section.querySelector('.see-all');
    if (seeAll) seeAll.replaceChildren(icon('compass'), t('search.suggestions.discover'));
    return section;
  }

  function peopleRow(people: PersonHit[], query: string): HTMLElement {
    const cards = people.map((person) =>
      personCard(person, () => {
        void rememberQuery(query);
        ctx.open(createPersonPage(person.id, person.name, ctx));
      }),
    );
    return rail({ title: t('search.people'), source: String(people.length), cards, variant: 'search-people-track' });
  }

  function failureLine(failures: Results['failures']): HTMLElement {
    return h('p', { class: 'search-failures' }, ...failures.map((f) => h('span', {}, t('browse.search.addon-failed', { name: f.name, reason: f.reason }))));
  }

  function noResults(found: Results): HTMLElement {
    const again = () => void run(found.query, false);
    // Every addon failing isn't "no results": say what went wrong instead.
    if (found.failures.length) {
      const retry = h('button', { class: 'button' }, t('browse.search.retry'));
      retry.addEventListener('click', again);
      // Offline, every addon failed for the same reason: one line says it.
      const offline = isOffline();
      const box = stateMessage({
        icon: offline ? 'offline' : 'info',
        title: offline ? t('states.offline.title') : t('browse.search.failed'),
        detail: offline ? t('states.cause.offline') : failureLine(found.failures),
        action: retry,
        tone: 'error',
      });
      retryWhenOnline(box, again);
      return box;
    }
    // A search read as filters ("best horror movies") is answered by TMDB: the addons finding nothing for the
    // words isn't the answer, so "check the spelling" would mislead.
    if (found.smartFailed !== undefined) return errorState({ title: t('browse.search.failed'), err: found.smartFailed, service: 'tmdb', retry: again, go: ctx.go });
    if (found.noneCanSearch) return stateMessage({ icon: 'addons', title: t('browse.search.none-can-search'), action: manageAddons('button primary') });
    const clearSearch = h('button', { class: 'button' }, t('browse.search.clear-search'));
    clearSearch.addEventListener('click', () => clear());
    return stateMessage({
      icon: 'search',
      title: t('browse.search.no-results', { query: found.query }),
      detail: t('browse.search.no-results-detail'),
      action: h('div', { class: 'hero-actions' }, clearSearch, manageAddons()),
    });
  }

  function failedState(err: unknown, query: string): HTMLElement {
    return errorState({ title: t('browse.home.addons-failed'), err, retry: () => void run(query, false), go: ctx.go });
  }

  /** Quiet beside another action; the way forward when it's the only one. */
  function manageAddons(kind = 'button quiet'): HTMLElement {
    const button = h('button', { class: kind }, t('browse.home.manage-addons'));
    button.addEventListener('click', () => {
      openSettingsTo('addons');
      ctx.go('settings');
    });
    return button;
  }

  /** Without TMDB, what connecting it adds here. */
  function noTmdbNotice(): HTMLElement {
    const open = h('button', { class: 'button' }, t('search.no-tmdb.open'));
    open.addEventListener('click', () => {
      openSettingsTo('integrations', '.tmdb-row');
      ctx.go('settings');
    });
    return h('div', { class: 'search-notice' }, h('div', { class: 'search-notice-text' }, h('strong', {}, t('search.no-tmdb.title')), h('span', { class: 'muted' }, t('search.no-tmdb.body'))), open);
  }

  /** Learns whether TMDB is connected; the idle sections start over when that changes. */
  function checkTmdb(): void {
    void tmdbConnected().then((connected) => {
      if (connected === tmdb) return;
      tmdb = connected;
      idle = createIdle({ ctx, openDetail, withMenu, tmdb: connected });
      render();
    });
  }
  // A TMDB token saved (or removed) in Settings shows up when Search is next shown.
  page.addEventListener(VIEW_SHOWN, checkTmdb);

  clearButton.hidden = true;
  render();
  checkTmdb();

  void recent.loaded
    .then(() => {
      if (!results && !loading) render();
    })
    .catch((err: unknown) => console.warn('Could not load recent searches', err));

  /** "Searching N addons", for the addons in use now. */
  let noteRun = 0;
  function showNote(): void {
    const asked = ++noteRun;
    void searchRefs()
      .then((catalogs) => {
        if (asked !== noteRun) return;
        const count = new Set(catalogs.map((r) => r.addon.key)).size;
        note.textContent = count ? tn('browse.search.searching', count) : t('browse.search.none-can-search');
      })
      .catch(() => asked === noteRun && (note.textContent = ''));
  }
  showNote();
  // An addon installed, removed, enabled or disabled changes which catalogs a search asks.
  onAddonsChange(() => {
    refs = undefined;
    showNote();
  });

  return page;
}
