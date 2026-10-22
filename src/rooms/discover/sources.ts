/**
 * Where Movies, TV Shows and Anime get their catalogs. Movies and TV Shows
 * browse the addons' catalogs of their type. Anime prefers real anime
 * catalogs: the person's anime addons (Kitsu, MyAnimeList, AniList…), then
 * anime from TMDB's discover (animation + TMDB's "anime" keyword); only with
 * neither does it fall back to Cinemeta's Animation genre, which also has
 * Western cartoons. Kept free of the page so it can be tested.
 */
import type { ManifestCatalog, UsableAddon } from '../../addons/types';
import { GENRE_LABELS, GENRES } from '../../catalog/explore';
import type { TmdbSourceRequest } from '../../catalog/tmdb';
import { t, type MessageKey } from '../../i18n';

export interface PageSetup {
  /** Catalog types shown here. */
  types: readonly string[];
  /** A genre every addon catalog here is locked to (no genre chips). */
  genre?: string | undefined;
  /** Anime: anime addons and TMDB's anime come before the locked-genre fallback. */
  anime?: boolean | undefined;
}

/** A catalog source in the page's source picker. */
export interface PageSource {
  key: string;
  name: string;
  /** In the page's type order (Anime: shows first). */
  catalogs: ManifestCatalog[];
  /** The addon serving the catalogs; TMDB's anime has none. */
  addon?: UsableAddon | undefined;
  /** The genre its catalogs are locked to (Cinemeta's Animation on Anime). */
  genre?: string | undefined;
}

/** The TMDB anime source's key (it stands where an addon's key would). */
export const TMDB_ANIME = 'tmdb-anime';
/** TMDB's Animation genre (the same id for films and shows). */
const ANIMATION = 16;
/** TMDB's "anime" keyword: Japanese-style animation, not Pixar. */
const ANIME_KEYWORD = 210024;
/**
 * TMDB keywords of explicit titles (softcore, hentai, erotic, erotica,
 * animated porn). TMDB doesn't mark these shows adult, so its popular anime
 * would otherwise open on them; age limits stay the profile's content limit.
 */
const EXPLICIT_KEYWORDS = '155477,198385,256466,325693,378816';

/** A catalog that can be browsed here: every required extra is a genre with options (including a locked genre). */
export function browsable(catalog: ManifestCatalog, setup: PageSetup): boolean {
  const genre = catalog.extra.find((e) => e.name === 'genre');
  return (
    setup.types.includes(catalog.type) &&
    catalog.extra.every((e) => !e.isRequired || (e.name === 'genre' && !!e.options?.length)) &&
    (!setup.genre || !!genre?.options?.includes(setup.genre))
  );
}

/** The catalogs `addon` offers here, in the page's type order. */
export function catalogsFor(addon: UsableAddon, setup: PageSetup): ManifestCatalog[] {
  return setup.types.flatMap((type) => addon.manifest.catalogs.filter((c) => c.type === type && browsable(c, setup)));
}

/** Anime addons' names and ids (Kitsu, MyAnimeList as "mal", AniList, AniDB). */
const ANIME_NAME = /kitsu|myanimelist|anilist|anidb|(^|[^a-z])mal([^a-z]|$)/i;

/** An anime addon's catalog: typed "anime", or named after an anime database. */
export function isAnimeCatalog(catalog: ManifestCatalog, addon: UsableAddon): boolean {
  if (catalog.type === 'anime') return true;
  return ['series', 'movie'].includes(catalog.type) && (ANIME_NAME.test(catalog.id) || ANIME_NAME.test(addon.manifest.id));
}

/** Kinds shown on Anime: shows, then the anime addons' own type, then films. */
const ANIME_TYPES = ['series', 'anime', 'movie'] as const;

function animeAddonCatalogs(addon: UsableAddon): ManifestCatalog[] {
  const setup: PageSetup = { types: ANIME_TYPES };
  return ANIME_TYPES.flatMap((type) => addon.manifest.catalogs.filter((c) => c.type === type && isAnimeCatalog(c, addon) && browsable(c, setup)));
}

/** The page's sources, the one it opens on first. */
export function pageSources(setup: PageSetup, addons: readonly UsableAddon[], tmdb: boolean): PageSource[] {
  const fromAddons = (catalogs: (addon: UsableAddon) => ManifestCatalog[], genre?: string): PageSource[] =>
    addons.flatMap((addon) => {
      const list = catalogs(addon);
      return list.length ? [{ key: addon.key, name: addon.manifest.name, catalogs: list, addon, genre }] : [];
    });
  if (!setup.anime) return fromAddons((addon) => catalogsFor(addon, setup), setup.genre);
  const real = [...fromAddons(animeAddonCatalogs), ...(tmdb ? [tmdbAnimeSource()] : [])];
  // Cinemeta's Animation genre only when there's nothing better: it's mostly Western animation.
  return real.length ? real : fromAddons((addon) => catalogsFor(addon, setup), setup.genre);
}

/** What the grid shows: a source, one of its catalogs, and a genre. */
export interface GridView {
  source: PageSource;
  catalog: ManifestCatalog | undefined;
  genre: string | undefined;
}

/** Where to open the page (a "See all", a genre chip): an addon's catalog and/or a genre. */
export interface Position {
  /** The addon whose catalog to show; the current source when absent. */
  addonKey?: string;
  catalogId?: string;
  genre?: string;
}

/**
 * What the page shows for `at`. When its addon isn't among the sources (removed,
 * or adult under a content limit), its catalog id names nothing here (another
 * addon may have a "top" too); and a genre is kept only if the catalog shown
 * offers it, so falling back never opens a catalog on a genre it doesn't have.
 * Without a usable position, the current source and catalog stay (else the first).
 */
export function positionIn(sources: readonly PageSource[], at: Position | null | undefined, current?: { source: PageSource; catalog: ManifestCatalog | undefined }): GridView | null {
  const named = at?.addonKey === undefined ? undefined : sources.find((s) => s.key === at.addonKey);
  const source = named ?? sources.find((s) => s.key === current?.source.key) ?? sources[0];
  if (!source) return null;
  const { catalogs } = source;
  const asked = named || at?.addonKey === undefined ? catalogs.find((c) => c.id === at?.catalogId) : undefined;
  const kept = current && current.source.key === source.key ? catalogs.find((c) => c.type === current.catalog?.type && c.id === current.catalog?.id) : undefined;
  const catalog = asked ?? kept ?? catalogs[0];
  const offered = at?.genre !== undefined && !!catalog?.extra.find((e) => e.name === 'genre')?.options?.includes(at.genre);
  return { source, catalog, genre: offered ? at?.genre : undefined };
}

/**
 * Whether the grid still shows the same thing after an addon change: the
 * same source (and genre lock), the same catalog definition and the same
 * genre. Sources are rebuilt from fresh manifests, so catalogs compare by value.
 */
export function sameGridView(before: GridView, after: GridView): boolean {
  return (
    before.source.key === after.source.key &&
    before.source.genre === after.source.genre &&
    before.genre === after.genre &&
    JSON.stringify(before.catalog) === JSON.stringify(after.catalog)
  );
}

type Media = 'tv' | 'movie';

interface AnimeTab {
  id: string;
  media: Media;
  label: MessageKey;
  sort: string;
  /** Dates are ISO days; `today` is the person's own. */
  filters(today: string): Record<string, string | number>;
}

const daysFrom = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** TMDB's anime catalogs: shows first, then films. */
const ANIME_TABS: readonly AnimeTab[] = [
  { id: 'anime-tv-popular', media: 'tv', label: 'browse.discover.anime-popular', sort: 'popularity.desc', filters: () => ({}) },
  // An episode out this week.
  { id: 'anime-tv-airing', media: 'tv', label: 'browse.discover.anime-airing', sort: 'popularity.desc', filters: (today) => ({ airDateGte: today, airDateLte: daysFrom(today, 7) }) },
  // A few votes keep a single 10/10 from topping the list.
  { id: 'anime-tv-top', media: 'tv', label: 'browse.discover.anime-top', sort: 'vote_average.desc', filters: () => ({ voteCountGte: 150 }) },
  // Started in the last three months, the most watched first.
  { id: 'anime-tv-new', media: 'tv', label: 'browse.discover.anime-new', sort: 'popularity.desc', filters: (today) => ({ releaseDateGte: daysFrom(today, -90), releaseDateLte: today }) },
  { id: 'anime-movie-popular', media: 'movie', label: 'browse.discover.anime-popular', sort: 'popularity.desc', filters: () => ({}) },
  { id: 'anime-movie-top', media: 'movie', label: 'browse.discover.anime-top', sort: 'vote_average.desc', filters: () => ({ voteCountGte: 150 }) },
  // Fewer anime films come out: the last year's.
  { id: 'anime-movie-new', media: 'movie', label: 'browse.discover.anime-new', sort: 'popularity.desc', filters: (today) => ({ releaseDateGte: daysFrom(today, -365), releaseDateLte: today }) },
];

/** Genres to filter TMDB's anime by, as their names and TMDB ids (shows and films have their own). */
function animeGenres(media: Media): { name: string; id: number }[] {
  return GENRES.flatMap((genre) => {
    const id = genre[media];
    return id === null || genre.key === 'animation' || genre.key === 'documentary' ? [] : [{ name: t(GENRE_LABELS[genre.key]), id }];
  });
}

/** TMDB's anime as a source whose catalogs look like an addon's (a genre extra to pick from). */
export function tmdbAnimeSource(): PageSource {
  return {
    key: TMDB_ANIME,
    name: 'TMDB',
    catalogs: ANIME_TABS.map((tab) => ({
      type: tab.media === 'tv' ? 'series' : 'movie',
      id: tab.id,
      name: t(tab.label),
      extra: [{ name: 'genre', isRequired: false, options: animeGenres(tab.media).map((g) => g.name), optionsLimit: 1 }],
    })),
  };
}

/** The TMDB discover query behind one of `tmdbAnimeSource`'s catalogs, in `genre` (a name it offered) when given. */
export function animeRequest(catalogId: string, genre: string | undefined, today: string): TmdbSourceRequest | null {
  const tab = ANIME_TABS.find((t) => t.id === catalogId);
  if (!tab) return null;
  const extra = genre === undefined ? undefined : animeGenres(tab.media).find((g) => g.name === genre)?.id;
  if (genre !== undefined && extra === undefined) return null;
  // "16,X" asks for both: anime that is also X.
  const withGenres = extra === undefined ? String(ANIMATION) : `${ANIMATION},${extra}`;
  return { kind: 'discover', media: tab.media, sort: tab.sort, filters: { withGenres, withKeywords: String(ANIME_KEYWORD), withoutKeywords: EXPLICIT_KEYWORDS, ...tab.filters(today) } };
}
