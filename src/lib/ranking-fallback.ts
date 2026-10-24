/**
 * Source ranking, TypeScript fallback for the core/ engine (phase 5).
 *
 * Every point a source earns is recorded as a named signal so the stream
 * picker can show *why* it ranked where it did. Weights follow the handoff
 * spec's signal table; the person's own rules (Settings → Playback →
 * Choosing a source) add their signals on top. A signal whose metadata is
 * missing is left out rather than scored 0, so an unknown never counts for
 * or against a source.
 */
import * as v from 'valibot';

export type Resolution = '2160p' | '1080p' | '720p' | '480p';
export type Hdr = 'Dolby Vision' | 'HDR10' | 'HDR10+' | 'HLG';
export type Audio = 'Atmos' | '7.1' | '5.1' | 'Stereo';
export type Codec = 'HEVC' | 'AV1' | 'H.264';

/** What's known about a source; parsing it from names and hints is phase 5. */
export interface SourceTraits {
  resolution?: Resolution | undefined;
  hdr?: Hdr | undefined;
  audio?: Audio | undefined;
  /** ISO 639-1 codes of the audio languages, e.g. ['en', 'es']. */
  languages?: string[] | undefined;
  sizeGB?: number | undefined;
  /** A file on this PC rather than a network stream. */
  local?: boolean | undefined;
  codec?: Codec | undefined;
  /** Lossless audio (TrueHD, DTS-HD MA, DTS:X, FLAC, PCM). */
  lossless?: boolean | undefined;
  /** More than one audio language (MULTi, Dual Audio). */
  multiAudio?: boolean | undefined;
  /** Ready to play on the person's debrid service ([RD+], ⚡, "cached"). */
  cached?: boolean | undefined;
  /** Not on the debrid service yet ([RD download], ⏳, ⬇): it would play a "downloading" clip. Never picked automatically (see autoplay.ts). */
  uncached?: boolean | undefined;
  remux?: boolean | undefined;
  /** A camera, telesync or screener copy. */
  cam?: boolean | undefined;
  threeD?: boolean | undefined;
  /** The name, description and filename as words (see `wordsOf`), for keyword rules. */
  words?: string | undefined;
}

export const AVOID_RULES = ['cam', 'hdr', 'dv', 'hevc', 'av1', '3d', 'remux'] as const;
export type AvoidRule = (typeof AVOID_RULES)[number];
export const PREFER_RULES = ['cached', 'hdr', 'audio', 'multi-audio'] as const;
export type PreferRule = (typeof PREFER_RULES)[number];
/** Maximum file size for a movie, in GB; 0 is no limit. */
export const SIZE_LIMITS = [0, 2, 4, 8, 15, 30] as const;
/** Minimum file size for a movie, in GB; 0 is no limit. Tiny files are often fakes or camera copies. */
export const MIN_SIZE_LIMITS = [0, 0.5, 1, 2, 4] as const;
/** Episodes run about a third of a movie, so their limit is a third of it. */
export const EPISODE_SIZE_SHARE = 1 / 3;
export const MAX_KEYWORDS = 10;
export const MAX_KEYWORD_LENGTH = 40;

/** The person's rules for choosing a source (Settings → Playback → Choosing a source). */
export interface SourceRules {
  /** Sources above this resolution are ranked after the rest; null is no limit. */
  maxQuality: Resolution | null;
  /** See SIZE_LIMITS. */
  maxSizeGB: number;
  /** See MIN_SIZE_LIMITS. */
  minSizeGB: number;
  avoid: AvoidRule[];
  prefer: PreferRule[];
  preferWords: string[];
  avoidWords: string[];
}

/**
 * No limits and nothing preferred, as ranking was before rules existed, except
 * that camera and screener copies are avoided: ranking never looked at them,
 * so a 1080p CAM could beat a 720p Blu-ray, and almost nobody wants that.
 */
export const DEFAULT_RULES: SourceRules = { maxQuality: null, maxSizeGB: 0, minSizeGB: 0, avoid: ['cam'], prefer: [], preferWords: [], avoidWords: [] };

/** What this device can decode and show (Android TV, as Android reports it); absent on a PC, where mpv plays anything. */
export interface DeviceSupport {
  /** Video codecs it has a decoder for. */
  codecs: readonly Codec[];
  /** HDR kinds its screen shows. */
  hdr: readonly Hdr[];
  /** Its screen's highest resolution. */
  maxResolution: Resolution;
}

/**
 * A Mac: mpv decodes everything, but its OpenGL output there can't apply Dolby
 * Vision's colour layer, so a Dolby Vision-only file (profile 5) plays purple
 * and green. Other HDR plays, in normal colours. Dolby Vision sources rank after
 * the rest, still there if nothing else plays.
 */
export const MAC_SUPPORT: DeviceSupport = { codecs: ['HEVC', 'AV1', 'H.264'], hdr: ['HDR10', 'HDR10+', 'HLG'], maxResolution: '2160p' };

const CODECS: readonly Codec[] = ['HEVC', 'AV1', 'H.264'];
const HDR_KINDS: readonly Hdr[] = ['Dolby Vision', 'HDR10', 'HDR10+', 'HLG'];
const RESOLUTIONS: readonly Resolution[] = ['2160p', '1080p', '720p', '480p'];

/** `value` (what Android reported) as DeviceSupport, keeping only names Orbit knows; undefined if it isn't one. */
export function parseDeviceSupport(value: unknown): DeviceSupport | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { codecs, hdr, maxResolution } = value as Record<string, unknown>;
  const known = <T extends string>(list: unknown, names: readonly T[]): T[] => (Array.isArray(list) ? names.filter((name) => list.includes(name)) : []);
  const resolution = RESOLUTIONS.find((r) => r === maxResolution);
  if (!resolution || !Array.isArray(codecs)) return undefined;
  return { codecs: known(codecs, CODECS), hdr: known(hdr, HDR_KINDS), maxResolution: resolution };
}

export interface RankingPrefs {
  preferredQuality: Resolution;
  /** Preferred audio language, ISO 639-1. */
  language: string;
  /** Missing means DEFAULT_RULES. */
  rules?: SourceRules | undefined;
  /** Ranking an episode's sources: the size limit is EPISODE_SIZE_SHARE of a movie's. */
  episode?: boolean | undefined;
  /** What this device can play; absent means anything. */
  device?: DeviceSupport | undefined;
}

/** Which "Why?" line a signal is; the picker words it in the person's language. */
export type SignalId =
  | 'resolution'
  | 'above-preferred'
  | 'above-limit'
  | 'dolby-vision'
  | 'hdr'
  | 'prefer-hdr'
  | 'atmos'
  | 'surround'
  | 'stereo'
  | 'prefer-audio'
  | 'language'
  | 'multi-audio'
  | 'local'
  | 'cached'
  | 'large'
  | 'low-bitrate'
  | 'over-size'
  | 'under-size'
  | 'avoided'
  | 'avoided-cam'
  | 'keyword'
  | 'avoided-keyword'
  | 'unsupported'
  | 'above-screen';

export interface Signal {
  id: SignalId;
  points: number;
  /** Placeholders for the signal's text, e.g. { resolution: '2160p' }. */
  vars?: Record<string, string | number>;
  /** Breaks one of the person's limits: the source goes after every source that doesn't. */
  limit?: true;
}

const RESOLUTION_POINTS: Record<Resolution, number> = { '2160p': 40, '1080p': 28, '720p': 14, '480p': 0 };
const RESOLUTION_RANK: Record<Resolution, number> = { '480p': 0, '720p': 1, '1080p': 2, '2160p': 3 };
/**
 * Per resolution step above the preferred quality. The preferred one ranks first; lower ones keep their
 * own points, so one can outrank a higher one (preferring 720p: 720p 14, 480p 0, 1080p -2, 2160p -20).
 */
const ABOVE_PREFERRED_POINTS = -30;

/**
 * What a device can't play costs more than any bonus: a codec it can't decode won't play at all, and
 * HDR its screen can't show looks wrong. More pixels than the screen has only cost bandwidth.
 */
const DEVICE_POINTS = { codec: -45, hdr: -15, aboveScreen: -20 } as const;

/** Whether `hdr` shows on a screen that shows `shown`: HDR10+ plays as HDR10 where only that is. */
const showsHdr = (shown: readonly Hdr[], hdr: Hdr) => shown.includes(hdr) || (hdr === 'HDR10+' && shown.includes('HDR10'));

/** Rule weights: a limit outweighs any one bonus, and an avoided trait cancels most of one. */
export const RULE_POINTS = { limit: -40, avoid: -30, cam: -60, cached: 15, preferHdr: 10, preferAudio: 10, multiAudio: 10, keyword: 10, avoidKeyword: -30 } as const;

/** Lowercase words separated by single spaces, so "WEB-DL" and "web dl" match alike. */
export const wordsOf = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function hdrSignals(hdr: Hdr, rules: SourceRules): Signal[] {
  if ((hdr === 'Dolby Vision' && rules.avoid.includes('dv')) || rules.avoid.includes('hdr')) return [{ id: 'avoided', points: RULE_POINTS.avoid, vars: { what: hdr } }];
  const signals: Signal[] = [hdr === 'Dolby Vision' ? { id: 'dolby-vision', points: 18 } : { id: 'hdr', points: 10, vars: { hdr } }];
  if (rules.prefer.includes('hdr')) signals.push({ id: 'prefer-hdr', points: RULE_POINTS.preferHdr });
  return signals;
}

function keywordSignals(words: string | undefined, rules: SourceRules): Signal[] {
  if (!words) return [];
  const padded = ` ${words} `;
  const has = (word: string) => padded.includes(` ${word} `);
  return [
    ...rules.preferWords.filter(has).map((word): Signal => ({ id: 'keyword', points: RULE_POINTS.keyword, vars: { word } })),
    ...rules.avoidWords.filter(has).map((word): Signal => ({ id: 'avoided-keyword', points: RULE_POINTS.avoidKeyword, vars: { word } })),
  ];
}

export function rankingSignals(source: SourceTraits, prefs: RankingPrefs): Signal[] {
  const rules = prefs.rules ?? DEFAULT_RULES;
  const avoids = (rule: AvoidRule) => rules.avoid.includes(rule);
  const prefers = (rule: PreferRule) => rules.prefer.includes(rule);
  const signals: Signal[] = [];
  if (source.resolution) {
    signals.push({ id: 'resolution', points: RESOLUTION_POINTS[source.resolution], vars: { resolution: source.resolution } });
    // Per step above: a flat penalty let 4K's bonus outweigh it when the preference was 480p or 720p.
    const above = RESOLUTION_RANK[source.resolution] - RESOLUTION_RANK[prefs.preferredQuality];
    if (above > 0) {
      signals.push({ id: 'above-preferred', points: ABOVE_PREFERRED_POINTS * above, vars: { quality: prefs.preferredQuality } });
    }
    if (rules.maxQuality && RESOLUTION_RANK[source.resolution] > RESOLUTION_RANK[rules.maxQuality]) {
      signals.push({ id: 'above-limit', points: RULE_POINTS.limit, vars: { quality: rules.maxQuality }, limit: true });
    }
  }
  const device = prefs.device;
  if (device && source.resolution && RESOLUTION_RANK[source.resolution] > RESOLUTION_RANK[device.maxResolution]) {
    signals.push({ id: 'above-screen', points: DEVICE_POINTS.aboveScreen, vars: { resolution: device.maxResolution } });
  }
  if (source.hdr) {
    if (device && !showsHdr(device.hdr, source.hdr)) signals.push({ id: 'unsupported', points: DEVICE_POINTS.hdr, vars: { what: source.hdr } });
    else signals.push(...hdrSignals(source.hdr, rules));
  }
  if (device && source.codec && !device.codecs.includes(source.codec)) signals.push({ id: 'unsupported', points: DEVICE_POINTS.codec, vars: { what: source.codec } });
  if (source.codec === 'HEVC' && avoids('hevc')) signals.push({ id: 'avoided', points: RULE_POINTS.avoid, vars: { what: 'HEVC' } });
  if (source.codec === 'AV1' && avoids('av1')) signals.push({ id: 'avoided', points: RULE_POINTS.avoid, vars: { what: 'AV1' } });

  if (source.audio === 'Atmos') signals.push({ id: 'atmos', points: 12 });
  else if (source.audio === '5.1' || source.audio === '7.1') signals.push({ id: 'surround', points: 6, vars: { audio: source.audio } });
  else if (source.audio === 'Stereo') signals.push({ id: 'stereo', points: -2 });
  if ((source.audio === 'Atmos' || source.lossless) && prefers('audio')) signals.push({ id: 'prefer-audio', points: RULE_POINTS.preferAudio });

  if (source.languages?.includes(prefs.language)) {
    signals.push({ id: 'language', points: 8, vars: { language: prefs.language.toUpperCase() } });
  }
  if (source.multiAudio && prefers('multi-audio')) signals.push({ id: 'multi-audio', points: RULE_POINTS.multiAudio });
  if (source.local) signals.push({ id: 'local', points: 10 });
  if (source.cached && prefers('cached')) signals.push({ id: 'cached', points: RULE_POINTS.cached });

  if (source.sizeGB !== undefined) {
    // "For the runtime": an episode runs about a third of a movie, so its sizes are judged by a third.
    const share = prefs.episode ? EPISODE_SIZE_SHARE : 1;
    if (source.sizeGB > 15 * share) signals.push({ id: 'large', points: -4 });
    else if (source.sizeGB < 1.5 * share) signals.push({ id: 'low-bitrate', points: -6 });
    const cap = rules.maxSizeGB * share;
    if (cap > 0 && source.sizeGB > cap) {
      signals.push({ id: 'over-size', points: RULE_POINTS.limit, vars: { size: Math.round(cap * 10) / 10 }, limit: true });
    }
    // Episodes get the same share of the minimum as of the maximum.
    const floor = rules.minSizeGB * share;
    if (floor > 0 && source.sizeGB < floor) {
      signals.push({ id: 'under-size', points: RULE_POINTS.limit, vars: { size: Math.round(floor * 10) / 10 }, limit: true });
    }
  }

  if (source.cam && avoids('cam')) signals.push({ id: 'avoided-cam', points: RULE_POINTS.cam });
  if (source.threeD && avoids('3d')) signals.push({ id: 'avoided', points: RULE_POINTS.avoid, vars: { what: '3D' } });
  if (source.remux && avoids('remux')) signals.push({ id: 'avoided', points: RULE_POINTS.avoid, vars: { what: 'Remux' } });
  signals.push(...keywordSignals(source.words, rules));
  return signals;
}

export const scoreOf = (signals: readonly Signal[]) => signals.reduce((sum, s) => sum + s.points, 0);

/** Whether a source breaks one of the person's limits (size, highest quality). */
export const breaksLimit = (signals: readonly Signal[]) => signals.some((s) => s.limit);

export type Ranked<T> = T & { signals: Signal[]; score: number };

/**
 * Highest score first; sources that break a limit go after all that don't,
 * but are never dropped, so Play still has something when every source
 * breaks one. Ties keep their original (addon priority) order.
 */
export function rankSources<T extends { traits: SourceTraits }>(sources: readonly T[], prefs: RankingPrefs): Ranked<T>[] {
  return sources
    .map((source) => {
      const signals = rankingSignals(source.traits, prefs);
      return { ...source, signals, score: scoreOf(signals) };
    })
    .sort((a, b) => Number(breaksLimit(a.signals)) - Number(breaksLimit(b.signals)) || b.score - a.score);
}

/** A keyword list from free text: comma-separated, lowercased, no repeats, capped in count and length. */
export function parseKeywords(text: string): string[] {
  const words = text
    .split(',')
    .map((word) => wordsOf(word).slice(0, MAX_KEYWORD_LENGTH).trim())
    .filter(Boolean);
  return [...new Set(words)].slice(0, MAX_KEYWORDS);
}

const Keywords = v.pipe(
  v.array(v.string()),
  v.transform((list) => parseKeywords(list.join(','))),
);
const tolerant = <T>(schema: v.GenericSchema<unknown, T>, fallback: T) => v.fallback(schema, () => fallback);
const RulesSchema = v.object({
  maxQuality: tolerant(v.nullable(v.picklist(['2160p', '1080p', '720p', '480p'] as const)), DEFAULT_RULES.maxQuality),
  maxSizeGB: tolerant(v.pipe(v.number(), v.check((n) => (SIZE_LIMITS as readonly number[]).includes(n))), DEFAULT_RULES.maxSizeGB),
  minSizeGB: tolerant(v.pipe(v.number(), v.check((n) => (MIN_SIZE_LIMITS as readonly number[]).includes(n))), DEFAULT_RULES.minSizeGB),
  avoid: tolerant(v.pipe(v.array(v.unknown()), v.transform((list) => AVOID_RULES.filter((rule) => list.includes(rule)))), DEFAULT_RULES.avoid),
  prefer: tolerant(v.pipe(v.array(v.unknown()), v.transform((list) => PREFER_RULES.filter((rule) => list.includes(rule)))), DEFAULT_RULES.prefer),
  preferWords: tolerant(Keywords, DEFAULT_RULES.preferWords),
  avoidWords: tolerant(Keywords, DEFAULT_RULES.avoidWords),
});

/**
 * Saved rules, field by field: anything missing or invalid falls back to its
 * default, so one bad value never resets the rest. "Prefer HDR" can't stand
 * beside "Avoid HDR"; avoiding wins, as it's what an SDR screen needs.
 */
export function parseSourceRules(value: unknown): SourceRules {
  const parsed = v.safeParse(RulesSchema, typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {});
  if (!parsed.success) return { ...DEFAULT_RULES };
  const rules = parsed.output;
  // A minimum at or above the maximum would leave nothing inside the limits: the maximum wins.
  const minSizeGB = rules.maxSizeGB > 0 && rules.minSizeGB >= rules.maxSizeGB ? 0 : rules.minSizeGB;
  return { ...rules, minSizeGB, prefer: rules.avoid.includes('hdr') ? rules.prefer.filter((p) => p !== 'hdr') : rules.prefer };
}
