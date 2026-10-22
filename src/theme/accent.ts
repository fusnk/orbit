/**
 * User-selectable accent colour. One hex value drives a small palette: a
 * lighter and darker shade for gradients, and a text colour chosen for
 * contrast so labels on accent fills stay readable for any hue.
 */
import { t } from '../i18n';

export const ACCENT_PRESETS = [
  { label: t('settings.accent.red'), hex: '#e5484d' },
  { label: t('settings.accent.amber'), hex: '#f5a524' },
  { label: t('settings.accent.blue'), hex: '#3e9bff' },
  { label: t('settings.accent.green'), hex: '#46c28e' },
] as const;

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].hex;
const DARK_TEXT = '#0b0a09';
const LIGHT_TEXT = '#ffffff';

/** Normalizes `#rgb` / `#rrggbb` (with or without `#`) to lowercase `#rrggbb`, or `null`. */
export function parseHex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let hex = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;

/** Moves `hex` toward `target` by `amount` (0–1). */
export function mix(hex: string, target: string, amount: number): string {
  const a = toRgb(hex);
  const b = toRgb(target);
  return toHex([0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * amount) as Rgb);
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB hex to OKLab (Björn Ottosson's matrices). */
function toOklab(hex: string): Rgb {
  const [r, g, b] = toRgb(hex).map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab to sRGB hex, clamped into the gamut. */
function fromOklab([lightness, a, b]: Rgb): string {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear: Rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return toHex(linear.map((c) => fromLinear(Math.min(1, Math.max(0, c)))) as Rgb);
}

/** `a` moved toward `b` by `amount` (0–1) in OKLab, as CSS `color-mix(in oklab, …)` does (the accent tint). */
export function mixOklab(a: string, b: string, amount: number): string {
  const from = toOklab(a);
  const to = toOklab(b);
  return fromOklab([0, 1, 2].map((i) => from[i]! + (to[i]! - from[i]!) * amount) as Rgb);
}

/** WCAG AA for normal-size text: labels on accent fills are often small. */
const TEXT_CONTRAST = 4.5;
/** How far (OKLCH lightness) a fill may deepen to keep white text: a shade, not a different colour. */
const MAX_DEEPEN = 0.05;

/**
 * `hex` darkened in OKLCH (hue and chroma kept) just enough for white text to
 * reach TEXT_CONTRAST, or null when that takes more than `maxDeepen`.
 */
function deepenForWhite(hex: string, maxDeepen: number): string | null {
  const [lightness, a, b] = toOklab(hex);
  const deepest = fromOklab([lightness - maxDeepen, a, b]);
  if (contrastRatio(deepest, LIGHT_TEXT) < TEXT_CONTRAST) return null;
  // Binary search for the lightest shade that still passes.
  let low = lightness - maxDeepen;
  let high = lightness;
  let found = deepest;
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    const shade = fromOklab([mid, a, b]);
    if (contrastRatio(shade, LIGHT_TEXT) >= TEXT_CONTRAST) {
      found = shade;
      low = mid;
    } else {
      high = mid;
    }
  }
  return found;
}

export interface AccentPalette {
  accent: string;
  hi: string;
  lo: string;
  /** The fill under text (buttons, badges, pills): the accent, or a slightly deeper shade of it so white text reads. */
  strong: string;
  /** Text on `strong`. */
  contrast: string;
}

export function accentPalette(hex: string): AccentPalette {
  const accent = parseHex(hex) ?? DEFAULT_ACCENT;
  return { accent, hi: mix(accent, '#ffffff', 0.18), lo: mix(accent, '#000000', 0.16), ...textOnFill(accent) };
}

/**
 * White text where it reaches 4.5:1 on the fill, or on a deeper shade of it
 * (at most `maxDeepen` darker; Orbit's red keeps its white labels this way).
 * Otherwise whichever of white or dark reads better, on the fill itself.
 */
export function textOnFill(fill: string, maxDeepen = MAX_DEEPEN): Pick<AccentPalette, 'strong' | 'contrast'> {
  if (contrastRatio(fill, LIGHT_TEXT) >= TEXT_CONTRAST) return { strong: fill, contrast: LIGHT_TEXT };
  const deeper = deepenForWhite(fill, maxDeepen);
  if (deeper) return { strong: deeper, contrast: LIGHT_TEXT };
  return { strong: fill, contrast: contrastRatio(fill, LIGHT_TEXT) >= contrastRatio(fill, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT };
}

/** Applies the accent via CSSOM (allowed by our CSP, unlike inline style attributes). */
export function applyAccent(hex: string): AccentPalette {
  const palette = accentPalette(hex);
  const root = document.documentElement.style;
  root.setProperty('--color-accent', palette.accent);
  root.setProperty('--color-accent-hi', palette.hi);
  root.setProperty('--color-accent-lo', palette.lo);
  root.setProperty('--color-accent-strong', palette.strong);
  root.setProperty('--color-accent-contrast', palette.contrast);
  return palette;
}

export function currentAccent(): string {
  return parseHex(document.documentElement.style.getPropertyValue('--color-accent')) ?? DEFAULT_ACCENT;
}

/**
 * The accent choice: a colour of the person's own, or THEME_ACCENT for the
 * active theme's (its own accent, which follows it when the theme changes).
 * Saved as null (or nothing) in settings, so values saved before this choice
 * existed, which are all hex codes, keep meaning that colour.
 */
export const THEME_ACCENT = 'theme';
/** A `#rrggbb` hex code, or THEME_ACCENT. */
export type AccentChoice = string;

/** A saved choice: a hex code, or THEME_ACCENT for null, nothing or the sentinel; null when unreadable. */
export function parseAccentChoice(value: unknown): AccentChoice | null {
  if (value === null || value === undefined || value === THEME_ACCENT) return THEME_ACCENT;
  return parseHex(value);
}

/** The choice to keep for `choice` on a theme whose accent is `themeAccent`: picking the theme's own colour is the theme's colour. */
export function normalizeAccentChoice(choice: AccentChoice, themeAccent: string): AccentChoice {
  return choice === THEME_ACCENT || choice === parseHex(themeAccent) ? THEME_ACCENT : choice;
}

/** The colour on screen for `choice` on a theme whose accent is `themeAccent`. */
export const effectiveAccent = (choice: AccentChoice, themeAccent: string): string => (choice === THEME_ACCENT ? themeAccent : choice);
