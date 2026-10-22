import { t, tn, type MessageKey } from '../../i18n';
import { onAddonsChange } from '../../addons/registry';
import { decodeEntities } from '../../addons/schema';
import type { ManifestCatalog } from '../../addons/types';
import type { Room, RoomContext } from '../../app/router';
import { allowedTitles, shownNow } from '../../catalog/parental';
import { loadCatalog, usableAddons } from '../../catalog/service';
import type { Title } from '../../catalog/titles';
import { TMDB_CHANGED, tmdbConnected, tmdbSourcePage } from '../../catalog/tmdb';
import { ageRatingSlot } from '../../components/age-rating';
import { gridSkeletons, titleMeta } from '../../components/cards';
import { icon } from '../../components/icons';
import { openMenuFrom } from '../../components/menu';
import { errorState, stateMessage } from '../../components/state-message';
import { h } from '../../lib/dom';
import { titleHandlers } from '../detail/open';
import { primaryLabel } from '../detail/title-actions';
import { titleCard } from '../title-card';
import { openSettingsTo } from '../settings';
import { openSurprise } from './surprise';
import { fillFeatured } from './featured';
import { createGenrePicker } from './genre-picker';
import { animeRequest, pageSources, positionIn, sameGridView, type PageSetup as SourceSetup, type PageSource, type Position } from './sources';
import './discover.css';

type Kind = 'movie' | 'series' | 'anime';

interface PageSetup extends SourceSetup {
  id: string;
  label: string;
  noun: string;
  /** Shown above a source locked to `genre`. */
  note?: string;
  /** "No {kind} in {genre} in this catalog." */
  emptyGenre: MessageKey;
  noCatalogs: string;
}

const PAGES: Record<Kind, PageSetup> = {
  movie: { id: 'movies', label: t('browse.nav.movies'), noun: 'Movie', types: ['movie'], emptyGenre: 'browse.discover.empty-genre-movies', noCatalogs: t('browse.discover.no-catalogs-movies') },
  series: { id: 'series', label: t('browse.nav.series'), noun: 'Series', types: ['series'], emptyGenre: 'browse.discover.empty-genre-series', noCatalogs: t('browse.discover.no-catalogs-series') },
  // Optional (Settings → Library & Metadata). Anime addons and TMDB's anime
  // first (sources.ts); without either, Cinemeta's Animation genre, which also
  // has Western animation.
  anime: {
    id: 'anime',
    label: t('browse.nav.anime'),
    noun: 'Anime',
    types: ['series', 'movie'],
    genre: 'Animation',
    anime: true,
    note: t('browse.discover.anime-note'),
    emptyGenre: 'browse.discover.empty-genre-anime',
    noCatalogs: t('browse.discover.no-catalogs-anime'),
  },
};

const pending: Record<Kind, Position | null> = { movie: null, series: null, anime: null };
/** Applies a position to a page that has loaded its sources; false while it's still loading. */
const appliers: Partial<Record<Kind, (at: Position) => boolean>> = {};

/** Makes the next visit to Movies/TV Shows open on a catalog and/or genre (e.g. "See all", a genre tile). */
export function openDiscoverAt(type: Kind, at: Position): void {
  pending[type] = at;
}

/** The page's sources: for Anime, whether TMDB is connected decides which. */
async function loadSources(setup: PageSetup): Promise<PageSource[]> {
  const [addons, tmdb] = await Promise.all([usableAddons(), setup.anime ? tmdbConnected() : false]);
  return pageSources(setup, addons, tmdb);
}

/** Today here, not in UTC (which is a day off in the evening or morning, depending on the zone). */
function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * Movies, TV Shows and Anime share one template: a featured banner, the
 * catalog (Popular / New / Featured), a genre picker, the addon it comes from,
 * and a grid that loads the next page as you scroll.
 */
export function createDiscoverRoom(type: Kind): Room {
  const setup = PAGES[type];
  return {
    id: setup.id,
    label: setup.label,
    keep: true,
    render(ctx) {
      return discoverPage(type, setup, ctx);
    },
    onShow() {
      // A page still loading picks up the pending position itself once its sources arrive.
      const at = pending[type];
      if (at && appliers[type]?.(at)) pending[type] = null;
    },
  };
}

function discoverPage(type: Kind, setup: PageSetup, ctx: RoomContext): HTMLElement {
  const { label } = setup;
  const { openDetail, play, withMenu } = titleHandlers(ctx);
  let sources: PageSource[] = [];
  let source: PageSource | undefined;
  let catalog: ManifestCatalog | undefined;
  let genre: string | undefined;
  let items: Title[] = [];
  let loading = false;
  let done = false;
  /** Pages of TMDB's anime loaded so far (an addon's catalog pages by `skip` instead). */
  let pages = 0;
  /** Titles the addon has sent, repeats included: where its next page starts (`skip`). */
  let received = 0;
  let error: unknown = null;
  let generation = 0;

  const count = h('span', { class: 'count' });
  const featured = h('section', { class: 'featured', 'data-nav-banner': true });
  // Anime: shows or movies; the catalog tabs then list that kind's catalogs.
  const kinds = h('div', { class: 'segments', role: 'group', 'aria-label': t('browse.service.show') });
  const segments = h('div', { class: 'segments', role: 'group', 'aria-label': t('browse.discover.catalog') });
  const note = h('p', { class: 'muted discover-note' }, setup.note ?? '');
  const sourceButton = h('button', { class: 'source-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  const sourcePicker = h('div', { class: 'source-picker' }, h('span', {}, t('browse.discover.source')), sourceButton);
  const genres = createGenrePicker();
  const grid = h('div', { class: 'title-grid' });
  const status = h('div', { class: 'grid-status' });
  const sentinel = h('div', { class: 'grid-sentinel', 'aria-hidden': 'true' });
  const bar = h('div', { class: 'discover-bar' }, h('div', { class: 'discover-bar-row' }, kinds, segments, genres.element, sourcePicker));

  /** A filter changed with the page scrolled deep: the grid just emptied, so staying put would land
   *  partway down the new one. Back up to the (sticky) bar, so it starts on its first row. */
  function scrollToBar(): void {
    const outlet = page.closest('.outlet');
    if (outlet && outlet.scrollTop > bar.offsetTop) outlet.scrollTo({ top: bar.offsetTop });
  }

  sourceButton.addEventListener('click', () =>
    openMenuFrom(
      sourceButton,
      sources.map((choice) => ({
        label: choice.name,
        action: () => {
          source = choice;
          // Its first catalog: the catalog tabs hide when there's only one, so nothing else would pick it.
          catalog = choice.catalogs[0];
          genre = undefined;
          reset();
        },
      })),
    ),
  );

  const page = h(
    'div',
    { class: 'discover' },
    type === 'anime' ? h('h1', { class: 'page-title discover-title' }, label, count) : h('div', { class: 'discover-head' }, h('h1', { class: 'page-title discover-title' }, label, count), surpriseButton(type)),
    note,
    featured,
    bar,
    grid,
    status,
    sentinel,
  );

  /** Surprise Me: a random title from the catalogs that fits a few constraints. */
  function surpriseButton(kind: 'movie' | 'series'): HTMLElement {
    const button = h('button', { class: 'button glass discover-surprise' }, t('insights.surprise.open'));
    button.addEventListener('click', () => openSurprise(kind, { play, openDetail }));
    return button;
  }

  /** The genre filter of the current catalog: a year for Cinemeta's "New", a genre otherwise. */
  const genreExtra = () => catalog?.extra.find((e) => e.name === 'genre');

  /** The buttons were redrawn: the keyboard stays on the one just chosen. */
  const refocus = (group: HTMLElement) => group.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });

  function renderControls(): void {
    const catalogs = source?.catalogs ?? [];
    const types = [...new Set(catalogs.map((c) => c.type))];
    kinds.replaceChildren(
      ...types.map((type) => {
        const button = h('button', { class: 'segment', 'aria-pressed': String(type === catalog?.type) }, kindLabel(type));
        button.addEventListener('click', () => {
          if (type === catalog?.type) return;
          catalog = catalogs.find((c) => c.type === type);
          genre = undefined;
          reset();
          refocus(kinds);
        });
        return button;
      }),
    );
    kinds.hidden = types.length < 2;
    const shown = catalogs.filter((c) => c.type === catalog?.type);
    segments.replaceChildren(
      ...shown.map((c) => {
        const button = h('button', { class: 'segment', 'aria-pressed': String(c === catalog) }, c.name ?? c.id);
        button.addEventListener('click', () => {
          catalog = c;
          genre = undefined;
          reset();
          refocus(segments);
        });
        return button;
      }),
    );
    segments.hidden = shown.length < 2;
    // Only a source locked to a genre needs explaining (Anime's Cinemeta fallback).
    note.hidden = !setup.note || !source?.genre;
    sourceButton.replaceChildren(source?.name ?? '—', icon('chevronDown'));
    // With one catalog addon there's nothing to choose: a dropdown that can't open only looks broken.
    sourcePicker.hidden = sources.length < 2;
    sourceButton.title = t('browse.discover.source-choose');

    const extra = genreExtra();
    genres.render({
      // A source locked to one genre (Anime's fallback) has no genre filter.
      options: source?.genre ? [] : (extra?.options ?? []),
      allowAll: !extra?.isRequired,
      current: genre,
      pick: (value) => {
        genre = value;
        reset();
        scrollToBar();
      },
    });
  }

  function renderFeatured(): void {
    const drawnFor = generation;
    // Titles still being rated are left out; once their ratings land, an empty banner is drawn again
    // (a slow lookup mustn't leave it empty for good, under a content limit).
    const shown = shownNow(items, (title) => title, () => {
      if (drawnFor === generation && featured.hidden) renderFeatured();
    });
    const title = shown.find((t) => t.background) ?? shown[0];
    fillFeatured(
      featured,
      page,
      title,
      title && {
        playLabel: primaryLabel(title),
        play: () => play(title),
        openDetail: () => openDetail(title),
        meta: [...titleMeta(title), ageRatingSlot(title, { dot: true })],
      },
    );
  }

  let retryStart = (): void => {};

  function renderStatus(): void {
    // The total is only known once every page has loaded. It counts what the grid shows: titles the
    // content limit hides are left out, and ones still being rated are counted once they're in.
    const at = generation;
    const shown = done ? shownNow(items, (title) => title, () => at === generation && renderStatus()).length : 0;
    count.textContent = shown ? tn('browse.discover.titles', shown) : '';
    if (loading) grid.setAttribute('aria-busy', 'true');
    else grid.removeAttribute('aria-busy');
    if (error) {
      status.replaceChildren(errorState({ title: t('browse.service.failed', { name: catalog?.name ?? label }), err: error, retry: () => (source ? loadPage() : retryStart()), go: ctx.go }));
    } else if (loading) {
      status.replaceChildren(
        h('div', { class: 'title-grid' }, ...gridSkeletons(items.length ? 7 : 14)),
        items.length ? h('p', { class: 'grid-note' }, source ? t('browse.discover.loading-next', { name: source.name }) : t('browse.discover.loading-next-addon')) : '',
      );
    } else if ((!items.length || (done && !shown)) && catalog) {
      // Also when the content limit hides every title the catalog sent: the grid is as empty.
      const clear = h('button', { class: 'button' }, t('browse.discover.all-genres'));
      clear.addEventListener('click', () => {
        genre = undefined;
        reset();
      });
      status.replaceChildren(
        stateMessage({
          icon: 'film',
          title: t('browse.service.empty'),
          detail: genre ? t(setup.emptyGenre, { genre: decodeEntities(genre) }) : t('browse.discover.empty'),
          action: genre && !source?.genre && !genreExtra()?.isRequired ? clear : null,
        }),
      );
    } else status.replaceChildren();
  }

  function reset(): void {
    generation++;
    items = [];
    done = false;
    pages = 0;
    received = 0;
    error = null;
    loading = false;
    grid.replaceChildren();
    // A catalog that needs a genre (Cinemeta's "New" is keyed by year) starts on its first option.
    const extra = genreExtra();
    if (source?.genre) genre = source.genre;
    else if (extra?.isRequired && genre === undefined) genre = extra.options?.[0];
    renderControls();
    loadPage();
  }

  function loadPage(): void {
    if (!source || !catalog || loading || done) return;
    const current = generation;
    // Counting only the titles shown would ask again for ones already sent whenever the addon repeated one.
    const skip = received;
    /** Nothing shown yet: the banner is drawn from this page. */
    const first = items.length === 0;
    const { addon } = source;
    // Paging only works if the catalog declares `skip`.
    if (addon && skip > 0 && !catalog.extra.some((e) => e.name === 'skip')) {
      done = true;
      renderStatus();
      return;
    }
    const extra: [string, string][] = [];
    if (genre) extra.push(['genre', genre]);
    if (skip) extra.push(['skip', String(skip)]);
    const request = addon ? undefined : animeRequest(catalog.id, genre, localToday());
    loading = true;
    error = null;
    renderStatus();
    let more = false;
    const next: Promise<{ titles: Title[]; done?: boolean }> = addon
      ? loadCatalog({ addon, catalog, extra: [] }, extra)
          // The whole page is kept (paging counts it); its cards wait briefly for the profile's content limit instead.
          .then((page) => allowedTitles(page).then(() => ({ titles: page })))
      : // TMDB's anime pages by number, the content limit already applied.
        request
        ? tmdbSourcePage(request, pages + 1).then((page) => page ?? { titles: [], done: true })
        : Promise.resolve({ titles: [], done: true });
    next
      .then((page) => {
        if (current !== generation) return;
        pages++;
        received += page.titles.length;
        const known = new Set(items.map((t) => t.id));
        // Also once each within the page: an addon can list a title twice.
        const fresh = page.titles.filter((t) => !known.has(t.id) && !!known.add(t.id));
        done = page.done ?? fresh.length === 0;
        // A TMDB page the content limit emptied: the sentinel stays in view, so ask for the next one.
        more = !done && fresh.length === 0;
        items = [...items, ...fresh];
        grid.append(...fresh.map((title) => titleCard(title, () => openDetail(title), {}, (card) => withMenu(card, title))));
        if (first) renderFeatured();
      })
      .catch((err: unknown) => {
        if (current !== generation) return;
        error = err;
        // A first page that failed: the banner still shows the previous catalog's title.
        if (first) renderFeatured();
      })
      .finally(() => {
        if (current !== generation) return;
        loading = false;
        renderStatus();
        if (more) loadPage();
        // The observer only reports changes: on a tall window the first pages
        // may not reach the sentinel, so observing again asks whether it's still in view.
        else if (!done && !error) {
          pager.unobserve(sentinel);
          pager.observe(sentinel);
        }
      });
  }

  // Load the next page when the end of the grid scrolls into view.
  const pager = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadPage();
  }, { rootMargin: '600px' });
  pager.observe(sentinel);

  appliers[type] = (at) => {
    if (!source) return false;
    const view = positionIn(sources, at, { source, catalog });
    if (!view) return false;
    ({ source, catalog, genre } = view);
    reset();
    // The router put back where the old grid was scrolled to; the grid just emptied, so that
    // would land partway down the new one instead of on its banner and first row.
    page.closest('.outlet')?.scrollTo({ top: 0 });
    return true;
  };

  /** `start` is still looking for the page's sources. */
  let starting = false;
  // Skeletons while the addons load; a failure offers Retry, which starts over
  // here (there's no catalog yet for `loadPage` to retry).
  const start = (): void => {
    starting = true;
    error = null;
    loading = true;
    renderStatus();
    void loadSources(setup)
      .then((found) => {
        loading = false;
        sources = found;
        const at = pending[type];
        pending[type] = null;
        const view = positionIn(sources, at);
        if (!view) return noCatalogs();
        ({ source, catalog, genre } = view);
        reset();
      })
      .catch((err: unknown) => {
        loading = false;
        error = err;
        clearSource();
        renderStatus();
      })
      .finally(() => (starting = false));
  };

  /** No addon has a catalog here (none installed, or the last one removed or disabled). */
  function noCatalogs(): void {
    generation++;
    source = catalog = genre = undefined;
    items = [];
    error = null;
    loading = false;
    grid.replaceChildren();
    renderControls();
    renderFeatured();
    renderStatus();
    const manage = h('button', { class: 'button primary' }, t('browse.home.manage-addons'));
    manage.addEventListener('click', () => {
      openSettingsTo('addons');
      ctx.go('settings');
    });
    status.replaceChildren(stateMessage({ icon: 'addons', title: setup.noCatalogs, detail: t('browse.home.no-catalogs-detail'), action: manage }));
  }
  /** No catalog to show (none installed, or the addons couldn't be read): no empty banner or filter bar above the message. */
  const clearSource = (): void => {
    fillFeatured(featured, page, undefined);
    renderControls();
  };
  retryStart = start;
  start();

  // An addon change (refreshed, installed, removed, enabled or disabled) can
  // bring or drop catalogs: follow it, staying on the same addon and catalog
  // where they still exist. The grid starts over only when what it shows
  // changed; otherwise just the source list and controls are redrawn, so a
  // scrolled grid stays as it is.
  const follow = (): void => {
    // A page that found no catalogs (or failed to look) starts over: the change may have brought some.
    if (!source) return void (starting || start());
    void loadSources(setup)
      .then((fresh) => {
        if (!source) return;
        const next = fresh.find((a) => a.key === source?.key) ?? fresh[0];
        sources = fresh;
        if (!next) return noCatalogs();
        const before = { source, catalog, genre };
        const catalogs = next.catalogs;
        source = next;
        catalog = catalogs.find((c) => c.type === catalog?.type && c.id === catalog.id) ?? catalogs[0];
        if (genre !== undefined && !catalog?.extra.find((e) => e.name === 'genre')?.options?.includes(genre)) genre = undefined;
        if (sameGridView(before, { source, catalog, genre })) renderControls();
        else reset();
      })
      .catch((err: unknown) => console.warn('Could not update the page after an addon update', err));
  };
  onAddonsChange(follow);
  // Anime's sources depend on TMDB: connecting it switches from the Cinemeta fallback (and back).
  if (setup.anime) document.addEventListener(TMDB_CHANGED, follow);

  return page;
}

/** The kind switch's label for a catalog type. */
function kindLabel(type: string): string {
  if (type === 'movie') return t('titles.library.movies');
  if (type === 'series') return t('titles.library.series');
  return type === 'anime' ? t('browse.nav.anime') : type;
}
