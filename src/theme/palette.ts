/**
 * Colour themes: a handful of colours (background, panels, text, danger and
 * an accent) from which tokens.css derives every other colour. Built-in
 * presets live here; people's own themes are the same shape, saved in
 * settings and shared as small JSON files: colours and a font choice, and
 * from Theme Studio a tagline, the nav layout, the seek bar, a style (see
 * THEME_STYLES) and custom CSS
 * (style rules only, never HTML or script, so a shared theme can't run
 * anything; see custom-css.ts).
 */
import * as v from 'valibot';
import { t } from '../i18n';
import { contrastRatio, parseHex } from './accent';
import { cleanCss, cssFits } from './custom-css';
import { DEFAULT_FONTS, FONT_PAIRS, type FontPairId } from './fonts';
import { parseAppearance, type Appearance } from './appearance';
import { NavLayoutSchema, parseNavLayout, type NavLayout } from './layout';
import { parseSeekBar, SeekBarSchema, withoutImages, type SeekBar } from './seekbar';
import { ShownError } from '../lib/user-error';

export const COLOR_KEYS = ['bg', 'panel', 'raised', 'text', 'muted', 'faint', 'danger', 'accent'] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export type Colors = Record<ColorKey, string>;

export const COLOR_LABELS: Record<ColorKey, string> = {
  bg: t('settings.theme.color-bg'),
  panel: t('settings.theme.color-panel'),
  raised: t('settings.theme.color-raised'),
  text: t('settings.theme.color-text'),
  muted: t('settings.theme.color-muted'),
  faint: t('settings.theme.color-faint'),
  danger: t('settings.theme.color-danger'),
  accent: t('settings.theme.color-accent'),
};

/**
 * Extra details a theme can turn on beside its colours (styles.css, keyed on
 * `data-theme-style` on <html>). 'crimson': red-barred row headings, outlined
 * Top 10 numerals and headings, rank badges and red episode labels.
 * 'afterglow': a gradient Play button, outlined secondary buttons and the
 * current page marked by its name and a line instead of a pill. Drawn from
 * the accent, so they follow it when it changes. 'glass': see-through
 * floating surfaces (the nav, drawers, menus, toasts) over a static field of
 * colour, lit at the edges (glass.css).
 */
export const THEME_STYLES = ['crimson', 'afterglow', 'glass'] as const;
export type ThemeStyle = (typeof THEME_STYLES)[number];

/** A known style, or undefined (a newer Orbit's style is left out, not an error). */
export const parseThemeStyle = (value: unknown): ThemeStyle | undefined => THEME_STYLES.find((style) => style === value);

export interface Preset {
  id: string;
  name: string;
  colors: Colors;
  style?: ThemeStyle;
  /** One line about the theme, for presets with a look of their own. */
  description?: string;
}

/** The appearance switches Theme Studio shows beside the colours ("Type & finish"), which a theme of the person's own carries. */
export const THEME_APPEARANCE = ['tint', 'glow', 'corners', 'posterSize', 'heroStyle', 'detailBackground'] as const;
export type ThemeAppearance = Pick<Appearance, (typeof THEME_APPEARANCE)[number]>;

/** The Type & finish fields `value` holds that are valid; the others are left out (the theme then leaves them as they are). */
export function parseThemeAppearance(value: unknown): Partial<ThemeAppearance> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const valid = parseAppearance(raw);
  const kept = Object.fromEntries(THEME_APPEARANCE.filter((key) => key in raw && raw[key] === valid[key]).map((key) => [key, valid[key]]));
  return Object.keys(kept).length ? (kept as Partial<ThemeAppearance>) : undefined;
}

/** A theme someone made or imported. Themes saved before Theme Studio have only colours and fonts. */
export interface MyTheme extends Preset {
  fonts: FontPairId;
  tagline?: string;
  layout?: NavLayout;
  seekbar?: SeekBar;
  appearance?: Partial<ThemeAppearance>;
}

/** A theme as a file carries it: its custom CSS travels inside (saved themes keep it in a setting of its own). */
export type ThemeData = Omit<MyTheme, 'id'> & { css?: string };

const preset = (id: string, name: string, c: [string, string, string, string, string, string, string, string]): Preset => ({
  id,
  name,
  colors: { bg: c[0], panel: c[1], raised: c[2], text: c[3], muted: c[4], faint: c[5], danger: c[6], accent: c[7] },
});

export const PRESETS: readonly Preset[] = [
  // Faint text (dates, episode details, hints) is read, so in the themes the Looks use it keeps 4.5:1 (WCAG AA) on panels as well as the background.
  preset('dark', t('settings.themes.name.dark'), ['#0b0a09', '#161412', '#1c1a18', '#f4f2ef', '#b5aea7', '#8b847d', '#e5484d', '#e5484d']),
  // Soft off-black and neutral greys with a quiet steel blue: the calm dark theme, easy on the eyes for long evenings.
  preset('black', t('settings.themes.name.black'), ['#121212', '#1c1c1c', '#262626', '#ececec', '#b4b4b4', '#959595', '#ef5f63', '#7ea6d8']),
  // True black for OLED screens: background and panels stay #000 even with the accent tint and glow on. Cool greys and an
  // electric cyan, so it reads as its own theme beside Crimson's black and red.
  preset('amoled', t('settings.themes.name.amoled'), ['#000000', '#000000', '#0d0d0d', '#f1f5f8', '#a9b5be', '#86929b', '#ff5468', '#00d7ff']),
  preset('light', t('settings.themes.name.light'), ['#f5f2ee', '#ebe6e0', '#e3ddd6', '#1a1715', '#5c554f', '#665e57', '#c9373c', '#e04349']),
  preset('midnight', t('settings.themes.name.midnight'), ['#0a0f1f', '#121a30', '#1a2440', '#eef2ff', '#a9b3cf', '#818baa', '#f05d6c', '#5b8cff']),
  // Brown like embers, not ink: clearly warm panels, with a flame orange.
  preset('ember', t('settings.themes.name.ember'), ['#1a100b', '#27180f', '#342117', '#f8ece3', '#d0b6a5', '#ad9282', '#ff5d5d', '#ff6a2b']),
  preset('sky', t('settings.themes.name.sky'), ['#f4f7fb', '#e8eef6', '#dde5f0', '#14202e', '#4d5b6c', '#596575', '#c62f3a', '#2f6fde']),
  preset('nord', t('settings.themes.name.nord'), ['#2e3440', '#3b4252', '#434c5e', '#eceff4', '#d8dee9', '#b5beca', '#d5757d', '#88c0d0']),
  preset('stremio', t('settings.themes.name.stremio'), ['#0c0b11', '#1f1b3f', '#2a2358', '#e6e6e7', '#9d9da0', '#8f8e92', '#dc2626', '#7b5bf5']),
  // Wine-red velvet and gold, like an old picture palace (Marquee's).
  preset('royal', t('settings.themes.name.royal'), ['#150a0e', '#221218', '#2e1820', '#f7ede6', '#cdb6b0', '#ab9690', '#ff6b6b', '#e8b54a']),
  preset('dracula', t('settings.themes.name.dracula'), ['#282a36', '#343746', '#44475a', '#f8f8f2', '#d6d6d0', '#9bade2', '#ff5555', '#bd93f9']),
  preset('forest', t('settings.themes.name.forest'), ['#0a150b', '#121e12', '#192919', '#e7f2e6', '#b9cab8', '#859484', '#e85854', '#7bd77f']),
  // Black and white only: even warnings are grey (their words and icons carry them), so no colour ever appears.
  preset('noir', t('settings.themes.name.noir'), ['#0a0a0a', '#151515', '#202020', '#f5f5f5', '#acacac', '#8e8e8e', '#d0d0d0', '#ffffff']),
  // Black and one cinematic red. Pure black panels, so it gets AMOLED's restraint (no glows) too.
  {
    ...preset('crimson', t('settings.themes.crimson'), ['#000000', '#000000', '#141414', '#ffffff', '#b3b3b3', '#7a7a7a', '#ff5a5f', '#e3101e']),
    style: 'crimson',
    description: t('settings.themes.crimson-description'),
  },
  // Ink black and warm ivory, the copper kept to Play, the current page and progress.
  {
    ...preset('afterglow', t('settings.themes.name.afterglow'), ['#0b0a09', '#171411', '#231e19', '#f4f0e8', '#c1b8ac', '#9a9084', '#ff7078', '#ff9157']),
    style: 'afterglow',
    description: t('settings.themes.afterglow-description'),
  },
  // Deep blue-black so the frosted surfaces read as glass rather than grey; muted and faint are lighter
  // than other themes' because they're read through glass over any artwork (glass.test.ts).
  {
    ...preset('glass', t('settings.themes.name.glass'), ['#0b1019', '#151c2a', '#1e2738', '#eef2f8', '#d3dae6', '#b9c3d2', '#ff6b78', '#7cc4ff']),
    style: 'glass',
    description: t('settings.themes.glass-description'),
  },
];

export const DEFAULT_PRESET = PRESETS[0]!;

export const findPreset = (id: unknown) => PRESETS.find((p) => p.id === id);

/** Background and panels pure black: what an OLED screen shows as pixels switched off. */
export const isTrueBlack = (c: Pick<Colors, 'bg' | 'panel'>) => c.bg === '#000000' && c.panel === '#000000';

/** Light text on dark backgrounds or the other way round, from the background's brightness. */
export const isLight = (colors: Pick<Colors, 'bg'>) => contrastRatio(colors.bg, '#000000') > contrastRatio(colors.bg, '#ffffff');

/** Combinations people would struggle to read, worst first. */
export function readabilityWarnings(c: Colors): string[] {
  const warnings: string[] = [];
  const check = (fg: string, bg: string, min: number, message: string) => {
    if (contrastRatio(fg, bg) < min) warnings.push(message);
  };
  check(c.text, c.bg, 4.5, t('settings.theme.warn-text-bg'));
  check(c.text, c.raised, 4.5, t('settings.theme.warn-text-raised'));
  check(c.muted, c.bg, 3, t('settings.theme.warn-muted-bg'));
  check(c.accent, c.bg, 2, t('settings.theme.warn-accent-bg'));
  check(c.danger, c.bg, 2, t('settings.theme.warn-danger-bg'));
  return warnings;
}

const NAME_MAX = 40;
export const TAGLINE_MAX = 80;
/** Room for the largest custom CSS (escaped) and the rest, and nothing more. */
export const THEME_FILE_MAX_BYTES = 160 * 1024;

const hex = v.pipe(
  v.string(),
  v.maxLength(9),
  v.transform((value) => parseHex(value)),
  v.string(),
);
const ColorsSchema = v.object(Object.fromEntries(COLOR_KEYS.map((k) => [k, hex])) as Record<ColorKey, typeof hex>);
const FontsSchema = v.fallback(v.picklist(FONT_PAIRS.map((f) => f.id) as [FontPairId, ...FontPairId[]]), DEFAULT_FONTS);

const singleLine = (value: unknown, max: number) => (typeof value === 'string' ? [...value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim()].slice(0, max).join('').trim() : '');

/** Printable, single-line, at most 40 characters; `fallback` if nothing's left. */
export function cleanName(value: unknown, fallback = t('settings.theme.default-name')): string {
  return singleLine(value, NAME_MAX) || fallback;
}

/** Printable, single-line, at most 80 characters (may be empty). */
export const cleanTagline = (value: unknown): string => singleLine(value, TAGLINE_MAX);

/**
 * A shared theme file. Version 1: name, colours, fonts; Theme Studio added
 * optional tagline, layout, seek bar and CSS, so older files still read and
 * older Orbits read the colours of newer ones. Each optional part is checked
 * as strictly as the colours: one that's there but wrong rejects the file.
 */
const FileSchema = v.object({
  orbitTheme: v.literal(1),
  name: v.unknown(),
  colors: ColorsSchema,
  fonts: FontsSchema,
  tagline: v.optional(v.unknown()),
  layout: v.optional(NavLayoutSchema),
  seekbar: v.optional(SeekBarSchema),
  css: v.optional(v.pipe(v.string(), v.check(cssFits))),
  style: v.optional(v.unknown()),
  appearance: v.optional(v.unknown()),
});

export function themeFile(theme: ThemeData): string {
  const { name, colors, fonts, tagline, layout, seekbar, css, style, appearance } = theme;
  // Seek-bar pictures are files on this PC, so they stay behind.
  const extras = { ...(tagline ? { tagline } : {}), ...(layout ? { layout } : {}), ...(seekbar ? { seekbar: withoutImages(seekbar) } : {}), ...(css ? { css } : {}), ...(style ? { style } : {}), ...(appearance ? { appearance } : {}) };
  return JSON.stringify({ orbitTheme: 1, name, colors, fonts, ...extras }, null, 2);
}

/** Reads a theme file, or throws a message to show. */
export function parseThemeFile(text: string): ThemeData {
  // In UTF-8 bytes, as the file on disk (and the cap Settings checks it by) counts them; a character can be up to four.
  if (new TextEncoder().encode(text).length > THEME_FILE_MAX_BYTES) throw new ShownError(t('settings.theme.file-too-large'));
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ShownError(t('settings.theme.not-a-theme'));
  }
  const parsed = v.safeParse(FileSchema, json);
  if (!parsed.success) throw new ShownError(t('settings.theme.not-a-theme-or-newer'));
  const { name, colors, fonts, tagline, layout, seekbar, css, style, appearance } = parsed.output;
  const theme: ThemeData = { name: cleanName(name), colors, fonts };
  const finish = parseThemeAppearance(appearance);
  if (finish) theme.appearance = finish;
  const known = parseThemeStyle(style);
  if (known) theme.style = known;
  if (cleanTagline(tagline)) theme.tagline = cleanTagline(tagline);
  if (layout) theme.layout = parseNavLayout(layout);
  if (seekbar) theme.seekbar = withoutImages(seekbar);
  if (css !== undefined) theme.css = cleanCss(css);
  return theme;
}

const MineSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^mine-[0-9a-f]{8}$/)),
  name: v.unknown(),
  colors: ColorsSchema,
  fonts: FontsSchema,
  tagline: v.optional(v.unknown()),
  layout: v.optional(v.unknown()),
  seekbar: v.optional(v.unknown()),
  style: v.optional(v.unknown()),
  appearance: v.optional(v.unknown()),
});
export const MAX_MY_THEMES = 30;

/** Saved themes, keeping only valid ones (settings can come from a hand-edited backup). */
export function parseMyThemes(value: unknown): MyTheme[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_MY_THEMES).flatMap((raw) => {
    const parsed = v.safeParse(MineSchema, raw);
    if (!parsed.success) return [];
    const { id, name, colors, fonts, tagline, layout, seekbar, style, appearance } = parsed.output;
    const theme: MyTheme = { id, name: cleanName(name), colors, fonts };
    const known = parseThemeStyle(style);
  if (known) theme.style = known;
    if (cleanTagline(tagline)) theme.tagline = cleanTagline(tagline);
    // Parts saved by Theme Studio; an unreadable one is left out (the theme then leaves that part as it is).
    if (layout !== undefined) theme.layout = parseNavLayout(layout);
    if (seekbar !== undefined) theme.seekbar = parseSeekBar(seekbar);
    const finish = parseThemeAppearance(appearance);
    if (finish) theme.appearance = finish;
    return [theme];
  });
}

export function newThemeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `mine-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
