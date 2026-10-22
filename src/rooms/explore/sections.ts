/**
 * Discover's sections below the banner. Each builds its element when it
 * scrolls near (index.ts), so opening the page doesn't send every request
 * at once; rows show skeletons while loading and hide themselves when empty.
 * Every title list goes through the profile's content limit where it's
 * loaded (catalog/tmdb.ts, or `allowedTitles` here) and leaves out titles
 * marked Not interested.
 */
import type { RoomContext } from '../../app/router';
import { AWARD_TILES, countryOfDay, GENRE_LABELS, genreOf, GENRES, LANGUAGES, LETTERBOXD_TOP, serviceGenre, yearsAgo, type GenreKey } from '../../catalog/explore';
import { letterboxdListPage, type LetterboxdListRef } from '../../catalog/letterboxd';
import { allowedTitles, limited } from '../../catalog/parental';
import { regionName, streamingRegion } from '../../catalog/streaming';
import { seasonalList, seasonalQuery, whatsNewQuery, type DiscoverQuery, type WhatsNewId } from '../../catalog/whats-new';
import { favouriteActor, genrePairOfDay, interleave } from '../../catalog/taste';
import { awardPage, castFor, genreArt, servicePage, tmdbSourcePage, type Award, type StreamingService } from '../../catalog/tmdb';
import type { Title } from '../../catalog/titles';
import { asyncRail, rail } from '../../components/cards';
import { icon } from '../../components/icons';
import { language, locale, t, tn, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { customCollections, loadCollections } from '../../library/collections';
import { lastWatchedAt, tasteWatched } from '../../library/watch';
import { collectionsRail } from '../collections/overview';
import { openSurprise } from '../discover/surprise';
import { createServicePage } from '../streaming/service';
import type { DiscoverSpec } from './filters';
import { createGridPage, type GridSource, type Kind, type PageLoader } from './grid';
import { createQueuePage } from './queue';
import { browseTile } from './tiles';
import { visible } from './state';
import { titleCard } from '../title-card';

export interface SectionDeps {
  ctx: RoomContext;
  play(title: Title): void;
  openDetail(title: Title): void;
  /** A poster card's menu, with "Not interested". */
  menu(card: HTMLElement, title: Title): HTMLElement;
  /** Discover's genres the person watches most, most first. */
  favourites: GenreKey[];
  /** The picked streaming services (with names and logos) and their country. */
  services(): Promise<{ services: StreamingService[]; region: string }>;
  /** The Discovery Queue's titles. */
  queue(): Promise<Title[]>;
  now: number;
}

const languageNames = new Intl.DisplayNames([locale()], { type: 'language' });
const languageName = (code: string) => languageNames.of(code) ?? code;

/** A query on TMDB's discover, for movies or shows; its grid can be filtered further (filters.ts). */
const discoverSpec = (filters: DiscoverSpec['filters'], sort: DiscoverSpec['sort'] = () => 'popularity.desc'): DiscoverSpec => ({ filters, sort });

/** Pages of TMDB's discover, for movies or shows. */
const discoverPage =
  (spec: DiscoverSpec): PageLoader =>
  (kind, page) =>
    tmdbSourcePage({ kind: 'discover', media: kind === 'movie' ? 'movie' : 'tv', sort: spec.sort(kind), filters: spec.filters(kind) }, page);

/** A discover query's pages and the query itself, for a filterable grid. */
const discoverGrid = (spec: DiscoverSpec) => ({ load: discoverPage(spec), discover: spec });

/** A row of posters with "View all" opening `grid` (when given). */
function row(deps: SectionDeps, options: { title: string; sub?: string | undefined; tag?: string; load: () => Promise<Title[]>; grid?: GridSource | undefined }): HTMLElement {
  const { grid } = options;
  const rail = asyncRail({
    title: options.title,
    source: options.tag ?? options.sub,
    onSeeAll: grid ? () => deps.ctx.open(createGridPage(grid, deps.ctx)) : undefined,
    go: deps.ctx.go,
    load: async () => visible(await options.load()).map((title) => titleCard(title, () => deps.openDetail(title), {}, (card) => deps.menu(card, title))),
  });
  // A source's name (Letterboxd) reads as a tag; a subtitle as a quiet line.
  rail.querySelector('.rail-source')?.classList.add(options.tag ? 'explore-tag' : 'explore-sub');
  return rail;
}

/** A row of tiles under a heading (genres, languages, awards). */
/** A row of tiles, with the scroll arrows every rail has (they run off the edge on most windows). */
function tileRow(title: string, tiles: HTMLElement[]): HTMLElement {
  return rail({ title, cards: tiles, variant: 'genres' });
}

const both: readonly Kind[] = ['movie', 'series'];

export function genreGrid(key: GenreKey): GridSource {
  const genre = genreOf(key);
  const name = t(GENRE_LABELS[key]);
  return {
    title: name,
    eyebrow: t('explore.genres.title'),
    intro: t('explore.genre.intro', { genre: name }),
    kinds: genre.tv === null ? ['movie'] : both,
    ...discoverGrid(discoverSpec((kind) => ({ withGenres: String(kind === 'movie' ? genre.movie : genre.tv), voteCountGte: 20 }))),
  };
}

function awardGrid(award: (typeof AWARD_TILES)[number]): GridSource {
  const name = `${t(award.name)} · ${t(award.category)}`;
  return { title: name, eyebrow: t('explore.awards.title'), intro: t('explore.award.intro', { award: name }), kinds: [award.key === 'emmys' ? 'series' : 'movie'], load: (_kind, page) => awardPage(award.key, page) };
}

const genres = (deps: SectionDeps): HTMLElement => {
  const tiles = GENRES.map((genre) => browseTile({ name: t(GENRE_LABELS[genre.key]), hue: genre.hue, onOpen: () => deps.ctx.open(createGridPage(genreGrid(genre.key), deps.ctx)) }));
  // The collage fills in once TMDB answers; until then (or without art) the tiles are tinted.
  // Under a content limit they stay tinted: the art is of popular films, which the limit hasn't checked.
  if (!limited()) {
    void genreArt(GENRES.map((g) => g.movie))
      .then((art) => GENRES.forEach((genre, i) => tiles[i]!.setArt(art?.get(genre.movie) ?? [])))
      .catch((err: unknown) => console.warn('Could not load genre artwork', err));
  }
  return tileRow(
    t('explore.genres.title'),
    tiles.map((tile) => tile.element),
  );
};

const languages = (deps: SectionDeps): HTMLElement =>
  tileRow(
    t('explore.languages.title'),
    LANGUAGES.map((lang) => {
      const name = languageName(lang.code);
      const grid: GridSource = {
        title: name,
        eyebrow: t('explore.languages.title'),
        intro: t('explore.language.intro', { language: name }),
        kinds: both,
        ...discoverGrid(discoverSpec(() => ({ withOriginalLanguage: lang.code, voteCountGte: 20 }))),
      };
      // The language's own name sits faintly behind, unless it's the same word.
      return browseTile({ name, native: lang.native.toLowerCase() === name.toLowerCase() ? undefined : lang.native, hue: lang.hue, variant: 'language', onOpen: () => deps.ctx.open(createGridPage(grid, deps.ctx)) }).element;
    }),
  );

const awards = (deps: SectionDeps): HTMLElement =>
  tileRow(
    t('explore.awards.title'),
    AWARD_TILES.map((award) => browseTile({ name: t(award.name), sub: t(award.category), hue: award.hue, variant: 'award', onOpen: () => deps.ctx.open(createGridPage(awardGrid(award), deps.ctx)) }).element),
  );

const awardRow = (deps: SectionDeps, award: Award = 'oscars'): HTMLElement => {
  const tile = AWARD_TILES.find((a) => a.key === award)!;
  return row(deps, { title: t('explore.award-winning.title'), sub: t('explore.award-winning.sub'), load: async () => (await awardPage(award, 1))?.titles ?? [], grid: awardGrid(tile) });
};

/** Highest rated, with enough votes that the average means something (fewer for shows, which get fewer). */
const topRatedFilters = (kind: Kind, extra: Record<string, string | number> = {}) => ({ voteCountGte: kind === 'movie' ? 2500 : 500, ...extra });

const topRated = (deps: SectionDeps): HTMLElement => {
  const grid = discoverGrid(discoverSpec(topRatedFilters, () => 'vote_average.desc'));
  return row(deps, { title: t('explore.top-rated.title'), sub: t('explore.top-rated.sub'), load: async () => (await grid.load('movie', 1))?.titles ?? [], grid: { title: t('explore.top-rated.title'), kinds: both, ...grid } });
};

const topGenre = (deps: SectionDeps): HTMLElement | null => {
  const key = deps.favourites[0];
  if (!key) return null;
  const genre = genreOf(key);
  const title = t('explore.top-genre.title', { genre: t(GENRE_LABELS[key]) });
  const grid = discoverGrid(discoverSpec((kind) => topRatedFilters(kind, { withGenres: String(kind === 'movie' ? genre.movie : genre.tv), voteCountGte: kind === 'movie' ? 800 : 200 }), () => 'vote_average.desc'));
  return row(deps, { title, sub: t('explore.top-genre.sub'), load: async () => (await grid.load('movie', 1))?.titles ?? [], grid: { title, kinds: genre.tv === null ? ['movie'] : both, ...grid } });
};

const country = (deps: SectionDeps): HTMLElement => {
  const code = countryOfDay(language(), deps.now);
  const title = t('explore.country.title', { country: regionName(code) });
  const grid = discoverGrid(discoverSpec(() => ({ withOriginCountry: code, voteCountGte: 50 })));
  return row(deps, { title, sub: t('explore.country.sub'), load: async () => (await grid.load('movie', 1))?.titles ?? [], grid: { title, eyebrow: t('explore.country.sub'), kinds: both, ...grid } });
};

/** Up to this many services get a row. */
const MAX_SERVICE_ROWS = 3;

const services = async (deps: SectionDeps): Promise<HTMLElement | null> => {
  const { services, region } = await deps.services();
  if (!services.length) return null;
  // The favourite genre the service's pages can filter by, for each kind.
  const genreFor = (kind: Kind) => deps.favourites.map((key) => serviceGenre(key, kind)).find((g) => g !== undefined);
  const genre = genreFor('movie');
  return h(
    'div',
    { class: 'explore-stack' },
    ...services.slice(0, MAX_SERVICE_ROWS).map((service) =>
      asyncRailFor(deps, t('explore.services.title', { service: service.name }), genre ? t('explore.services.sub') : undefined, async () => {
        const pages = await Promise.allSettled([servicePage(service.key, region, 'movie', genre, 1), servicePage(service.key, region, 'series', genreFor('series'), 1)]);
        if (pages.every((p) => p.status === 'rejected')) throw (pages[0] as PromiseRejectedResult).reason;
        return interleave(pages.map((p) => (p.status === 'fulfilled' ? (p.value?.titles ?? []) : [])));
      }, () => deps.ctx.open(createServicePage(service, region, deps.ctx))),
    ),
  );
};

/** A poster row whose "View all" opens another page. */
function asyncRailFor(deps: SectionDeps, title: string, sub: string | undefined, load: () => Promise<Title[]>, seeAll: () => void): HTMLElement {
  const rail = asyncRail({ title, source: sub, onSeeAll: seeAll, go: deps.ctx.go, load: async () => visible(await load()).map((t) => titleCard(t, () => deps.openDetail(t), {}, (card) => deps.menu(card, t))) });
  rail.querySelector('.rail-source')?.classList.add('explore-sub');
  return rail;
}

const genreMix = (deps: SectionDeps): HTMLElement | null => {
  const pair = genrePairOfDay(deps.favourites, deps.now);
  if (!pair) return null;
  const [first, second] = pair.map(genreOf);
  const title = t('explore.mix.title', { first: t(GENRE_LABELS[first!.key]), second: t(GENRE_LABELS[second!.key]) });
  // Comma: titles in both genres.
  const grid = discoverGrid(discoverSpec(() => ({ withGenres: `${first!.movie},${second!.movie}`, voteCountGte: 200 })));
  return row(deps, { title, sub: t('explore.mix.sub'), load: async () => (await grid.load('movie', 1))?.titles ?? [], grid: { title, kinds: ['movie'], ...grid } });
};

/** Watched titles whose casts are looked up (two TMDB requests each). */
const MAX_CAST_LOOKUPS = 8;

const actor = async (deps: SectionDeps): Promise<HTMLElement | null> => {
  const watched = tasteWatched()
    .filter((title) => /^tt\d+$/.test(title.id) && (title.type === 'movie' || title.type === 'series'))
    .slice(0, MAX_CAST_LOOKUPS);
  const casts = await Promise.all(watched.map((title) => castFor(title).catch(() => null)));
  const favourite = favouriteActor(casts.filter((cast) => cast !== null));
  if (!favourite) return null;
  const load: PageLoader = async (_kind, page) => {
    const result = await tmdbSourcePage({ kind: 'person', id: favourite.id, media: 'movie', sort: 'vote_average.desc', filters: { voteCountGte: 200 } }, page);
    return result && { ...result, titles: result.titles.filter((title) => !lastWatchedAt(title.id)) };
  };
  const sub = t('explore.actor.sub', { name: favourite.name });
  return row(deps, { title: t('explore.actor.title'), sub, load: async () => (await load('movie', 1))?.titles ?? [], grid: { title: favourite.name, eyebrow: t('explore.actor.title'), kinds: ['movie'], load } });
};

const gems = (deps: SectionDeps): HTMLElement => {
  const grid = discoverGrid(discoverSpec((kind) => ({ voteAverageGte: 7.5, voteCountGte: kind === 'movie' ? 80 : 40, voteCountLte: kind === 'movie' ? 600 : 250 }), () => 'vote_average.desc'));
  return row(deps, { title: t('explore.gems.title'), sub: t('explore.gems.sub'), load: async () => (await grid.load('movie', 1))?.titles ?? [], grid: { title: t('explore.gems.title'), kinds: both, ...grid } });
};

const critics = (deps: SectionDeps): HTMLElement => {
  const since = yearsAgo(deps.now, 2);
  const grid = discoverGrid(discoverSpec((kind) => ({ releaseDateGte: since, voteAverageGte: 7.2, voteCountGte: kind === 'movie' ? 300 : 100 }), () => 'vote_average.desc'));
  return row(deps, { title: t('explore.critics.title'), sub: t('explore.critics.sub'), load: async () => (await grid.load('movie', 1))?.titles ?? [], grid: { title: t('explore.critics.title'), kinds: both, ...grid } });
};

/** Today here, not in UTC (a day off in the evening or morning, depending on the zone). */
const localDay = (now: number) => new Date(now - new Date(now).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** A row of one TMDB discover query (one kind), its "See all" a filterable grid of it. */
function queryRow(deps: SectionDeps, query: DiscoverQuery, title: string, sub: string): HTMLElement {
  const kind: Kind = query.media === 'movie' ? 'movie' : 'series';
  const grid = discoverGrid(discoverSpec(() => query.filters, () => query.sort));
  return row(deps, { title, sub, load: async () => (await grid.load(kind, 1))?.titles ?? [], grid: { title, eyebrow: sub, kinds: [kind], ...grid } });
}

const WHATS_NEW_TEXT: Record<WhatsNewId, [MessageKey, MessageKey]> = {
  'in-cinemas': ['pages.new.in-cinemas', 'pages.new.in-cinemas-sub'],
  'new-to-stream': ['pages.new.new-to-stream', 'pages.new.new-to-stream-sub'],
  'airing-week': ['pages.new.airing-week', 'pages.new.airing-week-sub'],
  upcoming: ['pages.new.upcoming', 'pages.new.upcoming-sub'],
};

/** "In cinemas now", "New to stream", "Airing this week" and "Upcoming", in the person's country (Settings → streaming region). */
const whatsNew =
  (id: WhatsNewId) =>
  async (deps: SectionDeps): Promise<HTMLElement> => {
    const region = await streamingRegion().catch(() => 'US');
    const [title, sub] = WHATS_NEW_TEXT[id];
    return queryRow(deps, whatsNewQuery(id, localDay(deps.now), region), t(title), t(sub, { country: regionName(region) }));
  };

/** The time of year's list: Halloween in October, Christmas in December, else films based on a true story. */
const seasonal = (deps: SectionDeps): HTMLElement => {
  const list = seasonalList(new Date(deps.now));
  return queryRow(deps, seasonalQuery(list, 'movie'), t(list.title), t(list.sub));
};

/** A public Letterboxd list as a row; "View all" pages through it. */
export function letterboxdRow(deps: SectionDeps, list: LetterboxdListRef, title: string): HTMLElement {
  const page = (n: number) => letterboxdListPage(list, n, allowedTitles);
  const load: PageLoader = (_kind, n) => page(n);
  return row(deps, { title, tag: t('explore.letterboxd-tag'), load: async () => (await page(1)).titles, grid: { title, eyebrow: t('explore.letterboxd-tag'), kinds: ['movie'], load } });
}

const surprise = (deps: SectionDeps): HTMLElement => {
  const pick = (kind: 'movie' | 'series', label: string) => {
    const button = h('button', { class: 'button glass' }, icon('shuffle'), label);
    button.addEventListener('click', () => openSurprise(kind, { play: deps.play, openDetail: deps.openDetail }));
    return button;
  };
  return h(
    'section',
    { class: 'explore-strip', 'aria-label': t('explore.surprise.label') },
    h('div', { class: 'explore-strip-text' }, h('h2', { class: 'rail-heading' }, t('explore.surprise.title')), h('p', { class: 'muted' }, t('explore.surprise.body'))),
    h('div', { class: 'explore-strip-actions' }, pick('movie', t('explore.surprise.movie')), pick('series', t('explore.surprise.series'))),
  );
};

/** One of the queue's fanned posters. One that doesn't load stays as a plain card in the fan, not a broken-image icon. */
function queuePoster(src: string): HTMLElement {
  const img = h('img', { class: 'explore-queue-poster', src, alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(h('span', { class: 'explore-queue-poster' })), { once: true });
  return img;
}

const queue = async (deps: SectionDeps): Promise<HTMLElement> => {
  const titles = await deps.queue();
  const open = h('button', { class: 'button primary explore-queue-open', disabled: !titles.length }, t('explore.queue.open'), icon('chevronRight'));
  open.addEventListener('click', () => deps.ctx.open(createQueuePage(titles, deps.ctx)));
  const art = titles.slice(0, 3).flatMap((title) => (title.poster ? [queuePoster(title.poster)] : []));
  return h(
    'section',
    { class: 'explore-strip explore-queue-strip', 'aria-label': t('explore.queue.title') },
    art.length ? h('div', { class: 'explore-queue-posters', 'aria-hidden': 'true' }, ...art) : '',
    h(
      'div',
      { class: 'explore-strip-text' },
      h('h2', { class: 'rail-heading' }, t('explore.queue.title')),
      h('p', { class: 'muted' }, titles.length ? `${tn('explore.queue.ready', titles.length)} · ${t('explore.queue.body')}` : t('explore.queue.empty')),
    ),
    h('div', { class: 'explore-strip-actions' }, open),
  );
};

const collections = async (deps: SectionDeps): Promise<HTMLElement> => {
  await loadCollections();
  return collectionsRail({ title: t('explore.collections.title'), collections: customCollections(), style: 'poster', ctx: deps.ctx });
};

/** Discover's sections by id (the banner is index.ts's), each needing TMDB or not. */
export const SECTION_BUILDERS: Record<string, { tmdb: boolean; label: () => string; build(deps: SectionDeps): HTMLElement | null | Promise<HTMLElement | null> }> = {
  surprise: { tmdb: false, label: () => t('explore.surprise.label'), build: surprise },
  queue: { tmdb: true, label: () => t('explore.queue.title'), build: queue },
  genres: { tmdb: true, label: () => t('explore.genres.title'), build: genres },
  'top-rated': { tmdb: true, label: () => t('explore.top-rated.title'), build: topRated },
  languages: { tmdb: true, label: () => t('explore.languages.title'), build: languages },
  'award-winning': { tmdb: true, label: () => t('explore.award-winning.title'), build: (deps) => awardRow(deps) },
  awards: { tmdb: true, label: () => t('explore.awards.title'), build: awards },
  'top-genre': { tmdb: true, label: () => t('explore.top-genre.label'), build: topGenre },
  country: { tmdb: true, label: () => t('explore.country.label'), build: country },
  services: { tmdb: true, label: () => t('explore.services.label'), build: services },
  'genre-mix': { tmdb: true, label: () => t('explore.mix.label'), build: genreMix },
  actor: { tmdb: true, label: () => t('explore.actor.title'), build: actor },
  gems: { tmdb: true, label: () => t('explore.gems.title'), build: gems },
  critics: { tmdb: true, label: () => t('explore.critics.title'), build: critics },
  'in-cinemas': { tmdb: true, label: () => t('pages.new.in-cinemas'), build: whatsNew('in-cinemas') },
  'new-to-stream': { tmdb: true, label: () => t('pages.new.new-to-stream'), build: whatsNew('new-to-stream') },
  'airing-week': { tmdb: true, label: () => t('pages.new.airing-week'), build: whatsNew('airing-week') },
  upcoming: { tmdb: true, label: () => t('pages.new.upcoming'), build: whatsNew('upcoming') },
  seasonal: { tmdb: true, label: () => t('pages.seasonal.label'), build: seasonal },
  collections: { tmdb: false, label: () => t('explore.collections.title'), build: collections },
  'letterboxd-top': { tmdb: false, label: () => t('explore.letterboxd-top.title'), build: (deps) => letterboxdRow(deps, LETTERBOXD_TOP, t('explore.letterboxd-top.title')) },
};
