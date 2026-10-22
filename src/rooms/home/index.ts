import { t } from '../../i18n';
import { VIEW_SHOWN, type Room, type RoomContext } from '../../app/router';
import { isShown } from '../../lib/shown';
import { onAddonsChange } from '../../addons/registry';
import { allowedTitles } from '../../catalog/parental';
import { downloadedCopy } from '../../library/downloads';
import { appearance, ROW_STYLE_CHANGED } from '../../theme/appearance';
import { qualityBadges } from './dashboard-data';
import { loadCatalog, usableAddons } from '../../catalog/service';
import { browsableCatalogs, fallbackHue, railTitle, type CatalogRef, type Title } from '../../catalog/titles';
import { continueCard, genreTile, rail } from '../../components/cards';
import { icon } from '../../components/icons';
import { errorState } from '../../components/state-message';
import { h } from '../../lib/dom';
import { STREAMING_CHANGED } from '../../catalog/streaming';
import { recommendationsFor, TMDB_CHANGED, tmdbConnected, tmdbList, type TmdbList } from '../../catalog/tmdb';
import { JELLYFIN_CHANGED } from '../../library/jellyfin';
import { PLEX_CHANGED } from '../../library/plex';
import { inLibrary, libraryEntries, onLibraryChange, toggleLibrary } from '../../library/library';
import { onListsChange } from '../../library/lists';
import { onCollectionsChange } from '../../library/collections';
import { fillContinueWatching } from '../../library/genre-fill';
import { continueWatching, lastWatchedAt, onWatchChange, recentlyWatched, tasteWatched, watchedTitles, watchHistory } from '../../library/watch';
import { titleHandlers } from '../detail/open';
import { knownQuality } from '../detail/quality';
import { openDiscoverAt } from '../discover';
import { openSettingsTo } from '../settings';
import { continueMenu, primaryLabel } from '../detail/title-actions';
import { reportError } from '../../app/errors';
import { settleWithin } from '../../lib/timeout';
import { createHero, heroSkeleton } from './hero';
import { continueRail } from './continue-row';
import { redrawKeepingPlace } from './keep-place';
import { resolveAddedRows, styledRail, type ResolvedRow } from './row-render';
import { arrange, drawStep, HOME_ROWS_CHANGED, homeLayout, pairHalves, setFreshCheck, setKnownRows, styleOf, type HomeLayout, type HomeRow, type RowStyle } from './rows';
import { HOME_SHOWN } from './dashboard';
import { TV_SOURCES_CHANGED } from '../../live/iptv';
import { forYouFeeds, letterboxdFeeds, renderForYou, renderLetterboxd, renderStreaming, streamingFeeds } from './sections';
import { setHomeFeeds, type RowFeed } from './feeds';
import { LETTERBOXD_CHANGED } from '../../catalog/letterboxd';
import './home.css';
import { createWelcomeCard } from './welcome';
import { createChecklistCard } from '../../app/onboarding/checklist';
import { welcomesNewcomer } from '../../app/onboarding/rules';
import { loadChecklist, ONBOARDING_CLOSED } from '../../app/onboarding/state';
import { activeProfileId, chosenName, listProfiles } from '../../library/profiles';
import { onAlertsChange } from '../../library/alerts';
import { refreshCardTags, setCardTags } from './card-tags';
import { moodChipsRow, onlyOnRow } from './chip-rows';
import { dayPart } from './extras';
import { daySeed, mixHero, type HeroPick } from './hero-mix';
import { decodeHero, encodeHero, heroKey, readHero, writeHero } from './hero-cache';
import { openGenrePage } from './genre-page';
import { nearObserver } from '../../lib/near-view';

const RAIL_TYPES = new Set(['movie', 'series']);
/** "Because you watched…" rails, from the most recently watched titles. */
const FOR_YOU_SEEDS = 2;
/** The titles "Because you watched…" and the banner's picks start from: the latest watched for real, with IMDb ids. */
const tasteSeeds = () => tasteWatched()
  .filter((title) => /^tt\d+$/.test(title.id))
  .slice(0, FOR_YOU_SEEDS);
/** How long Home's first draw waits for added rows that need the network (see `applyRows`). */
const ADDED_ROWS_WAIT_MS = 400;

/** Home: featured hero, first-run card, Continue Watching, Top 10, catalog rails, genres. */
export const homeRoom: Room = {
  id: 'home',
  label: t('browse.nav.home'),
  keep: true,
  render(ctx) {
    const { openDetail, play, withMenu } = titleHandlers(ctx);

    const heroSlot = h('div', { class: 'hero-slot' }, heroSkeleton());
    const railsSlot = h('div', { class: 'home-rails' });
    // Continue Watching follows watch history as it changes (e.g. after the player closes).
    const cwSlot = h('div', { class: 'cw-slot' });
    let continueDraws = 0;
    const renderContinue = () => {
      const cw = continueWatching();
      const draw = ++continueDraws;
      const cards = cw.map((entry) => withMenu(continueCard(entry, () => play(entry.title)), entry.title, continueMenu(entry.title)));
      // As other rows: drawn with the cards a profile's content limit keeps, and not at all when it hides every one
      // (a heading over an empty gap otherwise), then again once ratings it was still waiting for land (continue-row.ts;
      // `redrawContinue` is the one function it waits by, so the row has one wait at a time). Without a limit that's
      // every card, at once.
      void continueRail(cw.map((entry) => entry.title), cards, redrawContinue).then((row) => {
        if (draw !== continueDraws) return;
        redrawKeepingPlace(cwSlot, () => cwSlot.replaceChildren(row ?? ''));
      });
      // Titles brought in from elsewhere (Stremio sync, imports) get their artwork and details filled in.
      void fillContinueWatching(cw.map((entry) => entry.title));
    };
    // While another page (e.g. the player, saving progress every few seconds)
    // is up, redraws wait until Home shows again.
    const stale = new Set<() => void>();
    const whenShown = (draw: () => void) => () => (isShown(page) ? draw() : stale.add(draw));
    const redrawContinue = whenShown(renderContinue);
    renderContinue();
    onWatchChange(redrawContinue);
    // "Because you watched…" follows the titles most recently watched for real, not a minute's look.
    const forYouSlot = h('div', { class: 'for-you-slot' });
    let forYouSeeds = '';
    const refreshForYou = () => {
      const seeds = tasteSeeds();
      const key = seeds.map((t) => t.id).join();
      if (key === forYouSeeds) return;
      forYouSeeds = key;
      void renderForYou(forYouSlot, seeds, { openDetail, withMenu, go: ctx.go });
    };
    refreshForYou();
    onWatchChange(whenShown(refreshForYou));
    // The rows come from TMDB, so a token saved or removed redraws them even for the same titles.
    document.addEventListener(TMDB_CHANGED, () => {
      forYouSeeds = '';
      refreshForYou();
    });

    // A quiet way into the Home builder, after the rows it arranges (shown once they're drawn).
    const edit = h('button', { class: 'button home-edit' }, icon('sliders'), t('browse.home.edit'));
    edit.addEventListener('click', () => {
      openSettingsTo('library', '.home-rows-section');
      ctx.go('settings');
    });
    const footer = h('div', { class: 'home-footer', hidden: true }, edit);

    // "Good evening, Sam": quiet, above the rows; shown once the layout says it's on.
    const greeting = h('p', { class: 'home-greeting', hidden: true });
    const greet = () => void greetingText().then((text) => (greeting.textContent = text));
    greet();
    // First-run setup just ended (Getting started starts then): a new install is welcomed.
    document.addEventListener(ONBOARDING_CLOSED, greet);

    const page = h(
      'div',
      { class: 'home' },
      heroSlot,
      greeting,
      createWelcomeCard(ctx),
      createChecklistCard(ctx, greet),
      cwSlot,
      forYouSlot,
      railsSlot,
      footer,
    );
    // The browser only draws a skipped row once it's right at the screen's edge,
    // so a fast scroll outran it and rows (and the banner) showed blank. Rows
    // within a screen and a half are drawn ahead (home.css `.near`).
    // Watched in the outlet Home scrolls in (lib/near-view.ts): watching the window, the margin never reached past the screen.
    const near = nearObserver(
      (entries) => {
        // Hidden while another view shows, every row reads as far away: the rows keep what they had,
        // so coming back finds them laid out as they were instead of skipped and then laid out again.
        if (!isShown(page)) return;
        for (const entry of entries) entry.target.classList.toggle('near', entry.isIntersecting);
      },
      '150% 0px',
    );
    // The rows' contents: a `.home-row` itself has no box to watch.
    const watched = new WeakSet<Element>();
    const watch = (row: Element): void => {
      if (watched.has(row)) return;
      watched.add(row);
      near.observe(row);
    };
    const isRow = (node: Node): node is Element => node instanceof Element && node.classList.contains('home-row') && node.parentNode === railsSlot;
    // The browser hands over a burst of changes at once. Most are cards filling in deep
    // inside a row, so only rows (and their contents) coming or going are looked at.
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.target === railsSlot) {
          for (const node of record.addedNodes) if (isRow(node)) for (const row of node.children) watch(row);
        } else if (isRow(record.target)) {
          for (const node of record.addedNodes) if (node instanceof Element) watch(node);
          for (const node of record.removedNodes) {
            if (node instanceof Element && watched.delete(node)) near.unobserve(node);
          }
        }
      }
    }).observe(railsSlot, { childList: true, subtree: true });
    for (const row of railsSlot.querySelectorAll(':scope > .home-row > *')) watch(row);
    page.addEventListener(VIEW_SHOWN, () => {
      // The time of day may have moved on since Home was last shown.
      greet();
      for (const draw of stale) draw();
      stale.clear();
      document.dispatchEvent(new Event(HOME_SHOWN));
    });
    /** What the current attempt at loading Home subscribed to; a retry drops it first, so nothing is registered twice. */
    let attempt: AbortController | undefined;
    const start = (): void => {
      attempt?.abort();
      attempt = new AbortController();
      const { signal } = attempt;
      void loadHome(ctx, { page, heroSlot, greeting, railsSlot, cwSlot, forYouSlot, openDetail, play, withMenu, go: ctx.go, retry, whenShown, signal })
        .then((drawn) => {
          if (!signal.aborted) footer.hidden = !drawn;
        })
        // Never a skeleton that stays: whatever went wrong ends in a message with Retry.
        .catch((err: unknown) => {
          if (signal.aborted) return;
          reportError('Home could not load', err);
          heroSlot.replaceChildren();
          if (!railsSlot.childElementCount) railsSlot.replaceChildren(errorState({ title: t('browse.home.addons-failed'), err, retry, go: ctx.go }));
        });
    };
    const retry = (): void => {
      heroSlot.replaceChildren(heroSkeleton());
      railsSlot.replaceChildren();
      start();
    };
    start();
    // The banner's form as soon as the layout is read (after `start`, which sets up its first read), so it doesn't change height once drawn.
    void homeLayout()
      .then((layout) => {
        page.classList.toggle('hero-next', !!layout.heroNext);
        greeting.hidden = layout.greeting === false;
      })
      .catch(() => {});
    // Card tags ("New episode") follow the new-episode alerts as they're checked.
    onAlertsChange(() => refreshCardTags(railsSlot));
    return page;
  },
};

interface HomeParts {
  page: HTMLElement;
  heroSlot: HTMLElement;
  greeting: HTMLElement;
  railsSlot: HTMLElement;
  cwSlot: HTMLElement;
  forYouSlot: HTMLElement;
  openDetail(title: Title): void;
  play(title: Title): void;
  withMenu(card: HTMLElement, title: Title): HTMLElement;
  go(room: string): void;
  /** Starts Home's rows over, after they failed to load. */
  retry(): void;
  /** `draw`, now if Home is on the page, else once it's shown again. */
  whenShown(draw: () => void): () => void;
  /** Aborted when a retry starts over: listeners this attempt added go with it. */
  signal: AbortSignal;
}

/** "Good evening, Sam" for the active profile, by the local time of day; "Welcome to Orbit" on a new install. */
async function greetingText(): Promise<string> {
  const [id, profiles, checklist] = await Promise.all([activeProfileId().catch(() => null), listProfiles().catch(() => []), loadChecklist().catch(() => null)]);
  if (welcomesNewcomer(checklist, watchHistory().titles.length)) return t('homerows.greeting.welcome');
  const profile = profiles.find((p) => p.id === id);
  // A new install's profile is still called by its placeholder: greeted without a name.
  const name = profile && chosenName(profile);
  const part = dayPart(new Date().getHours());
  return name ? t(`homerows.greeting.${part}`, { name }) : t(`homerows.greeting.${part}-plain`);
}

/** Draws Home's rows; false if there are none to draw (no addons or catalogs). */
async function loadHome(ctx: RoomContext, parts: HomeParts): Promise<boolean> {
  const { signal } = parts;
  const until = (unsubscribe: () => unknown): void => {
    if (signal.aborted) unsubscribe();
    else signal.addEventListener('abort', unsubscribe, { once: true });
  };
  // A profile that hasn't watched or saved anything gets the default mood rows on its first Home.
  setFreshCheck(() => !recentlyWatched().length && !libraryEntries().length);
  // Today's banner from the last start, while the addons and TMDB answer.
  void showSavedHero(parts).catch((err: unknown) => console.warn('Could not show the saved featured titles', err));
  let allRefs: CatalogRef[];
  let refs: CatalogRef[];
  try {
    allRefs = browsableCatalogs(await usableAddons());
    refs = allRefs.filter((ref) => RAIL_TYPES.has(ref.catalog.type));
  } catch (err) {
    if (signal.aborted) return false;
    parts.heroSlot.replaceChildren();
    parts.railsSlot.replaceChildren(errorState({ title: t('browse.home.addons-failed'), err, retry: parts.retry, go: ctx.go }));
    // Fixing the addons in Settings (this one's own button leads there) brings the rows back.
    until(onAddonsChange(parts.retry));
    return false;
  }
  // Started over meanwhile (a retry, an addon or TMDB change): the newer attempt draws Home.
  if (signal.aborted) return false;

  if (!refs.length) {
    const manage = h('button', { class: 'button large primary' }, t('browse.home.manage-addons'));
    manage.addEventListener('click', () => ctx.go('settings'));
    parts.heroSlot.replaceChildren();
    parts.railsSlot.replaceChildren(homeMessage(t('browse.home.no-catalogs'), t('browse.home.no-catalogs-detail'), manage));
    // Installing or enabling an addon with catalogs draws Home's rows, without a restart.
    until(onAddonsChange(parts.retry));
    return false;
  }

  // With a TMDB token, Top 10 and Trending come from TMDB and every catalog
  // is a rail. Otherwise the first movie catalog becomes Top 10.
  const tmdb = await tmdbConnected();
  if (signal.aborted) return false;
  // Saving or removing the token in Settings changes which rows Home has: it starts over.
  document.addEventListener(TMDB_CHANGED, parts.retry, { signal });
  const top = refs.find((ref) => ref.catalog.type === 'movie') ?? refs[0]!;
  // Built-in catalogs (Cinemeta) go unlabelled; an installed addon's rows say which addon they're from.
  const source = (ref: CatalogRef) => (ref.addon.builtIn ? undefined : ref.addon.manifest.name);
  const seeAll = (ref: CatalogRef) => () => showInDiscover(ctx, ref, { catalogId: ref.catalog.id });
  const tmdbRow = (id: string, title: string, list: TmdbList, defaultStyle: RowStyle): BuiltinRow => {
    const feed: RowFeed = { title, load: async () => (await tmdbList(list)) ?? [] };
    return { id, label: title, defaultStyle, make: (style) => styledRail({ ...feed, style }, parts), feeds: () => [feed] };
  };
  /** A catalog's row; `title` is the rail's heading (Top 10's differs from the catalog's name). */
  const catalogRow = (id: string, label: string, ref: CatalogRef, title: string, defaultStyle: RowStyle, onSeeAll?: () => void): BuiltinRow => {
    const feed: RowFeed = { title, load: () => loadCatalog(ref) };
    return { id, label, defaultStyle, make: (style) => styledRail({ ...feed, source: source(ref), onSeeAll, style }, parts), feeds: () => [feed] };
  };

  // "Popular on Netflix" etc. for the services picked in Settings, kept up to date.
  const streamingSlot = h('div', { class: 'streaming-slot' });
  if (tmdb) {
    const render = () => void renderStreaming(streamingSlot, parts, ctx);
    render();
    document.addEventListener(STREAMING_CHANGED, render, { signal });
  }

  // Mood chips and "Only on…" open a row of titles under themselves; made once, so a redraw keeps the pick.
  // The chips follow addon updates (see `onAddonsChange` below) and the streaming region (the country chip).
  let chipRefs = refs;
  const moodChips = moodChipsRow({ refs: () => chipRefs, tmdb, actions: parts, signal });
  if (tmdb) document.addEventListener(STREAMING_CHANGED, () => moodChips.refresh(), { signal });
  const onlyOn = tmdb ? onlyOnRow(parts, ctx, signal) : null;
  if (onlyOn) document.addEventListener(STREAMING_CHANGED, () => onlyOn.refresh(), { signal });

  // Letterboxd's rows, from the profile connected in Settings (if any).
  const letterboxdSlot = h('div', { class: 'letterboxd-slot' });
  const renderLb = () => void renderLetterboxd(letterboxdSlot, parts);
  renderLb();
  document.addEventListener(LETTERBOXD_CHANGED, renderLb, { signal });

  // Every row has a stable id and a name, so it can be reordered, hidden or
  // restyled (Settings → Library & Metadata → Home rows). Rails take their
  // style from the layout; the other sections are fixed.
  // Tiles look the genre up in the catalogs as they are when clicked (an addon update may change them).
  const genres = genreSection(top, ctx, () => deps.refs);
  const fixed = (id: string, label: string, element: HTMLElement, feeds?: BuiltinRow['feeds']): BuiltinRow => ({ id, label, make: () => element, ...(feeds ? { feeds } : {}) });
  const continueFeed: RowFeed = { title: t('browse.home.continue-watching'), load: async () => continueWatching().map((entry) => entry.title) };
  // Rebuilt when a refreshed addon brings or drops catalogs (see `onAddonsChange` below).
  const builtinRows = (refs: CatalogRef[]): BuiltinRow[] => {
    const top = refs.find((ref) => ref.catalog.type === 'movie') ?? refs[0]!;
    const topLabel = t(top.catalog.type === 'series' ? 'browse.home.top-series' : 'browse.home.top-movies');
    return [
      fixed('mood-chips', t('homerows.chips.label'), moodChips),
      fixed('continue', t('browse.home.continue-watching'), parts.cwSlot, () => [continueFeed]),
      fixed('for-you', t('browse.home.for-you-row'), parts.forYouSlot, () => forYouFeeds(tasteSeeds())),
      fixed('letterboxd', t('browse.home.letterboxd-row'), letterboxdSlot, letterboxdFeeds),
      ...(tmdb
        ? [
            tmdbRow('tmdb-movies-today', t('browse.home.top-movies-today'), 'movies-today', 'top10'),
            tmdbRow('tmdb-series-today', t('browse.home.top-series-today'), 'series-today', 'top10'),
            tmdbRow('tmdb-trending-week', t('browse.home.trending-week'), 'trending-week', 'poster'),
            fixed('streaming', t('browse.home.streaming-row'), streamingSlot, streamingFeeds),
            ...(onlyOn ? [fixed('only-on', t('homerows.only-on.label'), onlyOn)] : []),
          ]
        : [catalogRow('top', t('browse.home.row-source', { row: topLabel, source: top.addon.manifest.name }), top, topLabel, 'top10')]),
      ...refs
        .filter((ref) => tmdb || ref !== top)
        .map((ref) =>
          catalogRow(
            `catalog:${ref.addon.manifest.id}:${ref.catalog.type}:${ref.catalog.id}`,
            t('browse.home.row-source', { row: railTitle(ref.catalog), source: ref.addon.manifest.name }),
            ref,
            railTitle(ref.catalog),
            'poster',
            seeAll(ref),
          ),
        ),
    ];
  };
  let builtins = builtinRows(refs);
  const genreRow = genres ? fixed('genres', t('browse.home.genres'), genres) : null;
  const deps = { ...parts, ctx, refs: allRefs, openCatalog: (ref: CatalogRef, genre?: string) => showInDiscover(ctx, ref, { catalogId: ref.catalog.id, ...(genre ? { genre } : {}) }) };

  // Rows are rebuilt only when their style, name or contents change, so a
  // reorder doesn't reload them.
  const drawn = new Map<string, { sig: string; wrapper: HTMLElement; empty: boolean; made: boolean }>();
  let applying = 0;
  const applyRows = async () => {
    const run = ++applying;
    const layout = await homeLayout();
    // Follows the Home builder's banner option.
    parts.page.classList.toggle('hero-next', !!layout.heroNext);
    parts.greeting.hidden = layout.greeting === false;
    setCardTags(layout.cardTags !== false, parts.railsSlot);
    // Added rows may need the network (streaming services from TMDB, Jellyfin's and Plex's
    // libraries); on the first draw Home's own rows don't wait long for them, and
    // they slot in when ready. Later redraws wait, so rows already shown don't blink.
    const resolving = resolveAddedRows(layout.added, deps).catch((err: unknown) => {
      console.warn('Could not prepare the added Home rows', err);
      return new Map<string, ResolvedRow>();
    });
    const quick = drawn.size ? await resolving : await settleWithin(resolving, ADDED_ROWS_WAIT_MS, null);
    // Rows of an attempt a retry replaced mustn't land among the new attempt's.
    if (run !== applying || signal.aborted) return;
    if (quick) return draw(layout, quick);
    draw(layout, new Map());
    const added = await resolving;
    if (run === applying && !signal.aborted) draw(layout, added);
  };
  const draw = (layout: HomeLayout, added: Map<string, ResolvedRow>) => {
    interface Entry extends HomeRow {
      sig: string;
      make(): HTMLElement | null;
      feeds?: BuiltinRow['feeds'];
    }
    const builtin = (row: BuiltinRow): Entry => {
      const style = row.defaultStyle && styleOf(layout, row.id, row.defaultStyle, appearance().rowStyle);
      // The label too, so a catalog its addon renamed is redrawn.
      return { id: row.id, label: row.label, ...(style ? { style } : {}), sig: `${style ?? ''}|${row.label}`, make: () => row.make(style ?? 'poster'), ...(row.feeds ? { feeds: row.feeds } : {}) };
    };
    const entries: Entry[] = [
      ...builtins.map(builtin),
      ...layout.added.flatMap((row): Entry[] => {
        const resolved = added.get(row.id);
        if (!resolved) return [];
        const style = resolved.styled === false ? undefined : styleOf(layout, row.id, 'poster', appearance().rowStyle);
        const feed = resolved.feed;
        return [{ id: row.id, label: resolved.label, ...(style ? { style } : {}), added: true, sig: `${style ?? ''}|${resolved.label}|${resolved.version}`, make: () => resolved.render(style ?? 'poster'), ...(feed ? { feeds: () => [feed] } : {}) }];
      }),
      ...(genreRow ? [builtin(genreRow)] : []),
    ];
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const order = arrange(
      entries.map((entry) => entry.id),
      layout.order,
    );
    const wrappers = order.map((id) => {
      const entry = byId.get(id)!;
      const hidden = layout.hidden.includes(id);
      let row = drawn.get(id);
      const step = drawStep(row, entry.sig, hidden);
      if (!row || step !== 'keep') {
        const element = step === 'make' ? entry.make() : null;
        row = { sig: entry.sig, wrapper: h('div', { class: 'home-row', 'data-row': id, 'data-focus-scope': `row:${id}` }, element ?? ''), empty: !element, made: step === 'make' };
        drawn.set(id, row);
      }
      row.wrapper.hidden = row.empty || hidden;
      return row.wrapper;
    });
    for (const id of drawn.keys()) if (!byId.has(id)) drawn.delete(id);
    // Only rows that are new or moved are (re)inserted: taking a row out of the
    // page, even for a moment, drops focus from its card and resets its scroll.
    const slot = parts.railsSlot;
    wrappers.forEach((wrapper, i) => {
      if (slot.children[i] !== wrapper) slot.insertBefore(wrapper, slot.children[i] ?? null);
    });
    while (slot.children.length > wrappers.length) slot.lastElementChild!.remove();
    // Half-width rows next to each other share a line (the Dashboard layout); a lone one stays full width.
    const pairs = pairHalves(
      order.filter((id) => !drawn.get(id)!.wrapper.hidden),
      layout.half ?? [],
    );
    for (const [id, row] of drawn) {
      row.wrapper.classList.toggle('half-start', pairs.get(id) === 'start');
      row.wrapper.classList.toggle('half-end', pairs.get(id) === 'end');
    }
    slot.classList.toggle('paired', pairs.size > 0);
    // The phone remote's picker shows the same rows, in this order.
    const shown = order.filter((id) => !drawn.get(id)!.wrapper.hidden);
    setHomeFeeds(async () => (await Promise.all(shown.map(async (id) => (await byId.get(id)!.feeds?.()) ?? []))).flat());
    setKnownRows(entries.map(({ id, label, style, added }) => ({ id, label, ...(style ? { style } : {}), ...(added ? { added } : {}) })));
  };
  // The hero loads beside the rows rather than after them.
  let heroLoads = 0;
  /** How many titles the banner shown was made with (Settings → Appearance → Featured titles). */
  let heroCount = appearance().heroCount;
  const showHero = (rails: CatalogRef[]) => {
    const run = ++heroLoads;
    heroCount = appearance().heroCount;
    const current = () => run === heroLoads && !signal.aborted;
    return loadHero(rails, parts, current).catch((err: unknown) => {
      if (!current()) return;
      parts.heroSlot.replaceChildren();
      console.warn('Could not show the featured titles', err);
    });
  };
  const hero = showHero(refs);
  // A new count of featured titles shows when Home is next shown, rather than after a restart.
  parts.page.addEventListener(VIEW_SHOWN, () => void (appearance().heroCount !== heroCount && showHero(chipRefs)), { signal });
  await applyRows();
  // A redraw put off until Home is shown (`whenShown`) may come after a retry replaced this attempt.
  const reapply = () => void (signal.aborted || applyRows());
  document.addEventListener(HOME_ROWS_CHANGED, reapply, { signal });
  // Rails without a style of their own follow Settings → Appearance → Card shape.
  document.addEventListener(ROW_STYLE_CHANGED, reapply, { signal });
  // Added rows of My Library, lists and services follow them.
  until(onLibraryChange(reapply));
  until(onListsChange(reapply));
  until(onCollectionsChange(reapply));
  // Mood rows and "Still on your list" leave out what's been watched; the player saves progress every
  // few seconds, so they catch up once Home is shown again.
  until(onWatchChange(parts.whenShown(reapply)));
  document.addEventListener(STREAMING_CHANGED, reapply, { signal });
  // Jellyfin and Plex rows follow connecting or disconnecting a server.
  document.addEventListener(JELLYFIN_CHANGED, reapply, { signal });
  document.addEventListener(PLEX_CHANGED, reapply, { signal });
  // "Live TV · On now" follows adding or removing a Live TV source.
  document.addEventListener(TV_SOURCES_CHANGED, reapply, { signal });
  // Refreshed manifests: new catalogs get rows, dropped ones lose theirs; the rest stay as drawn.
  until(onAddonsChange(() => {
    void usableAddons()
      .then((addons) => {
        const fresh = browsableCatalogs(addons);
        const rails = fresh.filter((ref) => RAIL_TYPES.has(ref.catalog.type));
        // The last catalog went: Home says so, rather than keeping rows of addons that are gone.
        if (!rails.length) return parts.retry();
        deps.refs = fresh;
        builtins = builtinRows(rails);
        chipRefs = rails;
        moodChips.refresh();
        return applyRows();
      })
      .catch((err: unknown) => console.warn('Could not update Home after an addon update', err));
  }));

  await hero;
  return true;
}

/** One of Home's own rows; rails have a default style and draw in any. */
interface BuiltinRow {
  id: string;
  label: string;
  defaultStyle?: RowStyle;
  make(style: RowStyle): HTMLElement;
  /** Its titles as data (the phone remote's picker); none for rows that aren't titles. */
  feeds?: () => RowFeed[] | Promise<RowFeed[]>;
}

/** How long the banner waits for recommendations before going without them. */
const HERO_PICKS_WAIT_MS = 3000;
/** Personal picks the banner chooses from, per source (it shows about half its count). */
const HERO_PICKS_PER_SEED = 8;
const HERO_PICKS_SAVED = 10;

/**
 * Picks for the profile: TMDB's recommendations for what it watched lately
 * (the same ones "Because you watched…" shows, asked once), and saved titles
 * it hasn't started. Everything passes the profile's content limit.
 */
async function personalPicks(): Promise<HeroPick[]> {
  const picks: HeroPick[] = [];
  if (await tmdbConnected()) {
    const seeds = tasteSeeds();
    const lists = await Promise.all(seeds.map((seed) => settleWithin(recommendationsFor(seed).catch(() => null), HERO_PICKS_WAIT_MS, null)));
    lists.forEach((list, i) => {
      const seed = seeds[i]!.name;
      for (const title of (list ?? []).filter((t) => !lastWatchedAt(t.id) && !inLibrary(t.id)).slice(0, HERO_PICKS_PER_SEED)) picks.push({ title, reason: { kind: 'because', seed } });
    });
  }
  const saved = await allowedTitles(libraryEntries().map((entry) => entry.title).filter((title) => !lastWatchedAt(title.id)));
  for (const title of saved.slice(0, HERO_PICKS_SAVED)) picks.push({ title, reason: { kind: 'watchlist' } });
  return picks;
}

/**
 * The hero: popular titles with artwork (alternating movies and series),
 * taking turns with picks for the profile (see hero-mix.ts); only popular
 * ones until the profile has watched or saved something.
 */
async function loadHero(refs: CatalogRef[], parts: HomeParts, current: () => boolean): Promise<void> {
  const firstOf = (type: string) => refs.find((ref) => ref.catalog.type === type);
  const [lists, personal, profile] = await Promise.all([
    Promise.all(
      [firstOf('movie'), firstOf('series')]
        .filter((ref): ref is CatalogRef => !!ref)
        // Only titles the profile's content limit allows are featured.
        .map((ref) => loadCatalog(ref).then((titles) => allowedTitles(titles)).catch(() => [] as Title[])),
    ),
    personalPicks().catch(() => [] as HeroPick[]),
    activeProfileId().catch(() => null),
  ]);
  // Home started over (or the banner did) while the titles loaded: the newer banner goes in the slot.
  if (!current()) return;
  // Settings → Appearance → Featured titles.
  const count = appearance().heroCount;
  const trending: { title: Title; rank: number }[] = [];
  for (let i = 0; lists.some((list) => i < list.length); i++) {
    for (const list of lists) if (list[i]) trending.push({ title: list[i]!, rank: i + 1 });
  }
  const exclude = new Set([...watchedTitles().map((w) => w.title.id), ...continueWatching().map((entry) => entry.title.id)]);
  const mixed = mixHero({ trending, personal, exclude, count, seed: daySeed(new Date(), profile ?? '') });
  const reasons = new Map(mixed.map((pick) => [pick.title, pick.reason]));
  // Spec: with no backdrops, fall back to the first catalog item.
  const featured = mixed.length ? mixed.map((pick) => pick.title) : lists.flat().slice(0, 1);
  if (!featured.length) {
    parts.heroSlot.replaceChildren();
    return;
  }
  if (profile) writeHero(profile, encodeHero(daySeed(new Date(), profile), count, featured, reasons));
  // The saved banner drawn at the start is this one: left as it is, rather than drawn again under the person.
  const drawn = parts.heroSlot.firstElementChild;
  if (drawn instanceof HTMLElement && drawn.dataset.heroKey === heroKey(featured)) return;
  drawHero(parts, featured, reasons);
}

/**
 * The banner saved at the last start (see hero-cache.ts), if it's from today,
 * for this profile and the current count of featured titles; drawn only over
 * the skeleton, never over a banner the network already brought.
 */
async function showSavedHero(parts: HomeParts): Promise<void> {
  const profile = await activeProfileId().catch(() => null);
  if (!profile) return;
  const picks = decodeHero(readHero(profile), daySeed(new Date(), profile), appearance().heroCount);
  if (!picks) return;
  // As `loadHero` leaves out: what was watched or started since, and what the content limit (maybe changed since) blocks.
  const exclude = new Set([...watchedTitles().map((w) => w.title.id), ...continueWatching().map((entry) => entry.title.id)]);
  const titles = await allowedTitles(picks.map((pick) => pick.title).filter((title) => !exclude.has(title.id)));
  if (parts.signal.aborted || !titles.length || !parts.heroSlot.querySelector('.hero-skeleton')) return;
  const reasons = new Map(picks.map((pick) => [pick.title, pick.reason]));
  drawHero(parts, titles, reasons);
}

function drawHero(parts: HomeParts, featured: Title[], reasons: ReadonlyMap<Title, HeroPick['reason'] | undefined>): void {
  const hero = createHero(featured, {
    primaryLabel,
    play: parts.play,
    details: parts.openDetail,
    inLibrary: (title) => inLibrary(title.id),
    rank: (title) => {
      const reason = reasons.get(title);
      return reason?.kind === 'trending' ? reason.rank : undefined;
    },
    reason: (title) => {
      const reason = reasons.get(title);
      if (reason?.kind === 'because') return t('homerows.hero.because', { name: reason.seed });
      return reason?.kind === 'watchlist' ? t('homerows.hero.watchlist') : undefined;
    },
    toggleLibrary: (title) => toggleLibrary(title),
    // Only what's already known: a downloaded movie's quality,
    // or else the best its sources offered when they were last looked up (never asked for here).
    badges: (title) => {
      const copy = title.type === 'movie' ? downloadedCopy(title.id) : undefined;
      const found = !copy && title.type === 'movie' && appearance().qualityBadges ? (knownQuality(title) ?? []) : [];
      return copy ? qualityBadges(copy.label) : found;
    },
    logos: () => appearance().logos,
  });
  hero.dataset.heroKey = heroKey(featured);
  parts.heroSlot.replaceChildren(hero);
}

/** Genre tiles from the Top 10 catalog's genre filter, when it has one; each opens the genre's movies and shows. */
function genreSection(ref: CatalogRef, ctx: RoomContext, refs: () => readonly CatalogRef[]): HTMLElement | null {
  const genres = ref.catalog.extra.find((e) => e.name === 'genre' && !e.isRequired)?.options ?? [];
  if (!genres.length) return null;
  // A rail like the others, so its scroll arrows reach the genres past the window's edge.
  return rail({ title: t('browse.home.genres'), variant: 'genres', cards: genres.map((name) => genreTile({ name, hue: fallbackHue(name) }, () => void openGenrePage(ctx, name, refs(), ref))) });
}

/** Opens Movies or TV Shows on a catalog (and genre); Movies for other types. */
function showInDiscover(ctx: RoomContext, ref: CatalogRef, at: { catalogId: string; genre?: string }): void {
  const series = ref.catalog.type === 'series';
  openDiscoverAt(series ? 'series' : 'movie', { addonKey: ref.addon.key, ...at });
  ctx.go(series ? 'series' : 'movies', { root: true });
}

function homeMessage(title: string, detail: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'home-message' }, h('span', { class: 'home-message-title' }, title), h('p', { class: 'muted' }, detail), action ?? '');
}
