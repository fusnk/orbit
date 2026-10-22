/**
 * Video files played from this PC (dropped onto the window). Rust checks
 * every path and derives each file's id (`local:` and a hash of its path,
 * see src-tauri/src/local.rs); this side only sorts drops and names titles.
 *
 * Local ids aren't titles any addon, Stremio or TMDB knows, so whatever
 * shares watch history with them (sync, genre lookups, Stats, Continue
 * Watching) checks `isLocalId` and leaves them out. Files from the person's
 * debrid cloud that aren't matched to a catalog title (`cloud:…`, see
 * library/cloud.ts) are kept the same way.
 */

export const LOCAL_ID_PREFIX = 'local:';
export const CLOUD_ID_PREFIX = 'cloud:';

/** Extensions Rust accepts, kept in step with src-tauri/src/local.rs. */
const VIDEO_EXTENSIONS = new Set(['mkv', 'mp4', 'm4v', 'avi', 'mov', 'webm', 'ts', 'm2ts', 'wmv', 'flv', 'ogv']);
const SUBTITLE_EXTENSIONS = new Set(['srt', 'ass', 'ssa', 'vtt', 'sub']);

/** Whether `id` names a file (on this PC, or untitled in the cloud) rather than a real title. */
export function isLocalId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX) || id.startsWith(CLOUD_ID_PREFIX);
}

/** What a dropped file is, by its extension. */
export function dropKind(path: string): 'video' | 'subtitle' | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  if (!ext) return null;
  return VIDEO_EXTENSIONS.has(ext) ? 'video' : SUBTITLE_EXTENSIONS.has(ext) ? 'subtitle' : null;
}

/** The file name at the end of a Windows or POSIX path. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Release tags that end a title in a file name. */
const TAGS = /^(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr|hdr10|dv|bluray|blu-ray|bdrip|brrip|web-?dl|webrip|web|hdtv|dvdrip|remux|x264|x265|h264|h265|hevc|avc|aac|ac3|dts|proper|repack|extended|unrated)$/i;

/**
 * A title from a file name (without its extension): dots and underscores to
 * spaces, release tags and bracketed notes dropped, a year split off.
 * "The.Matrix.1999.1080p.BluRay.x264" is "The Matrix", 1999.
 */
export function titleFromFileName(stem: string): { name: string; year?: string } {
  const words = stem
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const bare = (word: string) => word.replace(/^\(|\)$/g, '');
  // The name ends at the first release tag, or just after an episode code (it's what tells a show's files apart).
  let end = words.findIndex((word, i) => i > 0 && TAGS.test(word));
  if (end < 0) end = words.length;
  const episode = words.findIndex((word) => /^s\d{1,2}e\d{1,3}$/i.test(word));
  if (episode >= 0 && episode < end) end = episode + 1;
  // The year is the last one before that ("Blade Runner 2049 2017"), never the first word ("1917").
  let yearAt = -1;
  for (let i = 1; i < end; i++) if (/^(19|20)\d{2}$/.test(bare(words[i]!))) yearAt = i;
  // With an episode code, the year only comes out ("Doctor Who 2005 S01E01"): the code stays in the name.
  const kept = words
    .slice(0, yearAt > 0 && !(episode >= 0 && episode < end) ? yearAt : end)
    .map((word, i) => (i === episode ? word.toUpperCase() : word))
    .filter((_, i) => i !== yearAt);
  const name = kept.join(' ').replace(/\s*[-–]\s*$/, '').trim();
  const year = yearAt > 0 ? bare(words[yearAt]!) : undefined;
  return { name: name || stem.trim() || stem, ...(year ? { year } : {}) };
}
