/**
 * Looks (Settings → Appearance): one pick that restyles the whole app. A Look
 * is a bundle of values for settings that already exist — the theme, Home's
 * banner, the title page, where the menu lives and the player's layout — and
 * applying one writes them through their own setters, so everything redraws
 * the way it does when each is changed by hand.
 *
 * The first Look applied keeps a snapshot of those settings ("Restore my
 * previous setup"). The snapshot stays while the person tries other Looks or
 * changes a bundled setting by hand (the Look is then "custom": nothing
 * matches), and goes once it's restored. Every bundled setting is global, as
 * the snapshot is; nothing per profile is in a Look.
 *
 * A Look may also set the interface scale (only Couch does, for a TV across
 * the room). The scale is otherwise the person's own, so while a Look's scale
 * is on screen the snapshot keeps theirs beside the value the Look set; going
 * to a Look without a scale, or restoring, puts theirs back. A scale changed
 * by hand since (it no longer equals the Look's) is theirs and stays. The
 * font pair works the same way: a Look with a type of its own sets it, and a
 * Look without one (Orbit, Crimson, Orbit Arc) shows the person's own.
 */
import { settings } from '../lib/ipc';
import { choosePreset, layoutChanged, loadPlayerLayout, parsePlayerLayout, PLAYER_LAYOUT_KEY, watchPlayerLayout, type PlayerLayout } from '../rooms/player/layout';
import { parseAccentChoice, THEME_ACCENT, type AccentChoice } from './accent';
import { appearance, APPEARANCE_DEFAULTS, parseAppearance, SCALES, setAppearance, type Appearance } from './appearance';
import { chooseTheme, currentAccentChoice, currentFonts, currentThemeId, isThemeId, myThemes, setAccent, setFonts, setNavLayout } from './engine';
import { FONT_PAIRS, type FontPairId } from './fonts';
import { currentNavLayout, NAV_LAYOUT_CHANGED, parseNavLayout, type NavLayout } from './layout';
import { DEFAULT_PRESET, findPreset } from './palette';
import './tv.css';

export const LOOK_IDS = ['orbit', 'crimson', 'marquee', 'premiere', 'glass', 'aurora', 'couch', 'afterglow', 'arc'] as const;
export type LookId = (typeof LOOK_IDS)[number];

/** The appearance fields every Look sets; the rest (motion, spoilers…) are the person's own, and so is the scale unless a Look sets it (LookPreset.scale). */
export const LOOK_FIELDS = ['tint', 'glow', 'heroStyle', 'detailLayout', 'detailBackground', 'corners', 'posterSize', 'rowStyle', 'heroOverlap'] as const;
export type LookAppearance = Pick<Appearance, (typeof LOOK_FIELDS)[number]>;
type Scale = Appearance['scale'];

export interface LookPreset {
  id: LookId;
  /** Names are proper names, the same in every language. */
  name: string;
  /** A built-in theme's id (palette.ts PRESETS). */
  theme: string;
  appearance: LookAppearance;
  /** The nav's place (and the floating pill's, for a Look that uses it); its items (order, names, hidden) are left as they are. */
  nav: Pick<NavLayout, 'position' | 'side' | 'align'> & Partial<Pick<NavLayout, 'place'>>;
  /** A player preset, with its size or controls background changed where the Look wants. */
  player: Pick<PlayerLayout, 'preset'> & Partial<Pick<PlayerLayout, 'size' | 'background'>>;
  /** The interface scale, for a Look that sets it; left out, the person's own stays. */
  scale?: Scale;
  /** The font pair, for a Look with a type of its own; left out, the person's own stays. */
  fonts?: FontPairId;
}

const STOCK: LookAppearance = { tint: false, glow: 'normal', heroStyle: 'card', detailLayout: 'classic', detailBackground: 'normal', corners: 'classic', posterSize: 'standard', rowStyle: 'poster', heroOverlap: false };
const TOP: LookPreset['nav'] = { position: 'top', side: 'start', align: 'center' };

// Each Look differs in its frame, not only its colours: where the menu sits, the banner's shape, the cards, the corners, the
// type and the player, so two Looks are told apart even in a greyscale thumbnail.
export const LOOKS: readonly LookPreset[] = [
  { id: 'orbit', name: 'Orbit', theme: 'dark', appearance: STOCK, nav: TOP, player: { preset: 'orbit' } },
  // Crimson's own theme has no glow (true black); sharp corners and the full-bleed banner suit its red bars.
  // Landscape rails with title logos, the first one rising into the banner, and the menu at the start of the bar right after the wordmark (crimson.css).
  { id: 'crimson', name: 'Crimson', theme: 'crimson', appearance: { ...STOCK, glow: 'off', heroStyle: 'cinematic', detailLayout: 'showcase', corners: 'sharp', rowStyle: 'landscape', heroOverlap: true }, nav: { ...TOP, align: 'start' }, player: { preset: 'theater' } },
  // A picture palace: wine velvet and gold, condensed billboard titles, the logo-led Spotlight banner, big square-cut
  // posters, a slim rail so the posters get the width, and the Cinema player.
  { id: 'marquee', name: 'Marquee', theme: 'royal', fonts: 'orbit', appearance: { ...STOCK, glow: 'subtle', heroStyle: 'spotlight', detailLayout: 'showcase', corners: 'sharp', posterSize: 'large' }, nav: { position: 'rail', side: 'start', align: 'center' }, player: { preset: 'cinema' } },
  // A polished streaming service: deep blue tinted panels, Jakarta, the Carousel banner (a wide slide with the titles
  // either side peeking in) under a centred bar, soft round cards and the Showcase title page over blurred artwork.
  { id: 'premiere', name: 'Premiere', theme: 'midnight', fonts: 'jakarta', appearance: { ...STOCK, tint: true, heroStyle: 'carousel', detailLayout: 'showcase', detailBackground: 'blur', corners: 'round' }, nav: TOP, player: { preset: 'streaming' } },
  // Light and airy: a frosted pill floating at the top, small round posters (more on screen), Plex type and a floating glass player.
  { id: 'glass', name: 'Glass', theme: 'glass', fonts: 'plex', appearance: { ...STOCK, tint: true, glow: 'subtle', detailBackground: 'blur', corners: 'round', posterSize: 'small' }, nav: { position: 'dock', side: 'start', align: 'center', place: 'top' }, player: { preset: 'floating', background: 'blur' } },
  // Nothing at the top: the Split banner (the art framed beside the text), the menu floating at the bottom, wide landscape
  // tiles and Space Grotesk.
  { id: 'aurora', name: 'Aurora', theme: 'stremio', fonts: 'grotesk', appearance: { ...STOCK, tint: true, glow: 'normal', heroStyle: 'split', detailBackground: 'color', corners: 'round', rowStyle: 'landscape' }, nav: { position: 'dock', side: 'start', align: 'center', place: 'bottom' }, player: { preset: 'floating' } },
  // Warm Ember browns, wide Montserrat read from the sofa.
  { id: 'couch', name: 'Couch', theme: 'ember', fonts: 'montserrat', appearance: { ...STOCK, posterSize: 'large' }, nav: { position: 'sidebar', side: 'start', align: 'center' }, player: { preset: 'tv', size: 'large' }, scale: 150 },
  // Calm by design: no glow, so the copper stays on Play, the current page and progress. Fraunces titles, like a magazine.
  { id: 'afterglow', name: 'Afterglow', theme: 'afterglow', fonts: 'editorial', appearance: { ...STOCK, glow: 'off', heroStyle: 'cinematic', detailLayout: 'showcase', posterSize: 'large' }, nav: { position: 'cinematic', side: 'start', align: 'center' }, player: { preset: 'streaming' } },
  // Orbit's own pages, banner and colours; only the controls change: the Arc bar (nav-layouts.css), the banner's
  // ring timer (home.css) and the Arc player (player/layout.css).
  { id: 'arc', name: 'Orbit Arc', theme: 'dark', appearance: STOCK, nav: { position: 'arc', side: 'start', align: 'start' }, player: { preset: 'arc' } },
];

export const findLook = (id: unknown): LookPreset | undefined => LOOKS.find((look) => look.id === id);

/** The settings a Look sets, as they were before the first Look. */
export interface LookBackup {
  theme: string;
  /** A hex code, or THEME_ACCENT ('theme') for the theme's own colour. */
  accent: AccentChoice;
  appearance: LookAppearance;
  nav: NavLayout;
  player: PlayerLayout;
  /** Only while a Look's scale is on screen: the person's own (`own`) and the one that Look set (`look`). */
  scale?: Owned<Scale>;
  /** The same for the font pair. */
  fonts?: Owned<FontPairId>;
}

/** A setting some Looks set: the person's own value, and the one the Look on screen set. */
interface Owned<T> {
  own: T;
  look: T;
}

export const LOOK_BACKUP_KEY = 'appearance.look-backup';

const pickFields = (a: Appearance): LookAppearance => Object.fromEntries(LOOK_FIELDS.map((key) => [key, a[key]])) as unknown as LookAppearance;

/** A saved snapshot, or null when there's none or it's unreadable (a hand-edited backup); each part falls back on its own. */
export function parseLookBackup(value: unknown): LookBackup | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const saved = value as Record<string, unknown>;
  if (!isThemeId(saved.theme)) return null;
  // Older snapshots always hold a hex code; one without an accent means the theme's.
  const accent = parseAccentChoice(saved.accent);
  if (!accent) return null;
  const backup: LookBackup = { theme: saved.theme, accent, appearance: pickFields(parseAppearance(saved.appearance)), nav: parseNavLayout(saved.nav), player: parsePlayerLayout(saved.player) };
  const scale = parseOwned(saved.scale, isScale);
  if (scale) backup.scale = scale;
  const fonts = parseOwned(saved.fonts, isFontPair);
  if (fonts) backup.fonts = fonts;
  return backup;
}

const isScale = (value: unknown): value is Scale => SCALES.includes(value as Scale);
const isFontPair = (value: unknown): value is FontPairId => FONT_PAIRS.some((pair) => pair.id === value);

function parseOwned<T>(value: unknown, valid: (value: unknown) => value is T): Owned<T> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { own, look } = value as Record<string, unknown>;
  return valid(own) && valid(look) ? { own, look } : undefined;
}

/** The person's own value: the saved one while the value on screen is still the one a Look set, otherwise the one on screen. */
const ownValue = <T>(current: T, saved: Owned<T> | undefined): T => (saved && current === saved.look ? saved.own : current);

/** The value a Look that sets `value` (or leaves it out) gives, and what the snapshot keeps (nothing once the person's own is back). */
function lookValue<T>(value: T | undefined, current: T, saved: Owned<T> | undefined): { value: T; saved: Owned<T> | undefined } {
  const own = ownValue(current, saved);
  return value === undefined ? { value: own, saved: undefined } : { value, saved: { own, look: value } };
}

/** The person's own scale: the saved one while the scale on screen is still the one a Look set, otherwise the one on screen. */
export const ownScale = (current: Scale, saved: LookBackup['scale']): Scale => ownValue(current, saved);

/** The scale applying `look` gives, and what the snapshot keeps of it (nothing once the person's own is back). */
export function scaleFor(look: LookPreset, current: Scale, saved: LookBackup['scale']): { scale: Scale; saved: LookBackup['scale'] } {
  const { value, saved: kept } = lookValue(look.scale, current, saved);
  return { scale: value, saved: kept };
}

/** The font pair applying `look` gives, and what the snapshot keeps of it, as for the scale. */
export function fontsFor(look: LookPreset, current: FontPairId, saved: LookBackup['fonts']): { fonts: FontPairId; saved: LookBackup['fonts'] } {
  const { value, saved: kept } = lookValue(look.fonts, current, saved);
  return { fonts: value, saved: kept };
}

export async function lookBackup(): Promise<LookBackup | null> {
  return parseLookBackup(await settings.get(LOOK_BACKUP_KEY).catch(() => null));
}

/**
 * The player layout `look` gives, keeping the switches a preset leaves alone (the clock) and the person's own
 * control scale, unless the Look sets a size of its own (Couch's large): the scale replaces the size, so keeping
 * it would undo the Look's. Restore puts it back from the snapshot.
 */
export const playerFor = (look: LookPreset, current: PlayerLayout): PlayerLayout => ({
  ...choosePreset(current, look.player.preset),
  ...look.player,
  ...(current.scale === undefined || look.player.size ? {} : { scale: current.scale }),
});

/** The side only matters beside the page, the alignment only in a bar across the top, and the place only for the floating pill. */
function sameNavPlace(a: LookPreset['nav'], b: LookPreset['nav']): boolean {
  if (a.position !== b.position) return false;
  if ((a.position === 'sidebar' || a.position === 'rail') && a.side !== b.side) return false;
  if ((a.position === 'top' || a.position === 'cinematic') && a.align !== b.align) return false;
  if (a.position === 'dock' && (a.place ?? 'bottom') !== (b.place ?? 'bottom')) return false;
  return true;
}

export interface LookState {
  theme: string;
  accent: AccentChoice;
  appearance: LookAppearance;
  scale: Scale;
  fonts: FontPairId;
  nav: LookPreset['nav'];
  player: PlayerLayout;
}

/** Whether every setting `look` sets holds its value (its theme's own accent included). */
export function matchesLook(look: LookPreset, state: LookState): boolean {
  const player = playerFor(look, state.player);
  return (
    state.theme === look.theme &&
    state.accent === THEME_ACCENT &&
    LOOK_FIELDS.every((key) => state.appearance[key] === look.appearance[key]) &&
    (look.scale === undefined || state.scale === look.scale) &&
    (look.fonts === undefined || state.fonts === look.fonts) &&
    sameNavPlace(look.nav, state.nav) &&
    state.player.preset === player.preset &&
    state.player.size === player.size &&
    state.player.scale === player.scale &&
    state.player.background === player.background
  );
}

/** The Look on screen, if the settings match one; the player's layout is the saved one, as it isn't kept in memory. */
export function activeLook(player: PlayerLayout): LookPreset | undefined {
  const state: LookState = { theme: currentThemeId(), accent: currentAccentChoice(), appearance: pickFields(appearance()), scale: appearance().scale, fonts: currentFonts(), nav: currentNavLayout(), player };
  return LOOKS.find((look) => matchesLook(look, state));
}

/**
 * What a field of `appearance` goes back to on "Reset this section": the
 * Look on screen's own value where it sets one (its scale included), so a
 * reset leaves the Look as freshly chosen rather than turning it into
 * "Custom"; Orbit's default for the rest, and for everything without a Look.
 */
export function lookDefault<K extends keyof Appearance>(look: LookPreset | undefined, field: K): Appearance[K] {
  if (look?.scale !== undefined && field === 'scale') return look.scale as Appearance[K];
  if (look && (LOOK_FIELDS as readonly string[]).includes(field)) return look.appearance[field as keyof LookAppearance] as Appearance[K];
  return APPEARANCE_DEFAULTS[field];
}

/** Applies `id`, keeping a snapshot of the settings it replaces unless an earlier Look already did. */
export async function applyLook(id: LookId): Promise<void> {
  const look = findLook(id);
  if (!look) return;
  const player = await loadPlayerLayout();
  const backup: LookBackup = (await lookBackup()) ?? { theme: currentThemeId(), accent: currentAccentChoice(), appearance: pickFields(appearance()), nav: currentNavLayout(), player };
  const scale = scaleFor(look, appearance().scale, backup.scale);
  const fonts = fontsFor(look, currentFonts(), backup.fonts);
  // Saved every time, as the scale and fonts it keeps come and go with the Look; the rest stays as before the first Look.
  await settings.set(LOOK_BACKUP_KEY, { ...backup, scale: scale.saved, fonts: fonts.saved });
  // The theme first: one of the person's own would bring its nav layout along, and the Look's must win.
  await chooseTheme(look.theme);
  const next = playerFor(look, player);
  await Promise.all([
    setAppearance({ ...look.appearance, scale: scale.scale }),
    setNavLayout({ ...currentNavLayout(), ...look.nav }),
    settings.set(PLAYER_LAYOUT_KEY, next),
    fonts.fonts === currentFonts() ? undefined : setFonts(fonts.fonts),
  ]);
  layoutChanged(next);
}

/** Puts the snapshot back and forgets it. Nothing happens without one. */
export async function restoreLook(): Promise<boolean> {
  const backup = await lookBackup();
  if (!backup) return false;
  // One of the person's own themes may have been deleted since: Orbit's own stands in, as when deleting the active theme.
  const theme = findPreset(backup.theme) || myThemes().some((own) => own.id === backup.theme) ? backup.theme : DEFAULT_PRESET.id;
  // Choosing the theme drops any picked accent, so the saved one goes back after it.
  await chooseTheme(theme);
  const scale = ownScale(appearance().scale, backup.scale);
  const fonts = ownValue(currentFonts(), backup.fonts);
  await Promise.all([
    setAccent(backup.accent),
    setAppearance({ ...backup.appearance, scale }),
    setNavLayout(backup.nav),
    settings.set(PLAYER_LAYOUT_KEY, backup.player),
    fonts === currentFonts() ? undefined : setFonts(fonts),
  ]);
  layoutChanged(backup.player);
  await settings.set(LOOK_BACKUP_KEY, null);
  return true;
}

/**
 * TV mode (tv.css: a stronger focus ring, and a margin a TV's overscan can't
 * crop) is on while the menu is Couch's sidebar and the player is Couch's TV
 * preset. Those two make a setup a TV one, so tweaking Couch's theme, posters
 * or scale afterwards keeps it, where "Couch is the active Look" would not.
 */
export function isTvSetup(nav: Pick<NavLayout, 'position'>, player: Pick<PlayerLayout, 'preset'>): boolean {
  const couch = findLook('couch');
  return !!couch && nav.position === couch.nav.position && player.preset === couch.player.preset;
}

/** Sets <html data-tv> now, and again whenever the menu's place or the player's layout changes. */
export async function startTvMode(): Promise<void> {
  let nav: Pick<NavLayout, 'position'> = currentNavLayout();
  let player: Pick<PlayerLayout, 'preset'> = await loadPlayerLayout();
  const sync = () => {
    document.documentElement.dataset.tv = isTvSetup(nav, player) ? 'on' : 'off';
  };
  document.addEventListener(NAV_LAYOUT_CHANGED, (event) => {
    nav = (event as CustomEvent<NavLayout>).detail;
    sync();
  });
  watchPlayerLayout((layout) => {
    player = layout;
    sync();
  });
  sync();
}
