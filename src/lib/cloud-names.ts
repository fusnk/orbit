/**
 * My cloud's names, apart from the network: reading a title, year and
 * episode out of a torrent or file name, deciding when a cloud item is
 * confidently a catalog title, picking the files that play a movie or
 * episode, and arranging the merged list for the page.
 *
 * Names come from the person's debrid account (and before that from
 * torrents): untrusted text, only ever compared and shown as text.
 */
import { titleFromFileName } from './local-media';
import { isMain, matchesHint, type EpisodeHint, type TorrentFile } from './torrent-files';

export type CloudProvider = 'realdebrid' | 'torbox';
export type CloudState = 'ready' | 'downloading' | 'queued' | 'error';

/** One torrent or download in an account, as Rust sends it. */
export interface CloudItem {
  provider: CloudProvider;
  id: string;
  name: string;
  size: number;
  state: CloudState;
  /** 0–100. */
  progress: number;
  /** When it was added (ms), if the provider says. */
  added: number | null;
  deletable: boolean;
}

/** A file in an item: a torrent file's shape, and the address that plays it when it can play. */
export interface CloudFile extends TorrentFile {
  address?: string | undefined;
}

/** What a name says: the title, its year, and for a show the season (and episode) it holds. */
export interface CloudName {
  name: string;
  year?: string | undefined;
  season?: number | undefined;
  episode?: number | undefined;
  /** A whole season or show rather than one episode. */
  pack: boolean;
}

const VIDEO_EXTENSION = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv|mpg|mpeg)$/i;
const EPISODE = /^s(\d{1,2})[ .]?e(\d{1,3})(?:-?e?\d{1,3})*$/i;
const CROSS = /^(\d{1,2})x(\d{2,3})$/;
const SEASON = /^s(\d{1,2})(?:-s?\d{1,2})?$/i;
const SEASON_WORD = /^(season|saison|staffel|temporada|stagione|seizoen|sezon)$/i;
const COMPLETE = /^(complete|integral|integrale)$/i;

/**
 * "Show.Name.S02E03.1080p.WEB" is Show Name, season 2, episode 3;
 * "Show Name (2019) Season 1" a season pack; "Movie.Title.2024.2160p" a
 * movie of 2024. The name ends where the episode code, season or release
 * tags begin (see `titleFromFileName`).
 */
export function parseCloudName(raw: string): CloudName {
  const stem = raw.trim().replace(VIDEO_EXTENSION, '');
  const words = stem
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!.replace(/^\(|\)$/g, '');
    const head = () => titleFromFileName(words.slice(0, i).join(' '));
    const episode = EPISODE.exec(word) ?? CROSS.exec(word);
    if (episode) return { ...head(), season: Number(episode[1]), episode: Number(episode[2]), pack: false };
    const season = SEASON.exec(word);
    if (season) return { ...head(), season: Number(season[1]), pack: true };
    if (SEASON_WORD.test(word) && /^\d{1,2}$/.test(words[i + 1] ?? '')) return { ...head(), season: Number(words[i + 1]), pack: true };
    if (COMPLETE.test(word)) return { ...head(), pack: true };
  }
  return { ...titleFromFileName(stem), pack: false };
}

/** Lowercase, without accents, punctuation or a leading "the", for comparing names. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the /, '');
}

/** The first and last year in a title's year ("2011–2019", "2026-", "1999"). */
function yearsOf(year: string | undefined): [number, number] | undefined {
  const all = (year ?? '').match(/\d{4}/g)?.map(Number);
  if (!all?.length) return undefined;
  return [all[0]!, all.length > 1 ? all[all.length - 1]! : /[-–]\s*$/.test(year ?? '') ? 9999 : all[0]!];
}

/** Whether a name is a show's (a season, an episode, or a whole series). */
export const isShowName = (parsed: CloudName): boolean => parsed.season !== undefined || parsed.episode !== undefined || parsed.pack;

/** Whether a cloud name is the title: a movie or a show alike, the same name, and a year that fits. */
export function sameTitle(parsed: CloudName, title: { name: string; type: string; year?: string | undefined }): boolean {
  const show = isShowName(parsed);
  if ((title.type === 'series') !== show || !(title.type === 'series' || title.type === 'movie')) return false;
  if (!parsed.name || normalizeName(parsed.name) !== normalizeName(title.name)) return false;
  const years = yearsOf(title.year);
  if (!parsed.year || !years) return true;
  const year = Number(parsed.year);
  // A film's year can be a festival year off its release; a show's is any year it ran.
  return show ? year >= years[0] - 1 && year <= years[1] : Math.abs(year - years[0]) <= 1;
}

/**
 * The catalog title a cloud name confidently is, from search results: the
 * same name and kind (and year, when both say). With no year in the name,
 * only when exactly one result has that name, so a remake isn't guessed.
 */
export function pickMatch<T extends { name: string; type: string; year?: string | undefined }>(results: readonly T[], parsed: CloudName): T | undefined {
  const same = results.filter((r) => sameTitle(parsed, r));
  if (parsed.year) return same[0];
  return same.length === 1 ? same[0] : undefined;
}

/**
 * The files of an item that play `title` (a movie: its main video, largest
 * first; an episode: files named for it). A single-episode item whose files
 * carry no number counts by the item's own name.
 */
export function pickFiles(files: readonly CloudFile[], itemName: string, type: string, hint?: EpisodeHint): CloudFile[] {
  const playable = files.filter((f) => f.address && isMain(f));
  if (type === 'movie') return [...playable].sort((a, b) => b.size - a.size).slice(0, 1);
  if (!hint) return [];
  const named = playable.filter((f) => matchesHint(f, hint));
  if (named.length) return named;
  const item = parseCloudName(itemName);
  if (item.episode === undefined || item.season !== hint.season || item.episode !== hint.episode) return [];
  return playable.filter((f) => f.episode === undefined).sort((a, b) => b.size - a.size).slice(0, 1);
}

/** Items that may hold the title: ready, the same name and kind. */
export function matchingItems(items: readonly CloudItem[], title: { name: string; type: string; year?: string | undefined }, season?: number): CloudItem[] {
  return items.filter((item) => {
    if (item.state !== 'ready') return false;
    const parsed = parseCloudName(item.name);
    // A pack of another season can't hold this episode ("Complete" packs say no season).
    return sameTitle(parsed, title) && (season === undefined || parsed.season === undefined || parsed.season === season);
  });
}

export type CloudFilter = 'all' | 'ready' | 'active' | 'error';
export type CloudSort = 'added' | 'name' | 'size';

/** The list as the page shows it: one provider or all, a status, a name search, in `sort` order. */
export function arrangeCloud(items: readonly CloudItem[], options: { query: string; provider: CloudProvider | null; filter: CloudFilter; sort: CloudSort }): CloudItem[] {
  const query = normalizeName(options.query);
  const fits = (item: CloudItem) =>
    (options.provider === null || item.provider === options.provider) &&
    (options.filter === 'all' || (options.filter === 'ready' ? item.state === 'ready' : options.filter === 'error' ? item.state === 'error' : item.state === 'downloading' || item.state === 'queued')) &&
    (!query || normalizeName(item.name).includes(query));
  const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sorts: Record<CloudSort, (a: CloudItem, b: CloudItem) => number> = {
    added: (a, b) => (b.added ?? -Infinity) - (a.added ?? -Infinity) || names.compare(a.name, b.name),
    name: (a, b) => names.compare(a.name, b.name),
    size: (a, b) => b.size - a.size || names.compare(a.name, b.name),
  };
  return items.filter(fits).sort(sorts[options.sort]);
}

/** How many items each provider has, for the provider filter. */
export function countByProvider(items: readonly CloudItem[]): Map<CloudProvider, number> {
  const counts = new Map<CloudProvider, number>();
  for (const item of items) counts.set(item.provider, (counts.get(item.provider) ?? 0) + 1);
  return counts;
}

/** The name an untitled cloud file plays under: the title, and its episode code if it has one. */
export function displayName(parsed: CloudName): string {
  if (parsed.season === undefined || parsed.episode === undefined) return parsed.name;
  return `${parsed.name} S${String(parsed.season).padStart(2, '0')}E${String(parsed.episode).padStart(2, '0')}`;
}
