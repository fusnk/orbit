/**
 * Search before typing: a few big "Trending now" cards, genres to jump into,
 * and trending rows, all following the Movies / TV Shows tabs. They come
 * from TMDB with a token; without one, from the person's first movie and
 * show catalogs (and genres open Movies or TV Shows on that genre).
 */
import type { RoomContext } from '../../app/router';
import { GENRE_LABELS, GENRES, genreKeyOf, type GenreKey } from '../../catalog/explore';
import { allowedTitles } from '../../catalog/parental';
import { loadCatalog, usableAddons } from '../../catalog/service';
import { interleave } from '../../catalog/taste';
import { tmdbList } from '../../catalog/tmdb';
import { browsableCatalogs, type Title } from '../../catalog/titles';
import { asyncRail, withHue } from '../../components/cards';
import { titleCard } from '../title-card';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { openDiscoverAt } from '../discover';
import { createGridPage, type Kind } from '../explore/grid';
import { genreGrid } from '../explore/sections';
import { spotlightCard, spotlightSkeleton } from './cards';

export type Tab = 'all' | Kind;

export interface IdleDeps {
  ctx: RoomContext;
  openDetail(title: Title): void;
  withMenu(card: HTMLElement, title: Title): HTMLElement;
  /** Whether a TMDB token is saved. */
  tmdb: boolean;
}

const SPOTLIGHTS = 3;
const ROW_COUNT = 20;

/**
 * Trending titles of a kind ('all': both), from TMDB or else the first
 * catalog of that kind; each list loaded once per page, retried after a failure.
 */
function trendingSource(tmdb: boolean) {
  const lists = new Map<Tab, Promise<Title[]>>();
  const fromCatalog = async (kind: Kind) => {
    const ref = browsableCatalogs(await usableAddons()).find((r) => r.catalog.type === kind);
    return ref ? allowedTitles(await loadCatalog(ref)) : [];
  };
  const load = (tab: Tab): Promise<Title[]> => {
    if (tmdb) return tmdbList(tab === 'movie' ? 'movies-today' : tab === 'series' ? 'series-today' : 'trending-week').then((titles) => titles ?? []);
    if (tab !== 'all') return fromCatalog(tab);
    return Promise.all([trending('movie'), trending('series')]).then((both) => interleave(both));
  };
  const trending = (tab: Tab): Promise<Title[]> => {
    let list = lists.get(tab);
    if (!list) {
      list = load(tab);
      lists.set(tab, list);
      list.catch(() => lists.delete(tab));
    }
    return list;
  };
  return trending;
}

/** The genres that can be opened for `tab`, with what opening one does. */
async function genreTargets(deps: IdleDeps, tab: Tab): Promise<{ key: GenreKey; open(): void }[]> {
  if (deps.tmdb) {
    // Shows lack some of TMDB's movie genres; their grids are movies only.
    return GENRES.filter((g) => tab !== 'series' || g.tv !== null).map((g) => ({ key: g.key, open: () => deps.ctx.open(createGridPage(genreGrid(g.key), deps.ctx, tab === 'series' ? 'series' : 'movie')) }));
  }
  // Without TMDB: the genres the first catalog of the kind offers, opened on Movies or TV Shows.
  const kind: Kind = tab === 'series' ? 'series' : 'movie';
  const ref = browsableCatalogs(await usableAddons()).find((r) => r.catalog.type === kind && r.catalog.extra.some((e) => e.name === 'genre' && e.options?.length));
  const options = ref?.catalog.extra.find((e) => e.name === 'genre')?.options ?? [];
  const seen = new Set<GenreKey>();
  return options.flatMap((option) => {
    const key = genreKeyOf(option);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [
      {
        key,
        open: () => {
          openDiscoverAt(kind, { addonKey: ref!.addon.key, catalogId: ref!.catalog.id, genre: option });
          deps.ctx.go(kind === 'series' ? 'series' : 'movies', { root: true });
        },
      },
    ];
  });
}

/** Builds the idle sections for each tab once, and hands back the same element after. */
export function createIdle(deps: IdleDeps): (tab: Tab) => HTMLElement {
  const trending = trendingSource(deps.tmdb);
  const built = new Map<Tab, HTMLElement>();
  return (tab) => {
    let view = built.get(tab);
    if (!view) {
      view = idleView(deps, tab, trending);
      built.set(tab, view);
    }
    return view;
  };
}

function idleView(deps: IdleDeps, tab: Tab, trending: (tab: Tab) => Promise<Title[]>): HTMLElement {
  const spotlights = h('div', { class: 'search-spots' }, ...Array.from({ length: SPOTLIGHTS }, spotlightSkeleton));
  const spotSection = h('section', { class: 'search-section search-pad' }, h('h2', { class: 'search-heading' }, t('search.trending.title')), spotlights);
  const shown = trending(tab).then((titles) => titles.filter((title) => title.background).slice(0, SPOTLIGHTS));
  void shown
    .then((titles) => {
      spotSection.hidden = !titles.length;
      spotlights.replaceChildren(...titles.map((title, i) => deps.withMenu(spotlightCard(title, i + 1, () => deps.openDetail(title)), title)));
    })
    .catch(() => (spotSection.hidden = true));

  const chips = h('div', { class: 'search-genres' });
  const genreSection = h('section', { class: 'search-section search-pad', hidden: true }, h('h2', { class: 'search-heading' }, t('search.genres.title')), chips);
  void genreTargets(deps, tab)
    .then((targets) => {
      genreSection.hidden = !targets.length;
      chips.replaceChildren(
        ...targets.map((target) => {
          const hue = GENRES.find((g) => g.key === target.key)!.hue;
          const chip = withHue(h('button', { class: 'search-genre' }, h('span', { class: 'search-genre-dot', 'aria-hidden': 'true' }), t(GENRE_LABELS[target.key])), hue);
          chip.addEventListener('click', target.open);
          return chip;
        }),
      );
    })
    .catch((err: unknown) => console.warn('Could not list genres for Search', err));

  const row = (kind: Kind) =>
    asyncRail({
      go: deps.ctx.go,
      title: t(deps.tmdb ? (kind === 'movie' ? 'search.trending.movies' : 'search.trending.series') : kind === 'movie' ? 'search.popular.movies' : 'search.popular.series'),
      load: async () => {
        // The row leaves out what the big cards above already show.
        const skip = new Set((await shown.catch(() => [] as Title[])).map((title) => title.id));
        const titles = (await trending(kind)).filter((title) => !skip.has(title.id)).slice(0, ROW_COUNT);
        return titles.map((title) => titleCard(title, () => deps.openDetail(title), {}, (card) => deps.withMenu(card, title)));
      },
    });
  const rows = tab === 'all' ? [row('movie'), row('series')] : [row(tab)];
  return h('div', { class: 'search-idle' }, spotSection, genreSection, ...rows);
}
