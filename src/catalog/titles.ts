/**
 * The UI's view of a title, built from addon metas. Addon data has already
 * been validated by addons/schema; this layer only reshapes it.
 */
import { formatList, locale, t, type MessageKey } from '../i18n';
import { isAirDate, releasedAt } from '../lib/air-date';
import { runtimeMinutes } from './runtime';
import type { AddonOrigin, ManifestCatalog, MetaDetail, MetaPreview, UsableAddon, Video } from '../addons/types';

export interface Episode {
  id: string;
  number: number;
  title: string;
  overview?: string | undefined;
  thumbnail?: string | undefined;
  /** ISO date, when known. */
  released?: string | undefined;
  /** "Airs Nov 4" for episodes that haven't aired yet. */
  airs?: string | undefined;
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export interface Title {
  id: string;
  type: string;
  name: string;
  poster?: string | undefined;
  background?: string | undefined;
  logo?: string | undefined;
  description?: string | undefined;
  /** Release year or range, e.g. "2011–2019". */
  year?: string | undefined;
  runtime?: string | undefined;
  genres: string[];
  rating?: string | undefined;
  // Detail-only fields (absent on catalog previews).
  director?: string[] | undefined;
  writer?: string[] | undefined;
  cast?: string[] | undefined;
  country?: string | undefined;
  awards?: string | undefined;
  status?: string | undefined;
  released?: string | undefined;
  seasons?: Season[] | undefined;
  /** YouTube ids of its trailers, best first. */
  trailers?: string[] | undefined;
  /** The video id streams are asked for when it isn't the title's own (the meta's `behaviorHints.defaultVideoId`). */
  defaultVideoId?: string | undefined;
  /** Addons that supplied this title, in the user's addon order. */
  origins: AddonOrigin[];
}

/** How long after its release a title counts as new. */
const NEW_FOR_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Released within the last 30 days. Only a known full date counts (a year
 * alone says too little), and a future date isn't out yet.
 */
export function isNewRelease(title: Pick<Title, 'released'>, now = Date.now()): boolean {
  const released = title.released?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!released) return false;
  const at = releasedAt(released);
  return Number.isFinite(at) && at <= now && now - at <= NEW_FOR_MS;
}

/**
 * Not out yet: the release date (ms, UTC midnight) when a full one is known
 * and still ahead, 'soon' when only the year is and it's a later one, null
 * when it's out (or nothing says it isn't). A show counts by its first air date.
 */
export function upcomingRelease(title: Pick<Title, 'released' | 'year'>, now = Date.now()): number | 'soon' | null {
  const released = title.released?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (released) {
    // Out from the start of its day locally (lib/air-date.ts); the date itself is given as UTC midnight, for display.
    const at = Date.parse(`${released}T00:00:00Z`);
    return Number.isFinite(at) && releasedAt(released) > now ? at : null;
  }
  const year = /^(\d{4})$/.exec(title.year?.trim() ?? '')?.[1];
  return year && Number(year) > new Date(now).getUTCFullYear() ? 'soon' : null;
}

/** Addons write ranges with a hyphen, and a running show as "2026-"; shown as "2008–2013" and "2026–present". */
export function displayYear(year: string | undefined): string | undefined {
  const range = year?.trim().match(/^(\d{4})\s*[-–]\s*(\d{4})?$/);
  if (!range) return year;
  return range[2] ? `${range[1]}–${range[2]}` : t('browse.titles.running', { from: range[1]! });
}

/**
 * The words of a "2010 · 15 min · Animation, Fantasy" line: year, runtime
 * and up to three genres (none with `genres: false`). Blank values from an
 * addon are left out, so the separators between them never dangle.
 */
export function metaValues(title: Title, options: { genres?: boolean } = {}): string[] {
  return [title.year, title.runtime, options.genres === false ? '' : genreLine(title)].map((value) => value?.trim() ?? '').filter(Boolean);
}

/** Up to three of a title's genres, "Animation, Fantasy"; empty if it lists none. */
export const genreLine = (title: Title): string =>
  formatList(
    title.genres
      .map((g) => g.trim())
      .filter(Boolean)
      .slice(0, 3),
  );

/** A runtime in the interface's words ("111 min"); the addon's own text when it can't be read. */
export function runtimeLabel(runtime: string | undefined): string | undefined {
  const minutes = runtimeMinutes(runtime);
  return minutes ? t('titles.detail.runtime-minutes', { minutes }) : runtime;
}

export function fromPreview(meta: MetaPreview, origins: AddonOrigin[]): Title {
  return {
    id: meta.id,
    type: meta.type,
    name: meta.name,
    poster: meta.poster,
    background: meta.background,
    logo: meta.logo,
    description: meta.description,
    year: displayYear(meta.releaseInfo),
    runtime: meta.runtime,
    genres: meta.genres ?? [],
    rating: meta.imdbRating,
    origins,
  };
}

export function fromDetail(meta: MetaDetail, origins: AddonOrigin[], now = new Date()): Title {
  return {
    ...fromPreview(meta, origins),
    director: meta.director,
    writer: meta.writer,
    cast: meta.cast,
    country: meta.country,
    awards: meta.awards,
    status: meta.status,
    released: meta.released,
    seasons: meta.type === 'series' || meta.videos?.some((v) => v.season !== undefined) ? seasonsFrom(meta.videos ?? [], now) : undefined,
    trailers: trailerIds(meta),
    defaultVideoId: meta.behaviorHints?.defaultVideoId,
  };
}

/** Trailers before teasers and clips, without repeats. */
function trailerIds(meta: MetaDetail): string[] | undefined {
  const listed = meta.trailers ?? [];
  const ids = new Set([...listed.filter((t) => !t.type || t.type === 'Trailer').map((t) => t.source), ...(meta.trailerStreams ?? []).map((t) => t.ytId), ...listed.map((t) => t.source)]);
  return ids.size ? [...ids] : undefined;
}

// Air dates are calendar dates stored as UTC midnight; formatting them in local
// time would show the previous day west of UTC. A real air time is a moment,
// shown as the local day it airs on (01:00 UTC on the 21st is the 20th in New York).
const airDate = new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', timeZone: 'UTC' });
const airDay = (released: string | undefined, date: Date) => (isAirDate(released) ? airDate : new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric' })).format(date);

/** Video fields as addons send them; all but the id may be missing. */
export type VideoLike = Pick<Video, 'id'> & Partial<Video>;

/**
 * Groups videos into seasons. Season 0 (specials) goes last, videos without
 * an episode number are skipped, and future episodes get an "Airs …" label.
 */
export function seasonsFrom(videos: readonly VideoLike[], now = new Date()): Season[] {
  const bySeason = new Map<number, Episode[]>();
  for (const video of distinctVideos(videos)) {
    const season = video.season;
    const date = video.released ? new Date(video.released) : undefined;
    const future = date && !Number.isNaN(date.getTime()) && releasedAt(video.released) > now.getTime();
    const episode: Episode = {
      id: video.id,
      number: video.episode,
      title: video.title || t('browse.titles.episode', { number: video.episode }),
      overview: video.overview,
      thumbnail: video.thumbnail,
      released: video.released,
      airs: future ? t('browse.titles.airs', { date: airDay(video.released, date) }) : undefined,
    };
    bySeason.set(season, [...(bySeason.get(season) ?? []), episode]);
  }
  return [...bySeason.entries()]
    .sort(([a], [b]) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
    .map(([number, episodes]) => ({ number, episodes: episodes.sort((x, y) => x.number - y.number || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)) }));
}

/** How much an addon says about a video. */
const richness = (v: VideoLike) => [v.title, v.overview, v.thumbnail, v.released].filter(Boolean).length;

/** Two listings of one episode: the same video, or one without a name or both with the same name. Different names (two parts) are different videos. */
const sameVideo = (a: VideoLike, b: VideoLike) => a.id === b.id || !a.title || !b.title || a.title.trim().toLowerCase() === b.title.trim().toLowerCase();

/** The richer listing (on a tie, the lower id, so the order they came in doesn't matter), with what the other adds. */
function mergeVideos(a: VideoLike, b: VideoLike): VideoLike {
  const [rich, poor] = richness(b) > richness(a) || (richness(b) === richness(a) && b.id < a.id) ? [b, a] : [a, b];
  return { ...rich, title: rich.title || poor.title, overview: rich.overview || poor.overview, thumbnail: rich.thumbnail || poor.thumbnail, released: rich.released || poor.released };
}

/**
 * Videos with an episode number, an episode an addon lists more than once
 * merged into one (see `sameVideo`), with their season (1 when missing).
 */
function distinctVideos(videos: readonly VideoLike[]): (VideoLike & { season: number; episode: number })[] {
  const byNumber = new Map<string, (VideoLike & { season: number; episode: number })[]>();
  for (const video of videos) {
    if (video.episode === undefined) continue;
    const entry = { ...video, season: video.season ?? 1, episode: video.episode };
    const key = `${entry.season}:${entry.episode}`;
    const listed = byNumber.get(key) ?? [];
    const same = listed.findIndex((other) => sameVideo(other, entry));
    if (same < 0) listed.push(entry);
    else listed[same] = { ...mergeVideos(listed[same]!, entry), season: entry.season, episode: entry.episode };
    byNumber.set(key, listed);
  }
  return [...byNumber.values()].flat();
}

const TYPE_LABELS: Record<string, MessageKey> = { movie: 'browse.titles.rail-movies', series: 'browse.titles.rail-series' };

/**
 * "Popular" becomes "Popular Movies"; descriptive names ("Open Films") and
 * other addon types keep the catalog's own name.
 */
export function railTitle(catalog: ManifestCatalog): string {
  const name = catalog.name ?? catalog.id;
  const type = TYPE_LABELS[catalog.type];
  return type && !/\s/.test(name.trim()) ? t(type, { name }) : name;
}

export interface CatalogRef {
  addon: UsableAddon;
  catalog: ManifestCatalog;
  /** Extra arguments needed to request it (e.g. Cinemeta's "New" needs a year). */
  extra: [string, string][];
}

/**
 * Catalogs that can be shown as a rail without user input. A required
 * `genre` extra with options (Cinemeta's "New" is keyed by year) gets its
 * first option; any other required extra (search, video ids) rules it out.
 */
export function browsableCatalogs(addons: readonly UsableAddon[]): CatalogRef[] {
  const refs: CatalogRef[] = [];
  for (const addon of addons) {
    for (const catalog of addon.manifest.catalogs) {
      const extra: [string, string][] = [];
      let browsable = true;
      for (const e of catalog.extra.filter((x) => x.isRequired)) {
        const first = e.options?.[0];
        if (e.name === 'genre' && first) extra.push(['genre', first]);
        else browsable = false;
      }
      if (browsable) refs.push({ addon, catalog, extra });
    }
  }
  return refs;
}

/** A stable hue for a title before (or without) sampling its artwork. */
export function fallbackHue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/**
 * Whether titles of `type` count as TV shows: series, and the "anime" that
 * anime addons (Kitsu, MyAnimeList) type theirs, wherever Orbit sorts titles
 * into Movies and TV Shows (Search, My Library, Pick for me, Shuffle).
 */
export const isShowType = (type: string): boolean => type === 'series' || type === 'anime';

/** Movies or TV Shows, for a title of `type` (see `isShowType`); anything else (a channel, a TV type) is neither. */
export const showKind = (type: string): 'movie' | 'series' | null => (type === 'movie' ? 'movie' : isShowType(type) ? 'series' : null);

/**
 * Whether a title is played by episode: a series, or a title of another type
 * an addon lists episodes for (an "anime" with seasons), as stremio-core plays
 * any meta with videos episode by episode.
 */
export const episodic = (title: Pick<Title, 'type' | 'seasons'>): boolean => title.type === 'series' || !!title.seasons?.some((s) => s.episodes.length);

/**
 * Episodes in season order, without specials (season 0), and where `season`/`number` sits among them.
 * `id` places it exactly: two parts an addon lists under one number (see `sameVideo`) share it.
 */
function episodeOrder(title: Title, season: number, number: number, id?: string) {
  const order = (title.seasons ?? [])
    .filter((s) => s.number !== 0)
    .flatMap((s) => s.episodes.map((episode) => ({ season: s.number, episode })));
  const byId = id === undefined ? -1 : order.findIndex((ref) => ref.season === season && ref.episode.id === id);
  return { order, index: byId >= 0 ? byId : order.findIndex((ref) => ref.season === season && ref.episode.number === number) };
}

/**
 * The episode that follows `season`/`number`: the next aired episode in
 * season order, not counting specials (season 0). Undefined at the end.
 * Pass the playing episode's `id` so the second of two parts sharing a number goes on past it.
 */
export function episodeAfter(title: Title, season: number, number: number, id?: string): { season: number; episode: Episode } | undefined {
  const { order, index } = episodeOrder(title, season, number, id);
  if (index < 0) return undefined;
  return order.slice(index + 1).find((ref) => !ref.episode.airs);
}

/** The episode before `season`/`number` in the same order; undefined at the first. */
export function episodeBefore(title: Title, season: number, number: number, id?: string): { season: number; episode: Episode } | undefined {
  const { order, index } = episodeOrder(title, season, number, id);
  return index > 0 ? order[index - 1] : undefined;
}
