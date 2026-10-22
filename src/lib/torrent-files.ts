/**
 * A torrent's files, as the file picker shows them (season packs: one torrent,
 * many episodes). Rust reads the file list and the episode numbers in the
 * names (src-tauri/src/episode_files.rs); this arranges the list, says which
 * episode a file is, and builds the magnet that plays one file.
 *
 * File names come from the torrent and are untrusted: they're capped here
 * and only ever shown as text.
 */

/** One file, as `torrent_files` describes it. */
export interface TorrentFile {
  index: number;
  /** Path inside the torrent, "/"-separated. */
  name: string;
  size: number;
  video: boolean;
  /** A sample, trailer or other extra. */
  extra: boolean;
  season?: number | undefined;
  episode?: number | undefined;
  /** A double episode's last number. */
  lastEpisode?: number | undefined;
}

export interface TorrentFiles {
  files: TorrentFile[];
  /** The file that plays automatically. */
  chosen?: number | undefined;
  /** The file playing now. */
  playing?: number | undefined;
}

/** The episode a torrent is opened for; `absolute` counts across seasons (for anime packs). */
export interface EpisodeHint {
  season: number;
  episode: number;
  absolute?: number;
}

interface SeasonsLike {
  seasons?: readonly { number: number; episodes: readonly { number: number }[] }[] | undefined;
}

const MAX_NAME = 300;
const MAX_FILES = 5000;

/** Seasons in order, specials (season 0) left out: how packs count episodes across seasons. */
const counted = (title: SeasonsLike) => [...(title.seasons ?? [])].filter((s) => s.number > 0).sort((a, b) => a.number - b.number);

/** The hint for an episode, with its number counted from the first season when the seasons are known. */
export function episodeHint(title: SeasonsLike, episode: { season: number; episode: { number: number } } | undefined): EpisodeHint | undefined {
  if (!episode) return undefined;
  const hint: EpisodeHint = { season: episode.season, episode: episode.episode.number };
  const seasons = counted(title);
  const at = seasons.findIndex((s) => s.number === episode.season);
  if (episode.season > 0 && at >= 0 && seasons[at]!.episodes.some((e) => e.number === episode.episode.number)) {
    hint.absolute = seasons.slice(0, at).reduce((sum, s) => sum + s.episodes.length, 0) + episode.episode.number;
  }
  return hint;
}

const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined);

/** Checks `torrent_files`' answer; anything malformed is left out. */
export function parseTorrentFiles(raw: unknown): TorrentFiles {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(data.files) ? data.files.slice(0, MAX_FILES) : [];
  const files: TorrentFile[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const f = item as Record<string, unknown>;
    const index = count(f.index);
    const size = count(f.size);
    if (index === undefined || size === undefined || typeof f.name !== 'string') continue;
    files.push({ index, name: f.name.slice(0, MAX_NAME), size, video: f.video === true, extra: f.extra === true, season: count(f.season), episode: count(f.episode), lastEpisode: count(f.lastEpisode) });
  }
  return { files, chosen: count(data.chosen), playing: count(data.playing) };
}

/** The 40-character info hash of a magnet link (as the stream schema builds them), else undefined. */
export function infoHashOf(url: string): string | undefined {
  return /^magnet:\?xt=urn:btih:([0-9a-f]{40})(?:&|$)/.exec(url)?.[1];
}

/** The magnet with `index` as the file to play (replacing any the addon gave). */
export function withFile(magnet: string, index: number): string {
  const [head = '', ...params] = magnet.split('&');
  return [head, `so=${index}`, ...params.filter((p) => !p.startsWith('so='))].join('&');
}

/** The file's name without its folders. */
export const baseName = (name: string) => name.slice(name.lastIndexOf('/') + 1);
/** The folders the file is in, or ''. */
export const folderOf = (name: string) => name.slice(0, Math.max(0, name.lastIndexOf('/')));

export type FileSort = 'episode' | 'name' | 'size';

/** What's shown at first: video files that aren't samples or extras. */
export const isMain = (file: TorrentFile) => file.video && !file.extra;

const collator = () => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The files to list: main ones unless `all`, matching `query`, in `sort` order. */
export function arrangeFiles(files: readonly TorrentFile[], options: { query: string; sort: FileSort; all: boolean }): TorrentFile[] {
  const query = options.query.trim().toLocaleLowerCase();
  const shown = files.filter((f) => (options.all || isMain(f)) && (!query || f.name.toLocaleLowerCase().includes(query)));
  const names = collator();
  const byName = (a: TorrentFile, b: TorrentFile) => names.compare(a.name, b.name);
  if (options.sort === 'size') return shown.sort((a, b) => b.size - a.size || byName(a, b));
  if (options.sort === 'name') return shown.sort(byName);
  // Episode order: numbered files by season (specials last) and episode, then the rest by name.
  const season = (f: TorrentFile) => (f.season === 0 ? Number.MAX_SAFE_INTEGER : (f.season ?? 0));
  return shown.sort((a, b) => {
    if ((a.episode === undefined) !== (b.episode === undefined)) return a.episode === undefined ? 1 : -1;
    return season(a) - season(b) || (a.episode ?? 0) - (b.episode ?? 0) || byName(a, b);
  });
}

/** Episode order when names carry episode numbers, else by name. */
export const defaultSort = (files: readonly TorrentFile[]): FileSort => (files.some((f) => isMain(f) && f.episode !== undefined) ? 'episode' : 'name');

/** Whether a file's name says it's the hinted episode (read as the automatic choice reads it). */
export function matchesHint(file: Pick<TorrentFile, 'season' | 'episode' | 'lastEpisode'>, hint: EpisodeHint | undefined): boolean {
  if (!hint || file.episode === undefined) return false;
  const first = file.episode;
  const covers = (n: number | undefined) => n !== undefined && n >= first && n <= (file.lastEpisode ?? first);
  if (file.season === undefined) return covers(hint.absolute) || (hint.season === 1 && covers(hint.episode));
  return file.season === hint.season && (covers(hint.episode) || (hint.season > 1 && covers(hint.absolute)));
}

/**
 * The episode of `title` a file holds: by season and episode, or, for a file
 * named without a season, by its number counted from the first season (as
 * the automatic choice reads such packs). Undefined if the title has no such
 * episode.
 */
export function episodeOfFile<E extends { number: number }>(title: { seasons?: readonly { number: number; episodes: readonly E[] }[] | undefined }, file: Pick<TorrentFile, 'season' | 'episode'>): { season: number; episode: E } | undefined {
  if (file.episode === undefined) return undefined;
  if (file.season !== undefined) {
    const episode = title.seasons?.find((s) => s.number === file.season)?.episodes.find((e) => e.number === file.episode);
    return episode ? { season: file.season, episode } : undefined;
  }
  let left = file.episode;
  for (const s of counted(title)) {
    const sorted = [...s.episodes].sort((a, b) => a.number - b.number);
    if (left <= sorted.length) {
      const episode = sorted[left - 1];
      return episode ? { season: s.number, episode: episode as E } : undefined;
    }
    left -= sorted.length;
  }
  return undefined;
}
