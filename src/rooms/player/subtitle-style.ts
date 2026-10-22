/**
 * How subtitles look (Settings → Audio & Subtitles) and where they sit (the
 * player's Audio & subtitles panel). mpv draws subtitles, so the player hands
 * this to Rust, which sets the matching mpv properties.
 */
import { t } from '../../i18n';
import { settings } from '../../lib/ipc';

export interface SubtitleStyle {
  /** mpv's font scale: 55 is its default (SIZE_MIN to SIZE_MAX, in SIZE_STEP steps). */
  size: number;
  color: string;
  /** The text's opacity, in percent (OPACITY_MIN to 100). */
  opacity: number;
  background: 'none' | 'shadow' | 'box';
  /** The box's colour and opacity (percent), when `background` is 'box'. */
  backColor: string;
  backOpacity: number;
  /** Outline thickness, 0 for none. */
  outline: number;
  outlineColor: string;
  /** mpv's `sub-pos`: 100 is the bottom of the picture; lower is higher up (down to POSITION_HIGHEST). */
  position: number;
  bold: boolean;
  /** Plain text subtitles ignore placement from the file and stay at `position` (see subtitleOverride). */
  keepBottom: boolean;
  /** One of SUBTITLE_FONTS: mpv's default, or a bundled readability font (Rust maps the id to the family name). */
  font: SubtitleFont;
}

/**
 * The fonts to choose from: mpv's own default, and three made for easier
 * reading, plus Arimo Bold (a heavy sans like streaming services use), all
 * bundled in public/fonts (and shipped to mpv as a resource). The
 * CSS family is for the page's preview; mpv gets only the id.
 */
export const SUBTITLE_FONTS = [
  ['default', t('subfonts.default'), ''],
  ['atkinson', 'Atkinson Hyperlegible', "'Atkinson Hyperlegible'"],
  ['lexend', 'Lexend', "'Lexend'"],
  ['opendyslexic', 'OpenDyslexic', "'OpenDyslexic'"],
  ['arimo', t('subfontarimo.label'), "'Arimo'"],
] as const;
export type SubtitleFont = (typeof SUBTITLE_FONTS)[number][0];

/** The size slider's range, matching what Rust accepts; 55 is mpv's default. */
export const SIZE_MIN = 20;
export const SIZE_MAX = 120;
export const SIZE_STEP = 5;
export const SIZE_DEFAULT = 55;
/** Text never fades out of sight; the box may be clear. Opacities move in OPACITY_STEP steps. */
export const OPACITY_MIN = 25;
export const OPACITY_STEP = 5;
export const SUBTITLE_COLORS = [
  ['#ffffff', t('player.subtitle-style.white')],
  ['#ffe14d', t('player.subtitle-style.yellow')],
  ['#7fd8ff', t('player.subtitle-style.cyan')],
  ['#b8f5a6', t('player.subtitle-style.green')],
] as const;
export const SUBTITLE_OUTLINES = [
  [0, t('player.subtitle-style.none')],
  [2, t('player.subtitle-style.thin')],
  [3, t('player.subtitle-style.normal')],
  [5, t('player.subtitle-style.thick')],
] as const;
/** Box and outline colours (fixed choices: the page never sends a typed colour). */
export const SUBTITLE_EDGE_COLORS = [
  ['#000000', t('player.subtitle-style.black')],
  ['#404040', t('player.subtitle-style.grey')],
  ['#0b2545', t('player.subtitle-style.navy')],
  ['#ffffff', t('player.subtitle-style.white')],
] as const;
/** The highest subtitles can be raised to (half way up), matching the Rust side. */
export const POSITION_HIGHEST = 50;
export const POSITION_BOTTOM = 100;

/** mpv's own defaults (and plain subtitles kept at the bottom), so nothing moves until the person picks something. */
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  size: SIZE_DEFAULT,
  color: '#ffffff',
  opacity: 100,
  background: 'none',
  // The box Orbit always drew: black at 70%.
  backColor: '#000000',
  backOpacity: 70,
  outline: 3,
  outlineColor: '#000000',
  position: POSITION_BOTTOM,
  bold: false,
  keepBottom: true,
  font: 'default',
};
const KEY = 'player.subtitles';

export async function subtitleStyle(): Promise<SubtitleStyle> {
  return parseSubtitleStyle(await settings.get(KEY).catch(() => null));
}

/** A saved style with every unknown or invalid field reset to its default. */
export function parseSubtitleStyle(value: unknown): SubtitleStyle {
  const saved = typeof value === 'object' && value !== null ? (value as Partial<Record<keyof SubtitleStyle, unknown>>) : {};
  const oneOf = <T>(v: unknown, list: readonly (readonly [T, string])[], fallback: T): T => (list.some(([x]) => x === v) ? (v as T) : fallback);
  const d = DEFAULT_SUBTITLE_STYLE;
  const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
  const stepped = (v: unknown, min: number, max: number, step: number, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max && v % step === 0 ? v : fallback);
  return {
    size: stepped(saved.size, SIZE_MIN, SIZE_MAX, SIZE_STEP, d.size),
    color: hex(saved.color, d.color),
    opacity: stepped(saved.opacity, OPACITY_MIN, 100, OPACITY_STEP, d.opacity),
    background: saved.background === 'shadow' || saved.background === 'box' ? saved.background : 'none',
    backColor: hex(saved.backColor, d.backColor),
    backOpacity: stepped(saved.backOpacity, 0, 100, OPACITY_STEP, d.backOpacity),
    outline: oneOf(saved.outline, SUBTITLE_OUTLINES, d.outline),
    outlineColor: hex(saved.outlineColor, d.outlineColor),
    position: typeof saved.position === 'number' && Number.isInteger(saved.position) && saved.position >= POSITION_HIGHEST && saved.position <= POSITION_BOTTOM ? saved.position : d.position,
    bold: saved.bold === true,
    keepBottom: saved.keepBottom !== false,
    font: SUBTITLE_FONTS.some(([id]) => id === saved.font) ? (saved.font as SubtitleFont) : d.font,
  };
}

export const saveSubtitleStyle = (style: SubtitleStyle) => settings.set(KEY, style);

/** Codecs mpv reports for plain text subtitles (SubRip, WebVTT, MP4 text); styled ASS/SSA and picture subtitles aren't among them. */
const TEXT_CODECS = new Set(['subrip', 'srt', 'webvtt', 'mov_text', 'text']);

/**
 * mpv's `sub-ass-override` for the subtitle showing, while "Keep at the
 * bottom" is on. A `{\an8}` in an SRT file puts that line at the top of the
 * picture, and none of mpv's overrides beat a tag written in the line except
 * "strip", which drops italics too (checked with mpv itself). So files Orbit
 * adds (addon, uploaded, dropped) have only their placement tags taken out
 * by Rust (see placement.rs) and keep mpv's default, "scale"; plain text
 * tracks inside the video can't be rewritten and get "strip". Styled ASS/SSA
 * subtitles (anime signs, typesetting) always keep "scale".
 */
export function subtitleOverride(keepBottom: boolean, track: { codec: string | null; external: boolean } | undefined): 'strip' | 'scale' {
  return keepBottom && !!track?.codec && !track.external && TEXT_CODECS.has(track.codec.toLowerCase()) ? 'strip' : 'scale';
}

/** "Even out volume" (Settings → Audio & Subtitles): true or absent. */
export const AUDIO_NORMALIZE_KEY = 'player.normalize';
