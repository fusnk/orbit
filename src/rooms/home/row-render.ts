/**
 * Draws Home's rails in the style picked for them, and the rows the person
 * added in the Home builder (Settings → Home rows): a catalog or a genre of
 * one, a custom list, My Library, a streaming service, a mood, or a row from
 * the profile's Jellyfin or Plex server, or collections.
 */
import { t, type MessageKey } from '../../i18n';
import type { RoomContext } from '../../app/router';
import { loadCatalog } from '../../catalog/service';
import { streamingRegion } from '../../catalog/streaming';
import { streamingCatalog, streamingServices, tmdbSourcePage, type StreamingService } from '../../catalog/tmdb';
import { railTitle, type CatalogRef, type Title } from '../../catalog/titles';
import { asyncRail, landscapeCard, posterCard, rankedCard } from '../../components/cards';
import { h } from '../../lib/dom';
import type { TvChannel } from '../../live/iptv';
import { jellyfinLibraries, jellyfinRow, jellyfinStatus } from '../../library/jellyfin';
import type { ServerFeed, ServerLibrary, ServerStatus } from '../../library/media-server';
import { plexLibraries, plexRow, plexStatus } from '../../library/plex';
import { inLibrary, libraryEntries } from '../../library/library';
import { customLists, findList } from '../../library/lists';
import { coverOf, customCollections, loadCollections } from '../../library/collections';
import { collectionsRail } from '../collections/overview';
import { recentlyWatched, watchedTitles } from '../../library/watch';
import { createServicePage } from '../streaming/service';
import { genreTags, MOOD_GENRES, selectMood, stillOnList, type MoodId } from './moods';
import { seasonalList, seasonalQuery } from '../../catalog/whats-new';
import { tagCard } from './card-tags';
import { liveFavourites, liveNowRow, statusTiles, todayRow } from './dashboard';
import type { AddedRow, RowStyle } from './rows';
import type { TitleActions } from './sections';
import type { RowFeed } from './feeds';

const TOP_COUNT = 10;
/** Catalogs whose first page feeds the mood rows. */
const MOOD_CATALOGS = 4;

/** Rail variants by style; 'posters' only keeps a Posters row's placeholders posters whatever the card shape. */
const VARIANTS: Record<RowStyle, string> = { poster: 'posters', landscape: 'continue', top10: 'ranked' };

/**
 * Titles a Top 10 row on Home ranks, so their landscape cards in other rows
 * can say so ("TOP 10" in the corner; some themes show it, crimson.css).
 * Only what a Top 10 row actually loaded counts.
 */
const topTen = new Set<string>();

function topTenBadge(card: HTMLElement): void {
  if (card.querySelector('.top-ten-badge')) return;
  card.querySelector('.frame')?.append(h('span', { class: 'top-ten-badge', 'aria-hidden': 'true' }, t('browse.cards.top-badge', { rank: TOP_COUNT })));
}

function noteTopTen(titles: readonly Title[]): void {
  for (const title of titles) topTen.add(title.id);
  for (const card of document.querySelectorAll<HTMLElement>('[data-top-for]')) if (topTen.has(card.dataset.topFor!)) topTenBadge(card);
}

/** Cards for `titles` in a row's style. */
export function titleCards(titles: readonly Title[], style: RowStyle, { openDetail, withMenu }: TitleActions): HTMLElement[] {
  if (style === 'top10') {
    const ranked = titles.slice(0, TOP_COUNT);
    noteTopTen(ranked);
    return ranked.map((title, i) => withMenu(rankedCard(title, i + 1, () => openDetail(title)), title));
  }
  if (style === 'landscape')
    return titles.map((title) => {
      const card = landscapeCard(title, () => openDetail(title), { lookUpLogo: true });
      card.dataset.topFor = title.id;
      if (topTen.has(title.id)) topTenBadge(card);
      return withMenu(tagCard(card, title), title);
    });
  return titles.map((title) => withMenu(tagCard(posterCard(title, () => openDetail(title)), title), title));
}

/**
 * Each title once, at its first place: an addon can list a title twice in a catalog, which drew it twice
 * in a row (twice in a Top 10) with two cards Back and focus couldn't tell apart.
 */
export function onceEach(titles: readonly Title[]): Title[] {
  const seen = new Set<string>();
  return titles.filter((title) => !seen.has(title.id) && !!seen.add(title.id));
}

/** An async rail of titles, drawn in `style`. */
export function styledRail(
  options: { title: string; source?: string | undefined; onSeeAll?: (() => void) | undefined; style: RowStyle; load: () => Promise<readonly Title[]>; empty?: { title: string; detail?: string } | undefined },
  actions: TitleActions,
): HTMLElement {
  return asyncRail({
    title: options.title,
    source: options.source,
    onSeeAll: options.onSeeAll,
    empty: options.empty,
    variant: VARIANTS[options.style],
    go: actions.go,
    load: async () => titleCards(onceEach(await options.load()), options.style, actions),
  });
}

/** A catalog's genre choices, if it filters by genre. */
export const catalogGenres = (ref: CatalogRef): string[] => ref.catalog.extra.find((e) => e.name === 'genre')?.options ?? [];

/** The installed catalog an added row names, if it's still there. */
export function findCatalog(refs: readonly CatalogRef[], source: { addon: string; type: string; catalog: string }): CatalogRef | undefined {
  return refs.find((ref) => ref.addon.manifest.id === source.addon && ref.catalog.type === source.type && ref.catalog.id === source.catalog);
}

/**
 * Loads a catalog, optionally one genre of it. The genre must be one the
 * catalog offers; it replaces any genre the catalog needs by default.
 */
export function loadCatalogGenre(ref: CatalogRef, genre?: string): Promise<Title[]> {
  if (!genre) return loadCatalog(ref);
  return loadCatalog({ ...ref, extra: ref.extra.filter(([name]) => name !== 'genre') }, [['genre', genre]]);
}

const MOOD_LABELS: Record<MoodId, MessageKey> = {
  short: 'homerows.mood.short',
  comfort: 'homerows.mood.comfort',
  'mind-bending': 'homerows.mood.mind-bending',
  'late-night': 'homerows.mood.late-night',
  'feel-good': 'homerows.mood.feel-good',
  'hidden-gems': 'homerows.mood.hidden-gems',
  'still-on-list': 'homerows.mood.still-on-list',
  seasonal: 'pages.seasonal.label',
};
/** A mood's name; the seasonal row's follows the time of year ("Halloween picks"). */
export const moodLabel = (mood: MoodId) => (mood === 'seasonal' ? t(seasonalList(new Date()).title) : t(MOOD_LABELS[mood]));

/**
 * Titles the mood rows choose from: the first page of a few catalogs (which
 * Home's rails load anyway), plus, for genre moods, that genre's page of the
 * first movie and series catalogs that filter by genre.
 */
export async function moodPool(mood: MoodId, refs: readonly CatalogRef[]): Promise<{ title: Title; rank: number }[]> {
  const base = refs.filter((ref) => ref.catalog.type === 'movie' || ref.catalog.type === 'series').slice(0, MOOD_CATALOGS);
  const loads: Promise<Title[]>[] = base.map((ref) => loadCatalog(ref));
  const filterable = ['movie', 'series'].flatMap((type) => base.find((ref) => ref.catalog.type === type && catalogGenres(ref).length) ?? []);
  for (const tag of MOOD_GENRES[mood] ?? []) {
    for (const ref of filterable) {
      const genre = catalogGenres(ref).find((name) => genreTags([name]).has(tag));
      if (genre) loads.push(loadCatalogGenre(ref, genre));
    }
  }
  const settled = await Promise.allSettled(loads);
  // Some catalogs failing still leaves picks; every one failing is an error, not "nothing fits".
  const failed = settled.find((r) => r.status === 'rejected');
  if (failed && settled.every((r) => r.status === 'rejected')) throw failed.reason;
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value.map((title, rank) => ({ title, rank })) : []));
}

/** Titles for a mood row, from the catalogs Home already uses and the person's history. */
export async function moodTitles(mood: MoodId, refs: readonly CatalogRef[]): Promise<Title[]> {
  if (mood === 'still-on-list') return stillOnList(libraryEntries(), new Set(recentlyWatched().map((title) => title.id)));
  // TMDB's keyword list for the time of year; nothing without a TMDB token (the row then hides).
  if (mood === 'seasonal') {
    const query = seasonalQuery(seasonalList(new Date()), 'movie');
    return (await tmdbSourcePage({ kind: 'discover', ...query }, 1))?.titles ?? [];
  }
  const lists = customLists();
  const kept = (id: string) => inLibrary(id) || lists.some((list) => list.titles.some((title) => title.id === id));
  return selectMood(mood, {
    pool: mood === 'comfort' ? [] : await moodPool(mood, refs),
    finished: watchedTitles().map(({ title, updatedAt }) => ({ title, finishedAt: updatedAt, loved: kept(title.id) })),
    seen: new Set(recentlyWatched().map((title) => title.id)),
    now: Date.now(),
  });
}

export interface AddedDeps extends TitleActions {
  ctx: RoomContext;
  play(title: Title): void;
  /** Every browsable catalog, of any type. */
  refs: readonly CatalogRef[];
  /** Opens Movies or TV Shows on a catalog (and genre). */
  openCatalog(ref: CatalogRef, genre?: string): void;
}

export interface ResolvedRow {
  /** The row's name in Settings, e.g. "Horror · Popular Movies (Cinemeta)". */
  label: string;
  /** Changes when the row's titles may have (lists and My Library), so Home redraws it. */
  version: string;
  /** False for rows that aren't rails (tiles), which have no style to pick. */
  styled?: false;
  /** The rail, or null when its source is gone (an uninstalled addon, a deleted list). */
  render(style: RowStyle): HTMLElement | null;
  /** Its titles as data (the phone remote's picker); none for rows that aren't titles. */
  feed?: RowFeed;
}

type ServerKind = 'jellyfin' | 'plex';

/** One of the profile's own servers, and (if a row needs them) its libraries. */
interface ServerContext {
  server: ServerStatus | null;
  /** Null when the server couldn't list them just now (offline, say). */
  libraries: ServerLibrary[] | null;
}

const SERVERS: Record<ServerKind, { status(): Promise<ServerStatus | null>; libraries(): Promise<ServerLibrary[]>; row(feed: ServerFeed, library?: string): Promise<Title[]> }> = {
  jellyfin: { status: jellyfinStatus, libraries: jellyfinLibraries, row: jellyfinRow },
  plex: { status: plexStatus, libraries: plexLibraries, row: plexRow },
};

async function serverContext(kind: ServerKind, rows: readonly AddedRow[]): Promise<ServerContext> {
  const own = rows.filter((row) => row.source.kind === kind);
  if (!own.length) return { server: null, libraries: [] };
  const server = await SERVERS[kind].status().catch(() => null);
  const needsLibraries = !!server && own.some((row) => 'feed' in row.source && row.source.feed === 'library');
  const libraries = needsLibraries ? await SERVERS[kind].libraries().catch(() => null) : [];
  return { server, libraries };
}

/** Labels and renderers for the added rows; streaming services and the servers' libraries are looked up once for all. */
export async function resolveAddedRows(rows: readonly AddedRow[], deps: AddedDeps): Promise<Map<string, ResolvedRow>> {
  const needsServices = rows.some((row) => row.source.kind === 'service');
  if (rows.some((row) => row.source.kind === 'collections')) await loadCollections();
  const [[services, region], jellyfin, plex, favourites] = await Promise.all([
    needsServices ? Promise.all([streamingServices().catch(() => null), streamingRegion()]) : Promise.resolve([null, ''] as const),
    serverContext('jellyfin', rows),
    serverContext('plex', rows),
    // Known before the row draws, so a Home without Live TV favourites never shows it at all.
    rows.some((row) => row.source.kind === 'live') ? liveFavourites() : Promise.resolve([]),
  ]);
  return new Map(rows.map((row) => [row.id, resolveRow(row, deps, services ?? [], region, { jellyfin, plex }, favourites)]));
}

function resolveRow(row: AddedRow, deps: AddedDeps, services: readonly StreamingService[], region: string, servers: Record<ServerKind, ServerContext>, favourites: readonly TvChannel[]): ResolvedRow {
  const gone = (label: string): ResolvedRow => ({ label: t('homerows.unavailable', { name: row.name ?? label }), version: '', render: () => null });
  const { source } = row;
  switch (source.kind) {
    case 'catalog': {
      const ref = findCatalog(deps.refs, source);
      if (!ref || (source.genre && !catalogGenres(ref).includes(source.genre))) return gone(source.genre ?? source.catalog);
      const own = source.genre ? t('homerows.genre-of', { genre: source.genre, row: railTitle(ref.catalog) }) : railTitle(ref.catalog);
      const discoverable = ref.catalog.type === 'movie' || ref.catalog.type === 'series';
      const feed: RowFeed = { title: row.name ?? own, load: () => loadCatalogGenre(ref, source.genre) };
      return {
        label: t('browse.home.row-source', { row: row.name ?? own, source: ref.addon.manifest.name }),
        version: '',
        feed,
        render: (style) =>
          styledRail(
            {
              ...feed,
              source: ref.addon.builtIn ? undefined : ref.addon.manifest.name,
              onSeeAll: discoverable ? () => deps.openCatalog(ref, source.genre) : undefined,
              style,
            },
            deps,
          ),
      };
    }
    case 'list': {
      const list = findList(source.list);
      if (!list) return gone(t('homerows.kind.list'));
      const feed: RowFeed = { title: row.name ?? list.name, load: async () => list.titles };
      return {
        label: row.name ?? list.name,
        version: `${list.name}|${list.titles.map((title) => title.id).join()}`,
        feed,
        render: (style) => styledRail({ ...feed, style }, deps),
      };
    }
    case 'library': {
      const own = t('titles.common.my-library');
      const feed: RowFeed = { title: row.name ?? own, load: async () => libraryEntries().map((entry) => entry.title) };
      return {
        label: row.name ?? own,
        version: libraryEntries()
          .map((entry) => entry.title.id)
          .join(),
        feed,
        render: (style) => styledRail({ ...feed, style, onSeeAll: () => deps.ctx.go('library') }, deps),
      };
    }
    case 'service': {
      const service = services.find((s) => s.key === source.service);
      if (!service) return gone(source.service);
      const own = t('browse.home.popular-on', { name: service.name });
      const feed: RowFeed = { title: row.name ?? own, load: async () => (await streamingCatalog(service.key, region)) ?? [] };
      return {
        label: row.name ?? own,
        version: region,
        feed,
        render: (style) => styledRail({ ...feed, style, onSeeAll: () => deps.ctx.open(createServicePage(service, region, deps.ctx)) }, deps),
      };
    }
    case 'mood': {
      const own = moodLabel(source.mood);
      // Comfort rewatches come from what's been finished and kept, so it follows those, My Library and lists; "Still on your list" follows
      // My Library and what's started. The others leave out what's been started or finished, so they follow both (the time of year's doesn't).
      const version =
        source.mood === 'comfort' ? `${libraryEntries().length}|${customLists().reduce((n, list) => n + list.titles.length, 0)}|${watchedTitles().length}`
        : source.mood === 'still-on-list' ? `${libraryEntries().map((entry) => entry.title.id).join()}|${recentlyWatched().length}`
        : source.mood === 'seasonal' ? ''
        : `${recentlyWatched().length}|${watchedTitles().length}`;
      const feed: RowFeed = { title: row.name ?? own, load: () => moodTitles(source.mood, deps.refs) };
      return { label: row.name ?? own, version, feed, render: (style) => styledRail({ ...feed, style }, deps) };
    }
    case 'collections': {
      const shown = customCollections().filter((c) => !source.group || c.group === source.group);
      // A group that's gone (all its collections deleted) has nothing to show.
      if (source.group && !shown.length) return gone(source.group);
      const own = source.group ?? t('collections.row.title');
      return {
        label: row.name ?? (source.group ? t('collections.row.group-label', { group: source.group }) : own),
        version: shown.map((c) => `${c.id}|${c.name}|${coverOf(c) ?? ''}|${c.shape}`).join(),
        render: (style) => collectionsRail({ title: row.name ?? own, collections: shown, style, ctx: deps.ctx }),
      };
    }
    case 'status':
      // No heading of its own: it usually sits beside Continue Watching.
      return { label: row.name ?? t('homerows.status.label'), version: '', styled: false, render: () => statusTiles(deps) };
    case 'today': {
      const own = t('homerows.today.title');
      return { label: row.name ?? own, version: '', styled: false, render: () => todayRow(row.name ?? own, deps) };
    }
    case 'live': {
      const own = t('homerows.live.title');
      return {
        label: row.name ?? own,
        // Redrawn when the favourites change; with none, there's nothing to show.
        version: favourites.map((c) => `${c.source}/${c.key}`).join(),
        styled: false,
        render: () => (favourites.length ? liveNowRow(row.name ?? own, favourites, deps.ctx) : null),
      };
    }
    case 'jellyfin':
    case 'plex': {
      const kind = source.kind;
      const { server, libraries } = servers[kind];
      const library = source.feed === 'library' ? libraries?.find((l) => l.id === source.library) : undefined;
      // Libraries that couldn't be listed (the server is offline, say) aren't gone: the row stays, to say why and retry.
      if (!server || (source.feed === 'library' && !library && libraries)) return gone(t(`${kind}.rows.kind`));
      const own = source.feed === 'library' ? (library?.name ?? t(`${kind}.rows.kind`)) : t(source.feed === 'resume' ? `${kind}.rows.resume` : `${kind}.rows.latest`);
      const feed: RowFeed = { title: row.name ?? own, load: () => SERVERS[kind].row(source.feed, source.library) };
      return {
        label: row.name ?? (library || source.feed !== 'library' ? t(`${kind}.rows.label`, { row: own }) : own),
        // Drawn again with the library's name once it can be listed.
        version: `${server.serverName}|${libraries ? '' : '?'}`,
        feed,
        render: (style) => styledRail({ ...feed, source: server.serverName, style }, deps),
      };
    }
  }
}
