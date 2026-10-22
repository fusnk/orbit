/**
 * How well a subtitle fits the file playing, from their release names
 * ("Movie.2019.1080p.BluRay.x264-GROUP"): the same title, year, episode,
 * source, release group, resolution and frame rate. The source and group
 * matter most after the title: they decide the cut (and so the timing), so
 * a BluRay subtitle drifts on a WEB-DL. Used to pick the automatic subtitle
 * and to mark the best one in the list.
 */

/** Where a release comes from; WEB-DL and WEBRip are usually the same cut. */
export type ReleaseSource = 'bluray' | 'web-dl' | 'webrip' | 'web' | 'hdtv' | 'dvd';

export interface Release {
  /** Title words, lower case. */
  title: string[];
  year?: number;
  season?: number;
  episode?: number;
  source?: ReleaseSource;
  /** Vertical resolution (1080 for 1080p). */
  resolution?: number;
  /** Release group, lower case. */
  group?: string;
  fps?: number;
}

/** Names longer than this are cut (they're labels, not documents). */
const MAX_NAME = 300;
const EXTENSION = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|webm|srt|sub|ass|ssa|vtt|txt|zip|gz)$/i;
/** Trailing language and kind tags on subtitle names ("….GROUP.eng.forced"). */
const TRAILING_TAG = /[._ ](?:[a-z]{2,3}(?:-[a-z]{2})?|english|forced|sdh|hi|cc|full)$/i;
/** Words that end release names but aren't groups ("….WEB-DL", "….DTS-HD"). */
const NOT_GROUPS = new Set(['dl', 'rip', 'hd', 'ma', 'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'aac', 'ac3', 'dts', 'web', 'hdr', 'sdr', 'dv', 'remux', 'proper', 'repack', 'internal']);
/** Words that mean the title is over. */
const MARKERS = /^(2160p|1080p|1080i|720p|576p|480p|4k|uhd|bluray|blu|bdrip|brrip|bdremux|remux|web|webdl|webrip|hdtv|pdtv|dvdrip|dvd|hdrip|x264|x265|h264|h265|hevc|proper|repack|extended|unrated|remastered|directors|complete|multi)$/;

/** A file or subtitle name as shown: `+` and `%20` from web addresses decoded, folders and extension dropped. */
export function releaseName(raw: string): string {
  let name = raw.slice(0, MAX_NAME * 3).replace(/\+/g, ' ');
  try {
    name = decodeURIComponent(name);
  } catch {
    // Not encoded (or a stray %): used as it is.
  }
  name = name.split(/[/\\]/).pop() ?? '';
  return name.replace(/[?#].*$/, '').replace(EXTENSION, '').slice(0, MAX_NAME).trim();
}

const SOURCES: [RegExp, ReleaseSource][] = [
  [/\b(blu-?ray|bdrip|brrip|bdremux|bd25|bd50|bdmv|remux)\b/, 'bluray'],
  [/\bweb-?dl\b/, 'web-dl'],
  [/\bweb-?rip\b/, 'webrip'],
  [/\b(hdtv|pdtv|dsr|tvrip)\b/, 'hdtv'],
  [/\b(dvd-?rip|dvdr|dvd5|dvd9|dvdscr|dvd)\b/, 'dvd'],
  [/\bweb\b/, 'web'],
];

export function parseRelease(raw: string): Release {
  let name = releaseName(raw);
  const release: Release = { title: [] };
  // Anime-style "[Group] Title - 01 [1080p]".
  const leading = /^\[([^\]]{2,30})\]\s*/.exec(name);
  if (leading) {
    release.group = leading[1]!.trim().toLowerCase();
    name = name.slice(leading[0].length);
  }
  const flat = name.toLowerCase().replace(/[._\s]+/g, ' ');
  const source = SOURCES.find(([pattern]) => pattern.test(flat))?.[1];
  if (source) release.source = source;
  const resolution = /\b(2160|1080|720|576|480)[pi]\b/.exec(flat)?.[1] ?? (/\b(4k|uhd)\b/.test(flat) ? '2160' : undefined);
  if (resolution) release.resolution = Number(resolution);
  const fps = /\b(23[.,]976|23[.,]98|24|25|29[.,]97|30|50|59[.,]94|60) ?fps\b/.exec(flat)?.[1];
  if (fps) release.fps = Number(fps.replace(',', '.'));

  if (!leading) {
    let stem = name.replace(/\s*\[[^\]]*\]$/, '');
    for (let i = 0; i < 3 && TRAILING_TAG.test(stem); i++) stem = stem.replace(TRAILING_TAG, '');
    const group = /-([a-z0-9]{2,20})$/i.exec(stem)?.[1]?.toLowerCase();
    if (group && !NOT_GROUPS.has(group)) release.group = group;
  }

  const tokens = flat.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const se = /^s(\d{1,2})e(\d{1,3})$/.exec(token) ?? /^(\d{1,2})x(\d{1,3})$/.exec(token);
    const split = /^s(\d{1,2})$/.exec(token) && /^e(\d{1,3})$/.exec(tokens[i + 1] ?? '');
    if (se || split) {
      release.season ??= Number(se ? se[1] : token.slice(1));
      release.episode ??= Number(se ? se[2] : tokens[i + 1]!.slice(1));
    }
    // A year anywhere but first ("1917.2019.1080p": the title is 1917).
    const year = i > 0 && /^(19|20)\d\d$/.test(token);
    if (year) release.year = Number(token);
    const ends = year || se || split || MARKERS.test(token) || token === release.group;
    if (ends && i > 0) {
      if (!release.title.length) release.title = tokens.slice(0, i);
    }
  }
  if (!release.title.length) release.title = tokens.filter((t) => !MARKERS.test(t) && t !== release.group);
  return release;
}

const WEB = new Set<ReleaseSource>(['web-dl', 'webrip', 'web']);

/**
 * Points for how well subtitle `sub` fits video `video` (higher is better,
 * 0 when nothing is known). A different episode or year counts against it.
 */
export function releaseScore(video: Release, sub: Release): number {
  let score = 0;
  if (video.title.length && sub.title.length) {
    const words = new Set(sub.title);
    const shared = video.title.filter((w) => words.has(w)).length;
    score += Math.round((60 * shared) / (video.title.length + sub.title.length));
  }
  if (video.source && sub.source) {
    if (video.source === sub.source) score += 25;
    else if (WEB.has(video.source) && WEB.has(sub.source)) score += 15;
    else score -= 10;
  }
  if (video.group && sub.group && video.group === sub.group) score += 20;
  if (video.season !== undefined && sub.season !== undefined) score += video.season === sub.season && video.episode === sub.episode ? 15 : -100;
  if (video.year && sub.year) score += video.year === sub.year ? 5 : -10;
  if (video.resolution && sub.resolution && video.resolution === sub.resolution) score += 5;
  if (video.fps && sub.fps) score += Math.abs(video.fps - sub.fps) < 0.05 ? 10 : -10;
  return score;
}

/** The release playing, from its file name (or address); undefined when the name says nothing about it. */
export function videoRelease(name: string | undefined): Release | undefined {
  if (!name) return undefined;
  const release = parseRelease(name);
  return release.source || release.group || release.resolution || release.year || release.season !== undefined ? release : undefined;
}

/** What an addon tells about one subtitle file (OpenSubtitles gives the name, group and frame rate). */
export interface SubtitleRelease {
  /** The subtitle's file name, or its web address. */
  name: string;
  group?: string | undefined;
  /** Frames per second. */
  fps?: number | undefined;
}

/** The subtitle's release, with what the addon says filling the gaps. */
export function subtitleRelease(sub: SubtitleRelease): Release {
  const release = parseRelease(sub.name);
  if (!release.group && sub.group) release.group = sub.group.toLowerCase().slice(0, 40);
  if (!release.fps && sub.fps && sub.fps > 0) release.fps = sub.fps;
  return release;
}

/** How long a release name shown in the subtitle list may be, in characters. */
export const SHORT_NAME = 48;

/**
 * A subtitle file's release name to show in the list: decoded, without
 * folders, extension or trailing language tags, with dots and underscores as
 * spaces, and cut to `max` characters. Nothing for a web address (it may
 * carry an account key) or a name with nothing left.
 */
export function shortReleaseName(raw: string | undefined, max = SHORT_NAME): string | undefined {
  if (!raw || /:\/\/|^(www\.|magnet:)/i.test(raw.trim())) return undefined;
  let stem = releaseName(raw);
  for (let i = 0; i < 3 && TRAILING_TAG.test(stem); i++) stem = stem.replace(TRAILING_TAG, '');
  const name = stem
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return undefined;
  return [...name].length > max ? `${[...name].slice(0, max - 1).join('').trimEnd()}…` : name;
}

/** From here a subtitle is called the best match in the list (a title alone isn't enough). */
export const BEST_MATCH_SCORE = 40;

/**
 * Index of the item in `items` that fits `video` best (the first on a tie,
 * so the addons' own order decides), or -1 for an empty list.
 */
export function bestMatch<T>(items: readonly T[], video: Release, release: (item: T) => Release): { index: number; score: number } {
  let best = { index: -1, score: -Infinity };
  items.forEach((item, index) => {
    const score = releaseScore(video, release(item));
    if (score > best.score) best = { index, score };
  });
  return best;
}
