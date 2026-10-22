/**
 * Reads ranking traits from a stream's name, description and filename.
 * A deliberately small fallback: the full parser (editions, release groups,
 * anime batches, languages…) is the core/ engine in phase 5. Anything not
 * recognised is left undefined, and the ranking omits that signal.
 */
import { locale } from '../i18n';
import { wordsOf, type Audio, type Codec, type Hdr, type Resolution, type SourceTraits } from './ranking-fallback';

export interface StreamLabels {
  traits: SourceTraits;
  codec?: string | undefined;
  release?: string | undefined;
  /** e.g. "2.1 GB" */
  size?: string | undefined;
  /** The larger of the hinted (videoSize) and shown sizes, in GB, for autoplay's size limit. */
  largestGB?: number | undefined;
  /** What kind of not-the-real-release copy it is, when it's one (`traits.cam`). */
  copy?: CopyKind | undefined;
  /** Years written in the name (release names carry the film's), for spotting another film's sources. */
  years?: number[] | undefined;
}

const YEAR = /(?:^|[^a-z0-9])((?:19|20)\d{2})(?=$|[^a-z0-9])/gi;
/**
 * Numbers that aren't years: seeder and peer counts ("👤 2025", "Seeders: 2001")
 * and sizes ("1950 MB"). Left in, a popular torrent's 2,025 seeders would mark
 * it as another film's and send it to the bottom.
 */
const NOT_YEARS = /(?:[\u{1F464}\u{1F465}]️?|\b(?:seed(?:er)?s?|peers?|leech(?:er)?s?)\b\s*:?)\s*\d+|\d+(?:[.,]\d+)?\s*(?:[KMGT]i?B)\b/giu;

/**
 * The year a source names when it's a different film's: some addons search by
 * name, and a new film sharing a franchise's name gets every older film's
 * sources too ("Resident Evil" 2026 → Retribution 2012…). Only when the name
 * has years and none is within a year of the film's (files of "Blade Runner
 * 2049" also say 2017, so they match). Undefined otherwise.
 */
export function otherFilmYear(years: readonly number[] | undefined, filmYear: number | undefined): number | undefined {
  if (!years?.length || !filmYear) return undefined;
  return years.some((y) => Math.abs(y - filmYear) <= 1) ? undefined : years[0];
}

/** Camera, telesync, telecine or screener: shown on the source so a "1080p" cinema recording can't pass for the film. */
export type CopyKind = 'CAM' | 'TS' | 'TC' | 'SCR';

// Word-ish boundaries: release names separate tokens with . _ - space or brackets.
const token = (pattern: string) => new RegExp(`(?:^|[^a-z0-9])(?:${pattern})(?:$|[^a-z0-9])`, 'i');

const RESOLUTIONS: [RegExp, Resolution][] = [
  [token('2160p|4k|uhd'), '2160p'],
  [token('1080p|1080i|fhd|full[ ._-]?hd'), '1080p'],
  // "DTS-HD" is the audio, not a 720p picture.
  [token('720p|(?<!dts[ ._-])hd'), '720p'],
  [token('480p|576p|sd'), '480p'],
];

const HDRS: [RegExp, Hdr][] = [
  [token('dv|dovi|dolby[ ._-]?vision'), 'Dolby Vision'],
  [token('hdr10\\+|hdr10plus'), 'HDR10+'],
  [token('hdr10|hdr'), 'HDR10'],
  [token('hlg'), 'HLG'],
];

// Channel counts are usually glued to the codec (AAC2.0, DDP5.1, TrueHD.7.1),
// so they only need digit boundaries. A size isn't one ("💾 5.1 GB").
const channels = (layout: string) => new RegExp(`(?<![0-9])${layout}(?![0-9])(?!\\s*[kmgt]i?b(?![a-z]))`, 'i');

const AUDIOS: [RegExp, Audio][] = [
  [token('atmos'), 'Atmos'],
  [channels('7[ .]1'), '7.1'],
  [channels('5[ .]1'), '5.1'],
  [channels('2[ .]0'), 'Stereo'],
  [token('stereo'), 'Stereo'],
];

const CODECS: [RegExp, Codec][] = [
  [token('hevc|[xh][ .]?265'), 'HEVC'],
  [token('av1'), 'AV1'],
  [token('avc|[xh][ .]?264'), 'H.264'],
];

const RELEASES: [RegExp, string][] = [
  [token('remux'), 'Remux'],
  [token('blu[ .-]?ray|bdrip|brrip'), 'BluRay'],
  [token('web[ .-]?dl'), 'WEB-DL'],
  [token('webrip'), 'WEBRip'],
  [token('hdtv'), 'HDTV'],
];

const LOSSLESS = token('true[ .-]?hd|dts[ .-]?hd[ .-]?ma|dts[ .-]?x|flac|l?pcm');
// "MULTi.Subs" is several subtitle languages, not audio ones.
const MULTI_AUDIO = token('(?:multi(?:[ .-]?(?:audio|lang))?|dual[ .-]?audio)(?![ ._-]?subs?(?:$|[^a-z0-9]))');
const CAM = token('cam|camrip|hd[ .-]?cam|ts|hd[ .-]?ts|telesync|tc|hd[ .-]?tc|telecine|scr|screener|dvd[ .-]?scr|bd[ .-]?scr|dvd[ .-]?screener|pre[ .-]?dvd(?:rip)?|hd[ .-]?rip[ .-]?cam');
// Which kind, most specific first (a "HDTS" is a telesync, not a plain camera copy).
const COPY_KINDS: readonly (readonly [RegExp, CopyKind])[] = [
  [token('ts|hd[ .-]?ts|telesync|hd[ .-]?telesync'), 'TS'],
  [token('tc|hd[ .-]?tc|telecine'), 'TC'],
  [token('scr|screener|dvd[ .-]?scr|bd[ .-]?scr|dvd[ .-]?screener'), 'SCR'],
];
/**
 * The release group tag after the codecs ("H.264-TC", "AAC2.0-TS"): a group
 * named TC or TS isn't a telecine or telesync. A copy kind written as its own
 * token ("HD-TC", ".TC.") still counts.
 */
const GROUP_AFTER_CODEC = /((?:^|[^a-z0-9])(?:[xh][ .]?26[45]|hevc|avc|av1|xvid|divx|aac|e?ac3|ddp?|dts|flac|opus|mp3)(?:[ .]?\d[ .]\d)?)-[a-z0-9]+(?![a-z0-9])/gi;
const THREE_D = token('3d|h?sbs|half[ .-]?(?:sbs|ou)|h[ .-]?ou');
/**
 * Debrid addons mark a cached (instant) source in its name: some as
 * [RD+] / [AD+] / [PM+] / [TB+]…, some with ⚡, others with "instant" or
 * "cached" (never "uncached").
 * The words are only looked for in the name: a description often holds the
 * release name, and a film can be called "Instant Family".
 */
const CACHED_MARKS = [/\[[a-z]{2,3}\+\]/i, /⚡/u];
const CACHED_WORDS = [token('instant'), /(?<![a-z0-9]|not[ ._-])cached(?![a-z0-9])/i];
/**
 * And the opposite: [RD download], ⏳ / ⬇, or the words "uncached" /
 * "not cached". Only
 * in the name, for the same reasons; a cached mark wins.
 */
const UNCACHED_MARKS = [/\[[a-z]{2,3}[ ._-]?download\]/i, /⏳/u, /⬇/u, token('uncached|not[ ._-]cached')];

const first = <T>(table: [RegExp, T][], text: string): T | undefined => table.find(([re]) => re.test(text))?.[1];

const GB = 1024 ** 3;

/** "2.1 GB", "700 MB" in the interface's language. */
function formatSize(bytes: number): string {
  const gb = bytes >= GB;
  return new Intl.NumberFormat(locale(), { style: 'unit', unit: gb ? 'gigabyte' : 'megabyte', unitDisplay: 'short', minimumFractionDigits: gb ? 1 : 0, maximumFractionDigits: gb ? 1 : 0 }).format(gb ? bytes / GB : bytes / 1024 ** 2);
}

/** Sizes written in the text, e.g. "💾 2.1 GB" or "700MB". */
function sizeFromText(text: string): number | undefined {
  const match = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)\s*(GB|GiB|MB|MiB)\b/i.exec(text);
  if (!match) return undefined;
  const raw = match[1]!;
  // Grouped thousands ("1,234.5 MB", "1,234,567 MB"); a lone comma group with
  // no point ("1,234 GB") stays a decimal comma like "1,5 GB", as before.
  const grouped = raw.includes(',') && (raw.includes('.') || raw.split(',').length > 2);
  const value = parseFloat(grouped ? raw.replace(/,/g, '') : raw.replace(',', '.'));
  const bytes = match[2]!.toUpperCase().startsWith('G') ? value * GB : value * 1024 ** 2;
  return Number.isFinite(bytes) ? bytes : undefined;
}

/** True when found; undefined (unknown, so neutral in ranking) when not. */
const flag = (found: boolean) => found || undefined;

export function streamLabels(stream: { name?: string | undefined; description?: string | undefined; filename?: string | undefined; videoSize?: number | undefined }): StreamLabels {
  const text = [stream.filename, stream.name, stream.description].filter(Boolean).join(' \n ');
  const shown = sizeFromText(text);
  // A hint of 0 means the addon (or a debrid listing) doesn't know the size: no video is 0 bytes.
  const hint = stream.videoSize !== undefined && stream.videoSize > 0 ? stream.videoSize : undefined;
  const bytes = hint ?? shown;
  // For autoplay's size limit: the larger of the hinted and shown sizes, so rounding can't sneak under the cap.
  const largest = hint === undefined ? shown : shown === undefined ? hint : Math.max(hint, shown);
  const codec = first(CODECS, text);
  const release = first(RELEASES, text);
  // A ".ts" file extension (MPEG transport stream) isn't a telesync.
  const withoutExtensions = text.replace(/\.(?:m2)?ts(?=\s|$)/gi, ' ');
  // Addons mark cached sources in the name or description, never the filename.
  const label = [stream.name, stream.description].filter(Boolean).join(' \n ');
  const cached = CACHED_MARKS.some((re) => re.test(label)) || CACHED_WORDS.some((re) => re.test(stream.name ?? ''));
  const uncached = !cached && UNCACHED_MARKS.some((re) => re.test(stream.name ?? ''));
  const copyText = withoutExtensions.replace(GROUP_AFTER_CODEC, '$1');
  const cam = CAM.test(copyText);
  const years = [...new Set([...withoutExtensions.replace(NOT_YEARS, ' ').matchAll(YEAR)].map((m) => Number(m[1])))].slice(0, 4);
  const copy = cam ? (COPY_KINDS.find(([re]) => re.test(copyText))?.[1] ?? 'CAM') : undefined;
  return {
    traits: {
      resolution: first(RESOLUTIONS, text),
      hdr: first(HDRS, text),
      audio: first(AUDIOS, text),
      sizeGB: bytes === undefined ? undefined : bytes / GB,
      codec,
      lossless: flag(LOSSLESS.test(text)),
      multiAudio: flag(MULTI_AUDIO.test(text)),
      cached: flag(cached),
      uncached: flag(uncached),
      remux: flag(release === 'Remux'),
      cam: flag(cam),
      threeD: flag(THREE_D.test(text)),
      words: wordsOf(text) || undefined,
    },
    codec,
    release,
    size: bytes === undefined ? undefined : formatSize(bytes),
    largestGB: largest === undefined ? undefined : largest / GB,
    copy,
    years: years.length ? years : undefined,
  };
}
