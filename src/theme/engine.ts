/**
 * The active colour theme: a built-in preset or one of the person's own
 * (theme/palette.ts), plus the font pair. Colours go onto <html> as
 * `--base-*` properties through CSSOM (CSP-safe), and tokens.css derives the
 * rest from them, so every theme also takes the accent and the accent tint.
 *
 * The accent is the theme's own unless the person picks another colour (an
 * override, `theme.accent`). Choosing a theme drops the override, so every
 * theme shows the colour it was designed with; a Look's "restore" puts a
 * saved override back afterwards. While one of the person's own themes is
 * active, a picked accent is saved into that theme instead (it is then the
 * theme's own), as are changes to its colours or fonts.
 *
 * Beside the colours, the look has three parts Theme Studio edits: where the
 * nav lives (layout.ts), the seek bar (seekbar.ts) and custom CSS
 * (custom-css.ts). Each is saved as a setting of its own and, in themes saved
 * from Theme Studio, with the theme (its CSS under `theme.css.<id>`, since
 * thirty themes' CSS wouldn't fit in one setting). Choosing such a theme
 * brings its parts along; presets and older themes leave them as they are.
 */
import './afterglow.css';
import './crimson.css';
import './glass.css';
import { t } from '../i18n';
import { settings, withDialog } from '../lib/ipc';
import { applyAccent, effectiveAccent, normalizeAccentChoice, parseAccentChoice, parseHex, textOnFill, THEME_ACCENT, type AccentChoice } from './accent';
import { appearance, previewAppearance, setAppearance } from './appearance';
import { applyCustomCss, cleanCss, currentCss } from './custom-css';
import { applyFonts, DEFAULT_FONTS, findFontPair, type FontPairId } from './fonts';
import { applyNavLayout, currentNavLayout, DEFAULT_NAV_LAYOUT, parseNavLayout, showNavLayout, shownNavLayout, type NavLayout } from './layout';
import { cleanName, cleanTagline, DEFAULT_PRESET, findPreset, isLight, isTrueBlack, MAX_MY_THEMES, newThemeId, parseMyThemes, parseThemeFile, THEME_APPEARANCE, themeFile, type Colors, type MyTheme, type ThemeAppearance, type ThemeData, type ThemeStyle } from './palette';
import { applySeekBar, parseSeekBar, pruneSeekImages, seekImages, type SeekBar } from './seekbar';
import { ShownError } from '../lib/user-error';

const THEME_KEY = 'theme';
const ACCENT_KEY = 'theme.accent';
const MINE_KEY = 'theme.mine';
const FONTS_KEY = 'theme.fonts';
const LAYOUT_KEY = 'theme.layout';
const SEEKBAR_KEY = 'theme.seekbar';
const CSS_KEY = 'theme.css';
const cssKey = (id: string) => `${CSS_KEY}.${id}`;

let activeId: string = DEFAULT_PRESET.id;
let mine: MyTheme[] = [];
let fonts: FontPairId = DEFAULT_FONTS;
let seekbar: SeekBar = parseSeekBar(null);
let accentChoice: AccentChoice = THEME_ACCENT;
/** Counts theme choices, so a slow one that is overtaken doesn't apply its parts over the newer theme's. */
let choices = 0;

export const currentThemeId = () => activeId;
export const myThemes = (): readonly MyTheme[] => mine;
export const currentFonts = () => fonts;
const activeMine = () => mine.find((t) => t.id === activeId);
/** The active theme's extra details (palette.ts THEME_STYLES), if it has any. */
export const currentStyle = (): ThemeStyle | undefined => (activeMine() ?? findPreset(activeId))?.style;
/** The active theme's own accent. */
export const themeAccent = (): string => (activeMine() ?? findPreset(activeId) ?? DEFAULT_PRESET).colors.accent;
/** The accent as chosen: THEME_ACCENT, or the person's own colour. */
export const currentAccentChoice = (): AccentChoice => accentChoice;
const showAccent = () => applyAccent(effectiveAccent(accentChoice, themeAccent()));

/** A preset's id, or one of the person's own themes'. */
export function isThemeId(value: unknown): value is string {
  return findPreset(value) !== undefined || (typeof value === 'string' && /^mine-[0-9a-f]{8}$/.test(value));
}

/** The colours on screen now, with the accent as chosen. */
export function currentColors(): Colors {
  const base = activeMine()?.colors ?? findPreset(activeId)?.colors ?? DEFAULT_PRESET.colors;
  return { ...base, accent: effectiveAccent(accentChoice, base.accent) };
}

function applyColors(c: Colors): void {
  const root = document.documentElement;
  root.dataset.theme = isLight(c) ? 'light' : 'dark';
  root.dataset.trueBlack = String(isTrueBlack(c));
  for (const key of ['bg', 'panel', 'raised', 'text', 'muted', 'faint', 'danger'] as const) root.style.setProperty(`--base-${key}`, c[key]);
  const danger = dangerFill(c.danger);
  root.style.setProperty('--color-danger-strong', danger.strong);
  root.style.setProperty('--color-danger-contrast', danger.contrast);
}

/**
 * The fill under a label on danger (an armed Delete): readable at 4.5:1. It
 * may deepen further than the accent's (0.15 in OKLCH lightness): a darker
 * red still reads as danger, and white keeps the label as loud as it was.
 */
export const dangerFill = (danger: string) => textOnFill(danger, 0.15);

function applyStyle(style: ThemeStyle | undefined): void {
  if (style) document.documentElement.dataset.themeStyle = style;
  else delete document.documentElement.dataset.themeStyle;
}

export async function loadTheme(): Promise<void> {
  const [id, saved, savedFonts, savedLayout, savedSeekBar, savedCss, savedAccent] = await Promise.all(
    [THEME_KEY, MINE_KEY, FONTS_KEY, LAYOUT_KEY, SEEKBAR_KEY, CSS_KEY, ACCENT_KEY].map((key) => settings.get(key).catch(() => null)),
  );
  mine = parseMyThemes(saved);
  fonts = findFontPair(savedFonts).id as FontPairId;
  activeId = (typeof id === 'string' && (findPreset(id) || mine.some((t) => t.id === id)) && id) || DEFAULT_PRESET.id;
  applyColors(activeMine()?.colors ?? findPreset(activeId)!.colors);
  applyStyle(currentStyle());
  // Older Orbits saved the theme's own accent with every theme change: that is the theme's colour.
  accentChoice = normalizeAccentChoice(parseAccentChoice(savedAccent) ?? THEME_ACCENT, themeAccent());
  showAccent();
  applyFonts(fonts);
  applyNavLayout(parseNavLayout(savedLayout ?? undefined));
  seekbar = parseSeekBar(savedSeekBar);
  applySeekBar(seekbar);
  const css = cleanCss(savedCss);
  hiddenCss = safeMode ? css : null;
  applyCustomCss(safeMode ? '' : css);
  pruneUnusedSeekImages();
}

const saveMine = () => settings.set(MINE_KEY, mine);

/** Where the nav lives (Theme Studio, Looks); applied at once and saved. */
export async function setNavLayout(layout: NavLayout): Promise<void> {
  applyNavLayout(layout);
  await settings.set(LAYOUT_KEY, layout);
}

/**
 * Safe mode (Shift held while Orbit starts): custom CSS stays off for this session, so a
 * theme whose CSS hid the app can be fixed. Only Theme Studio, by hand, still shows CSS.
 */
let safeMode = false;
/**
 * In safe mode, the saved CSS kept off the screen (null when none is): Theme Studio still
 * starts from it, so saving other changes keeps it rather than saving the empty screen.
 */
let hiddenCss: string | null = null;

/** Turns safe mode on and takes custom CSS off the screen; false (and nothing changes) when none is showing. */
export function startCssSafeMode(): boolean {
  if (safeMode || !currentCss()) return false;
  safeMode = true;
  hiddenCss = currentCss();
  applyCustomCss('');
  return true;
}

async function setCss(css: string, show = !safeMode): Promise<void> {
  hiddenCss = show ? null : css;
  applyCustomCss(show ? css : '');
  await settings.set(CSS_KEY, css);
}

/** Saves the accent choice (null for the theme's colour, so older values keep their meaning). */
const saveAccentChoice = () => settings.set(ACCENT_KEY, accentChoice === THEME_ACCENT ? null : accentChoice);

/**
 * Applies a preset or saved theme with its own accent (an accent the person
 * picked is dropped, so the theme looks as designed), and a saved theme's
 * fonts and Theme Studio parts.
 */
export async function chooseTheme(id: string): Promise<void> {
  const own = mine.find((t) => t.id === id);
  const theme = own ?? findPreset(id);
  if (!theme) return;
  activeId = id;
  const choice = ++choices;
  accentChoice = THEME_ACCENT;
  applyColors(theme.colors);
  applyStyle(theme.style);
  showAccent();
  await Promise.all([saveAccentChoice(), settings.set(THEME_KEY, id)]);
  if (!own) return;
  const css = await settings.get(cssKey(own.id)).catch(() => null);
  // Another theme was chosen while this one's parts were loading: its colours are on screen, so these must not follow them.
  if (choice !== choices) return;
  await Promise.all([
    setFonts(own.fonts),
    own.appearance ? setAppearance(own.appearance) : undefined,
    own.layout ? setNavLayout(own.layout) : undefined,
    own.seekbar ? setSeekBar(own.seekbar) : undefined,
    typeof css === 'string' ? setCss(cleanCss(css)) : undefined,
  ]);
}

export async function setFonts(id: FontPairId): Promise<void> {
  fonts = id;
  applyFonts(id);
  const theme = activeMine();
  await Promise.all([settings.set(FONTS_KEY, id), theme && theme.fonts !== id ? ((theme.fonts = id), saveMine()) : undefined]);
}

/**
 * Sets the accent: THEME_ACCENT for the theme's own, or a hex code. On one of
 * the person's own themes a colour becomes the theme's accent, so the choice
 * stays "the theme's colour" and the theme carries it.
 */
export async function setAccent(choice: AccentChoice): Promise<void> {
  const parsed = choice === THEME_ACCENT ? THEME_ACCENT : parseHex(choice);
  if (!parsed) return;
  const theme = activeMine();
  const saveTheme = theme && parsed !== THEME_ACCENT && theme.colors.accent !== parsed;
  if (saveTheme) theme.colors = { ...theme.colors, accent: parsed };
  accentChoice = theme ? THEME_ACCENT : normalizeAccentChoice(parsed, themeAccent());
  showAccent();
  await Promise.all([saveAccentChoice(), saveTheme ? saveMine() : undefined]);
}

/** The seek bar's colour alone (Settings' "Player colour" rows); null is the accent. */
export const setSeekBarColor = (color: string | null): Promise<void> => setSeekBar({ ...seekbar, color });

/** The seek bar's style as saved (what Settings' colour rows change the colour of). */
export const currentSeekBar = (): SeekBar => seekbar;

/** The seek bar's style (saved from Theme Studio, or a theme brought it); kept with the active theme too if it has one. */
async function setSeekBar(bar: SeekBar): Promise<void> {
  seekbar = bar;
  applySeekBar(bar);
  const theme = activeMine();
  await Promise.all([settings.set(SEEKBAR_KEY, bar), theme?.seekbar && theme.seekbar !== bar ? ((theme.seekbar = bar), saveMine()) : undefined]);
  // A picture this one replaced goes now, not at the next launch.
  pruneUnusedSeekImages();
}

/**
 * Seek-bar pictures an open Theme Studio has shown (its draft, and the steps undo goes back to). The Studio
 * stays open while the person changes the player colour or the theme in Settings, which saves the bar and
 * prunes: a picture uploaded in the Studio but not saved yet must outlive that, until the Studio closes.
 */
const heldSeekImages = new Set<string>();

/** Keeps `look`'s seek-bar pictures while Theme Studio is open (the look it opened on; every look it shows). */
export function holdSeekImages(look: Look): void {
  for (const name of seekImages(look.seekbar)) heldSeekImages.add(name);
}

/** Theme Studio closed: the pictures it showed are kept only if a setting or theme uses them. */
export function releaseSeekImages(): void {
  heldSeekImages.clear();
}

/** Seek-bar pictures no setting, theme or open Theme Studio uses any more (e.g. from an edit thrown away, or replaced). */
function pruneUnusedSeekImages(): void {
  void pruneSeekImages([...seekImages(seekbar), ...mine.flatMap((theme) => (theme.seekbar ? seekImages(theme.seekbar) : [])), ...heldSeekImages]).catch(() => {});
}

/** Adds a theme to the person's own and switches to it. */
async function add(theme: ThemeData): Promise<MyTheme> {
  if (mine.length >= MAX_MY_THEMES) throw new ShownError(t('settings.theme.too-many', { max: MAX_MY_THEMES }));
  const names = new Set(mine.map((theme) => theme.name));
  let name = theme.name;
  for (let n = 2; names.has(name); n++) name = `${theme.name} ${n}`;
  const { css, ...rest } = theme;
  const created: MyTheme = { ...rest, name, id: newThemeId() };
  mine = [...mine, created];
  await saveMine();
  if (css !== undefined) await settings.set(cssKey(created.id), css);
  await chooseTheme(created.id);
  return created;
}

/**
 * Saves what's on screen as a new theme of the person's own: everything Theme Studio would save, not just the colours.
 * No CSS is saved as '' too: a theme with no CSS key keeps whatever CSS is on when chosen (as older themes do).
 */
export const saveCurrentAs = (name: string) => {
  const { colors, fonts: pair, appearance: finish, layout, seekbar: bar, css, style } = currentLook();
  return add({ name: cleanName(name), colors, fonts: pair, appearance: finish, layout, seekbar: bar, css, ...(style ? { style } : {}) });
};

/**
 * Removes one of the person's themes. If it was on, Orbit's own takes over and
 * the parts that theme brought go with it: its CSS, fonts, seek bar, and its
 * layout unless the person has changed the layout since (presets leave these
 * parts as they are, so they would otherwise outlive the theme).
 */
export async function deleteTheme(id: string): Promise<void> {
  const theme = activeId === id ? activeMine() : undefined;
  const css = theme ? await settings.get(cssKey(id)).catch(() => null) : null;
  mine = mine.filter((t) => t.id !== id);
  await Promise.all([saveMine(), settings.set(cssKey(id), null)]);
  if (!theme) return;
  const layoutIsTheme = theme.layout !== undefined && JSON.stringify(theme.layout) === JSON.stringify(currentNavLayout());
  await chooseTheme(DEFAULT_PRESET.id);
  await Promise.all([
    setFonts(DEFAULT_FONTS),
    layoutIsTheme ? setNavLayout(DEFAULT_NAV_LAYOUT) : undefined,
    theme.seekbar ? setSeekBar(parseSeekBar(null)) : undefined,
    typeof css === 'string' ? setCss('') : undefined,
  ]);
}

/** Reads a theme file and switches to it. */
export const importTheme = (text: string) => add(parseThemeFile(text));

/** Saves a theme file where the person picks (Downloads suggested) and returns where, or `null` if cancelled. */
export const saveThemeFile = (theme: ThemeData): Promise<string | null> => withDialog('theme_export', { name: theme.name, text: themeFile(theme) });

/** Saves one of the person's themes as a file (see `saveThemeFile`) and returns where, or `null` if cancelled. */
export async function exportTheme(id: string): Promise<string | null> {
  const theme = mine.find((t) => t.id === id);
  if (!theme) throw new ShownError(t('settings.theme.gone'));
  const css = await settings.get(cssKey(id)).catch(() => null);
  return saveThemeFile({ ...theme, ...(typeof css === 'string' && css ? { css } : {}) });
}

// ── Theme Studio ──

/** The appearance switches Theme Studio shows beside the colours (palette.ts, which themes carry them in). */
export const LOOK_APPEARANCE = THEME_APPEARANCE;
export type LookAppearance = ThemeAppearance;

/** Everything Theme Studio edits, as one value (so undo is a matter of keeping old ones). */
export interface Look {
  name: string;
  tagline: string;
  colors: Colors;
  fonts: FontPairId;
  appearance: LookAppearance;
  layout: NavLayout;
  seekbar: SeekBar;
  css: string;
  /** Null for none (a field that's always there, so undo and comparing looks see it). */
  style: ThemeStyle | null;
}

/** What's on screen now, as saved. */
export function currentLook(): Look {
  const own = activeMine();
  const a = appearance();
  return {
    name: own?.name ?? findPreset(activeId)?.name ?? DEFAULT_PRESET.name,
    tagline: own?.tagline ?? '',
    colors: currentColors(),
    fonts,
    appearance: Object.fromEntries(LOOK_APPEARANCE.map((key) => [key, a[key]])) as unknown as LookAppearance,
    layout: currentNavLayout(),
    seekbar,
    css: hiddenCss ?? currentCss(),
    style: currentStyle() ?? null,
  };
}

/** Shows `look` without saving anything (showing `currentLook()` again puts things back). */
export function previewLook(look: Look): void {
  holdSeekImages(look);
  applyColors(look.colors);
  applyStyle(look.style ?? undefined);
  applyAccent(look.colors.accent);
  applyFonts(look.fonts);
  previewAppearance(look.appearance);
  if (look.layout !== shownNavLayout()) showNavLayout(look.layout);
  applySeekBar(look.seekbar);
  // In safe mode the CSS it kept off stays off; only CSS edited by hand shows.
  const css = look.css === hiddenCss ? '' : look.css;
  if (css !== currentCss()) applyCustomCss(css);
}

/**
 * Ends a preview without saving it (Theme Studio's Discard): shows what's saved now, not what was saved when
 * the preview began, since Settings or a Look may have changed the accent, Type & finish or menu meanwhile.
 * `css` is the custom CSS saved then (only choosing another theme changes it, and that is applied from settings).
 */
export function showSavedLook(css: string): void {
  previewLook({ ...currentLook(), css });
}

/**
 * Saves `look` into theme `themeId` (the one Theme Studio opened on; by
 * default the active one) when it's one of the person's own, and makes that
 * theme the active one; otherwise (a preset, or a theme deleted meanwhile) as
 * a new one of theirs. Returns the theme it was saved in.
 */
export async function saveLook(look: Look, themeId: string = activeId): Promise<MyTheme> {
  const own = mine.find((theme) => theme.id === themeId);
  // Refused before anything is saved, so the settings aren't left half the new look.
  if (!own && mine.length >= MAX_MY_THEMES) throw new ShownError(t('settings.theme.too-many', { max: MAX_MY_THEMES }));
  const preset = findPreset(themeId);
  const name = cleanName(look.name, preset?.name);
  const tagline = cleanTagline(look.tagline);
  const data: Omit<MyTheme, 'id'> = { name: preset && name === preset.name ? t('settings.theme.copy-name', { name }) : name, ...(tagline ? { tagline } : {}), colors: look.colors, fonts: look.fonts, appearance: look.appearance, layout: look.layout, seekbar: look.seekbar, ...(look.style ? { style: look.style } : {}) };
  // The accent is now part of the theme's colours, so no override is kept on top.
  accentChoice = THEME_ACCENT;
  await Promise.all([setAppearance(look.appearance), saveAccentChoice(), settings.set(FONTS_KEY, look.fonts), setNavLayout(look.layout), setCss(look.css, look.css !== hiddenCss)]);
  fonts = look.fonts;
  applyFonts(fonts);
  if (!own) return add({ ...data, css: look.css });
  Object.assign(own, data, { name: cleanName(look.name, own.name) });
  if (!tagline) delete own.tagline;
  if (!look.style) delete own.style;
  // Another theme was chosen while the Studio was open: the one saved comes back on, and a
  // choice still loading its parts doesn't apply them over it.
  const switching = activeId !== own.id;
  activeId = own.id;
  choices++;
  applyColors(own.colors);
  applyStyle(own.style);
  showAccent();
  await Promise.all([saveMine(), settings.set(cssKey(own.id), look.css), setSeekBar(look.seekbar), switching ? settings.set(THEME_KEY, own.id) : undefined]);
  return own;
}
