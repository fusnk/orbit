/**
 * A streaming service's page ("Popular on Netflix"): Top 10 movies and
 * series, then every movie and show on the service's subscription in the
 * person's country (mixed, or one kind by genre), loading more as you
 * scroll. From TMDB.
 */
import { t } from '../../i18n';
import { VIEW_DISCARDED, type RoomContext } from '../../app/router';
import { regionName } from '../../catalog/streaming';
import { servicePage, type StreamingService } from '../../catalog/tmdb';
import type { Title } from '../../catalog/titles';
import { asyncRail, gridSkeletons, rankedCard } from '../../components/cards';
import { artHue } from '../../lib/art-hue';
import { h } from '../../lib/dom';
import { errorState, stateMessage } from '../../components/state-message';
import { setAmbientHue } from '../../theme/ambient';
import { titleHandlers } from '../detail/open';
import { titleCard } from '../title-card';
import './service.css';

type Tab = 'all' | 'movie' | 'series';

/** Genre keys match `GENRES` in src-tauri/src/tmdb.rs; TMDB has some only for movies or only for shows. */
const GENRES: { key: string; label: string; kinds: readonly Exclude<Tab, 'all'>[] }[] = [
  { key: 'action', label: t('browse.genre.action'), kinds: ['movie', 'series'] },
  { key: 'comedy', label: t('browse.genre.comedy'), kinds: ['movie', 'series'] },
  { key: 'drama', label: t('browse.genre.drama'), kinds: ['movie', 'series'] },
  { key: 'crime', label: t('browse.genre.crime'), kinds: ['movie', 'series'] },
  { key: 'scifi', label: t('browse.genre.scifi'), kinds: ['movie', 'series'] },
  { key: 'horror', label: t('browse.genre.horror'), kinds: ['movie'] },
  { key: 'thriller', label: t('browse.genre.thriller'), kinds: ['movie'] },
  { key: 'romance', label: t('browse.genre.romance'), kinds: ['movie'] },
  { key: 'mystery', label: t('browse.genre.mystery'), kinds: ['movie', 'series'] },
  { key: 'animation', label: t('browse.genre.animation'), kinds: ['movie', 'series'] },
  { key: 'documentary', label: t('browse.genre.documentary'), kinds: ['movie', 'series'] },
  { key: 'family', label: t('browse.genre.family'), kinds: ['movie', 'series'] },
  { key: 'reality', label: t('browse.genre.reality'), kinds: ['series'] },
];
const TOP_COUNT = 10;

/** The page's logo beside its name; dropped if it doesn't load (the name says which service it is). */
function headerLogo(src: string): HTMLImageElement {
  const img = h('img', { class: 'service-logo', src, alt: '', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}

export function createServicePage(service: StreamingService, region: string, ctx: RoomContext, startTab: Tab = 'all'): HTMLElement {
  const { openDetail, withMenu } = titleHandlers(ctx);
  let tab: Tab = startTab;
  let genre: string | undefined;
  let items = 0;
  let page = 0;
  let loading = false;
  let done = false;
  let generation = 0;
  /** Titles already shown: TMDB's lists shift while you scroll, so a page can repeat one. */
  const seen = new Set<string>();

  const segments = h('div', { class: 'segments', role: 'group', 'aria-label': t('browse.service.show') });
  const genres = h('div', { class: 'chips genre-row', role: 'group', 'aria-label': t('browse.service.genre') });
  const body = h('div', { class: 'service-body' });
  const grid = h('div', { class: 'title-grid' });
  const status = h('div', { class: 'grid-status' });
  const sentinel = h('div', { class: 'grid-sentinel', 'aria-hidden': 'true' });

  const root = h(
    'div',
    { class: 'discover service-page', 'data-activity': t('browse.service.activity', { name: service.name }) },
    h(
      'header',
      { class: 'service-header' },
      service.logo ? headerLogo(service.logo) : '',
      h(
        'div',
        {},
        h('span', { class: 'eyebrow' }, t('browse.service.popular-on')),
        h('h1', { class: 'page-title' }, service.name),
        h('p', { class: 'muted' }, t('browse.service.intro', { name: service.name, region: regionName(region) })),
      ),
    ),
    h('div', { class: 'discover-bar' }, h('div', { class: 'discover-bar-row' }, segments), genres),
    body,
    grid,
    status,
    sentinel,
  );

  // The ambient glow takes the service's colour from its logo.
  if (service.logo) {
    void artHue(service.logo).then((hue) => {
      if (hue === null) return;
      root.dataset.hue = String(hue);
      if (root.isConnected) setAmbientHue(hue);
    });
  }

  const card = (title: Title) => titleCard(title, () => openDetail(title), {}, (c) => withMenu(c, title));
  const load = (kind: Exclude<Tab, 'all'>, page: number) => servicePage(service.key, region, kind, genre, page);
  /** Kinds still with pages to load on the All tab. */
  let remaining = new Set<Exclude<Tab, 'all'>>();

  /** A page of everything: the next page of movies and of shows, alternating. */
  async function loadAll(page: number): Promise<{ titles: Title[]; done: boolean }> {
    // The set this page was asked for: a switch away and back starts a new one, which a late answer mustn't change.
    const left = remaining;
    const kinds = [...left];
    const results = await Promise.all(kinds.map((kind) => load(kind, page)));
    const lists = results.map((result) => result?.titles ?? []);
    kinds.forEach((kind, i) => {
      if (!results[i] || results[i].done) left.delete(kind);
    });
    const titles: Title[] = [];
    const longest = Math.max(0, ...lists.map((list) => list.length));
    for (let i = 0; i < longest; i++) {
      for (const list of lists) {
        const title = list[i];
        if (title) titles.push(title);
      }
    }
    return { titles, done: left.size === 0 };
  }

  function select(next: Tab): void {
    tab = next;
    genre = undefined;
    render();
  }

  /** The buttons were redrawn: the keyboard stays on the one just chosen. */
  const refocus = (group: HTMLElement) => group.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });

  function render(): void {
    generation++;
    const tabs: [Tab, string][] = [
      ['all', t('browse.search.all')],
      ['movie', t('browse.search.movies')],
      ['series', t('browse.search.series')],
    ];
    segments.replaceChildren(
      ...tabs.map(([value, label]) => {
        const button = h('button', { class: 'segment', 'aria-pressed': String(tab === value) }, label);
        button.addEventListener('click', () => {
          select(value);
          refocus(segments);
        });
        return button;
      }),
    );
    const kind = tab;
    genres.hidden = kind === 'all';
    if (kind !== 'all') {
      const chip = (label: string, value: string | undefined) => {
        const button = h('button', { class: 'chip', 'aria-pressed': String(genre === value) }, label);
        button.addEventListener('click', () => {
          genre = value;
          render();
          refocus(genres);
        });
        return button;
      };
      genres.replaceChildren(chip(t('browse.search.all'), undefined), ...GENRES.filter((g) => g.kinds.includes(kind)).map((g) => chip(g.label, g.key)));
    }

    grid.replaceChildren();
    status.replaceChildren();
    items = 0;
    seen.clear();
    page = 0;
    done = false;
    remaining = new Set(['movie', 'series']);
    loading = false;
    grid.removeAttribute('aria-busy');
    if (kind === 'all') {
      const top = (kind: Exclude<Tab, 'all'>, title: string) =>
        asyncRail({
          title,
          variant: 'ranked',
          onSeeAll: () => select(kind),
          go: ctx.go,
          load: async () => ((await load(kind, 1))?.titles ?? []).slice(0, TOP_COUNT).map((t, i) => withMenu(rankedCard(t, i + 1, () => openDetail(t)), t)),
        });
      body.replaceChildren(top('movie', t('browse.service.top-movies', { name: service.name })), top('series', t('browse.service.top-series', { name: service.name })), h('h2', { class: 'section-title service-all-heading' }, t('browse.service.everything', { name: service.name })));
    } else {
      body.replaceChildren();
    }
    loadMore();
  }

  function loadMore(): void {
    if (loading || done) return;
    const current = generation;
    loading = true;
    // Screen readers hold the grid's changes until the page is in.
    grid.setAttribute('aria-busy', 'true');
    status.replaceChildren(h('div', { class: 'title-grid' }, ...gridSkeletons(items ? 7 : 14)));
    (tab === 'all' ? loadAll(page + 1) : load(tab, page + 1))
      .then((result) => {
        if (current !== generation) return;
        page += 1;
        done = !result || result.done;
        const titles = (result?.titles ?? []).filter((title) => !seen.has(title.id) && !!seen.add(title.id));
        items += titles.length;
        grid.append(...titles.map(card));
        status.replaceChildren(items || !done ? '' : stateMessage({ icon: 'tv', title: t('browse.service.empty'), detail: t(genre ? 'browse.service.empty-genre-detail' : 'browse.service.empty-detail', { name: service.name, region: regionName(region) }) }));
        // A page the content limit emptied (or that only repeated titles) leaves the sentinel in view, which doesn't fire again: ask for the next one.
        if (!done && !titles.length) setTimeout(loadMore);
        // Nor does it fire when a page didn't fill a tall window: observing again asks whether it's still in view.
        else if (!done) {
          pager.unobserve(sentinel);
          pager.observe(sentinel);
        }
      })
      .catch((err: unknown) => {
        if (current !== generation) return;
        status.replaceChildren(errorState({ title: t('browse.service.failed', { name: service.name }), err, retry: loadMore, go: ctx.go, service: 'tmdb' }));
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
  // A pushed page: once it's dropped, nothing should keep it (and its grid) alive.
  root.addEventListener(VIEW_DISCARDED, () => pager.disconnect(), { once: true });

  render();
  return root;
}
