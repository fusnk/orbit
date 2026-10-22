/**
 * A Discover grid ("View all", a genre, a language, an award): one source's
 * titles a page at a time, loading the next as you scroll, with a movies /
 * shows toggle where the source has both. Titles marked Not interested are
 * left out; the content limit was applied where the titles were loaded.
 * Grids that browse TMDB's discover get the profile's filters (filters.ts).
 */
import { VIEW_DISCARDED, type RoomContext } from '../../app/router';
import { streamingRegion } from '../../catalog/streaming';
import { movieCertifications, tmdbSourcePage } from '../../catalog/tmdb';
import type { Title } from '../../catalog/titles';
import { gridSkeletons } from '../../components/cards';
import { titleCard } from '../title-card';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { errorState, stateMessage } from '../../components/state-message';
import { isWatched } from '../../library/watch';
import type { ErrorService } from '../../lib/user-error';
import { titleHandlers } from '../detail/open';
import { createFilterBar } from './filter-bar';
import { activeCount, DEFAULT_FILTERS, discoverQuery, fixedBy, loadFilters, saveFilters, type DiscoverFilters, type DiscoverSpec, type Kind } from './filters';
import { exploreMenu, loadHidden, removeHiddenCards, visible } from './state';
import '../discover/discover.css';
import '../streaming/service.css';

export type { Kind };
export type PageLoader = (kind: Kind, page: number) => Promise<{ titles: Title[]; done: boolean } | null>;

export interface GridSource {
  title: string;
  /** A line above the title, e.g. "Browse by genre". */
  eyebrow?: string | undefined;
  intro?: string | undefined;
  /** Movies and/or shows; with both, a toggle picks which. */
  kinds: readonly Kind[];
  load: PageLoader;
  /** The TMDB discover query behind `load`, when there is one: the grid can then be filtered. */
  discover?: DiscoverSpec | undefined;
  /** Told when the person switches between movies and shows (e.g. to remember it). */
  onKind?: ((kind: Kind) => void) | undefined;
  /** Whose sign-in a refused page points to: TMDB unless the pages come from elsewhere (an addon's catalog). */
  service?: ErrorService | undefined;
}

/** How long after the last filter change the grid reloads (a slider sends every step). */
const FILTER_DELAY_MS = 350;

export function createGridPage(source: GridSource, ctx: RoomContext, start: Kind = source.kinds[0] ?? 'movie'): HTMLElement {
  const { openDetail, withMenu } = titleHandlers(ctx);
  const menu = exploreMenu(withMenu);
  let kind: Kind = source.kinds.includes(start) ? start : (source.kinds[0] ?? 'movie');
  let page = 0;
  let shown = 0;
  let loading = false;
  let done = false;
  let generation = 0;
  /** Titles already shown, so a page that repeats one (lists shift while you scroll) doesn't show it twice. */
  const seen = new Set<string>();
  // Grids also open from Home, Search and title pages, before Discover (which reads them) may have
  // been visited: the profile's Not interested titles are read before the first page is shown.
  const hiddenRead = loadHidden().catch((err: unknown) => console.warn('Could not read Not interested titles', err));

  const segments = h('div', { class: 'segments', role: 'group', 'aria-label': t('browse.service.show') });
  const { discover } = source;
  let filters: DiscoverFilters = DEFAULT_FILTERS;
  const certifications = discover ? streamingRegion().then(movieCertifications).catch(() => null) : Promise.resolve(null);
  // The filtered query's pages; the grid's own loader otherwise.
  const load: PageLoader = discover
    ? async (kind, n) => {
        // Today here, not in UTC (which is a day off in the evening or morning, depending on the zone).
        const now = new Date();
        const today = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
        const query = discoverQuery(discover, kind, filters, { today, certifications: await certifications });
        if (!query) return { titles: [], done: true };
        return tmdbSourcePage({ kind: 'discover', media: kind === 'movie' ? 'movie' : 'tv', sort: query.sort, filters: query.filters }, n);
      }
    : source.load;
  const filterSlot = h('div', { class: 'filter-slot' });
  const panelSlot = h('div', { class: 'filter-panel-slot' });
  let setBarKind: (kind: Kind) => void = () => {};
  const grid = h('div', { class: 'title-grid' });
  const status = h('div', { class: 'grid-status' });
  const sentinel = h('div', { class: 'grid-sentinel', 'aria-hidden': 'true' });
  const root = h(
    'div',
    { class: 'discover service-page explore-grid' },
    h(
      'header',
      { class: 'service-header' },
      h('div', {}, source.eyebrow ? h('span', { class: 'eyebrow' }, source.eyebrow) : '', h('h1', { class: 'page-title' }, source.title), source.intro ? h('p', { class: 'muted' }, source.intro) : ''),
    ),
    source.kinds.length > 1 || discover ? h('div', { class: 'discover-bar' }, h('div', { class: 'discover-bar-row explore-grid-bar' }, source.kinds.length > 1 ? segments : h('span', {}), filterSlot)) : '',
    panelSlot,
    grid,
    status,
    sentinel,
  );

  function render(): void {
    generation++;
    setBarKind(kind);
    segments.replaceChildren(
      ...source.kinds.map((value) => {
        // The switch is where the keyboard starts (like a title page's Play), so the router focuses it.
        const button = h('button', { class: 'segment', 'aria-pressed': String(kind === value), 'data-autofocus': kind === value }, value === 'movie' ? t('titles.library.movies') : t('titles.library.series'));
        button.addEventListener('click', () => {
          if (kind === value) return;
          kind = value;
          source.onKind?.(value);
          render();
          // The buttons were redrawn: the keyboard stays on the one just chosen.
          segments.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
        });
        return button;
      }),
    );
    grid.replaceChildren();
    status.replaceChildren();
    seen.clear();
    page = 0;
    shown = 0;
    done = false;
    loading = false;
    grid.removeAttribute('aria-busy');
    loadMore();
  }

  function loadMore(): void {
    if (loading || done) return;
    const current = generation;
    loading = true;
    // Screen readers hold the grid's changes until the page is in.
    grid.setAttribute('aria-busy', 'true');
    status.replaceChildren(h('div', { class: 'title-grid', 'aria-hidden': 'true' }, ...gridSkeletons(shown ? 7 : 14)));
    hiddenRead
      .then(() => load(kind, page + 1))
      .then((result) => {
        if (current !== generation) return;
        page += 1;
        done = !result || result.done;
        const fresh = visible(result?.titles ?? []).filter((title) => !seen.has(title.id) && seen.add(title.id) && !(filters.hideWatched && isWatched(title)));
        shown += fresh.length;
        grid.append(...fresh.map((title) => titleCard(title, () => openDetail(title), {}, (card) => menu(card, title))));
        // Without a switch to start on, the keyboard starts on the first title once there is one.
        const first = grid.querySelector<HTMLElement>('.card:not([hidden])');
        if (first && !root.querySelector('[data-autofocus]')) {
          first.dataset.autofocus = '';
          if (root.isConnected && (!document.activeElement || document.activeElement === document.body)) first.focus({ preventScroll: true });
        }
        const filtered = !!discover && activeCount(filters, kind, fixedBy(discover, kind)) > 0;
        status.replaceChildren(
          shown || !done
            ? ''
            : stateMessage({ icon: filtered ? 'sliders' : 'film', title: filtered ? t('explore.filters.empty') : t('explore.grid.empty'), detail: filtered ? t('explore.filters.empty-detail') : t('explore.grid.empty-detail') }),
        );
        // A page whose titles were all filtered out leaves the sentinel in view, which doesn't fire again: ask for the next one.
        if (!done && !fresh.length) setTimeout(loadMore);
        // Nor does it fire when a page didn't fill a tall window: observing again asks whether it's still in view.
        else if (!done) {
          pager.unobserve(sentinel);
          pager.observe(sentinel);
        }
      })
      .catch((err: unknown) => {
        if (current !== generation) return;
        status.replaceChildren(errorState({ title: t('explore.grid.failed'), err, retry: loadMore, go: ctx.go, service: source.service ?? 'tmdb' }));
      })
      .finally(() => {
        if (current !== generation) return;
        loading = false;
        grid.removeAttribute('aria-busy');
      });
  }

  const pager = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadMore();
  }, { rootMargin: '600px' });
  pager.observe(sentinel);
  const stopHiding = removeHiddenCards(root);
  root.addEventListener(
    VIEW_DISCARDED,
    () => {
      pager.disconnect();
      stopHiding();
    },
    { once: true },
  );
  if (!discover) render();
  else {
    void loadFilters()
      .catch(() => DEFAULT_FILTERS)
      .then((saved) => {
        filters = saved;
        let timer = 0;
        const bar = createFilterBar({
          filters,
          fixed: fixedBy(discover, kind),
          certifications,
          onChange(next) {
            filters = next;
            clearTimeout(timer);
            timer = window.setTimeout(() => {
              render();
              saveFilters(filters).catch((err: unknown) => console.warn('Could not save Discover’s filters', err));
            }, FILTER_DELAY_MS);
          },
        });
        setBarKind = bar.setKind;
        filterSlot.replaceChildren(bar.controls);
        panelSlot.replaceChildren(bar.panel);
        render();
      });
  }
  return root;
}
