/**
 * Appearance options beyond theme and accent (Settings → Appearance): accent
 * tint, ambient glow, title-page background, poster size and corners,
 * interface scale, and a wallpaper. Everything applies through CSS custom
 * properties and data attributes on <html> (CSSOM, so CSP-safe).
 */
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { settings } from '../lib/ipc';
import { isAndroid } from '../lib/platform';
import { POSTER_RATINGS, type PosterRatings } from '../lib/poster-ratings';
import { AUTO_EFFECTS_CHANGED, autoReason, probeFrameRate } from './auto-effects';

export const GLOW = { off: 0, subtle: 0.4, normal: 0.7, strong: 1 } as const;
export const DETAIL_BACKGROUNDS = ['normal', 'blur', 'color'] as const;
/** The title page: the hero card (Classic), or full-bleed art over sections (Showcase). */
export const DETAIL_LAYOUTS = ['classic', 'showcase'] as const;
/**
 * Home's (and Discover's) banner: a rounded card, full width behind the nav, a tall card led by the title's logo,
 * a carousel with the titles either side peeking in, or the art as a framed picture beside the text.
 */
export const HERO_STYLES = ['card', 'cinematic', 'spotlight', 'carousel', 'split'] as const;
/** How many titles Home's banner takes turns showing. */
export const HERO_COUNTS = [4, 5, 6, 7] as const;
export const POSTER_SIZES = { small: 128, standard: 156, large: 188 } as const;
export const CORNERS = { sharp: 4, classic: 12, round: 22 } as const;
export const SCALES = [80, 90, 100, 110, 125, 150] as const;
export const WALLPAPER_DIMS = { light: 0.35, medium: 0.6, heavy: 0.8 } as const;
/**
 * Card shape (Settings → Appearance): how titles are drawn wherever they're
 * browsed. A Home row given its own style in the Home builder keeps it; Top
 * 10 rows and Continue Watching keep their own look. Saved as `rowStyle`,
 * its name from when it only styled Home's rows.
 */
export const ROW_STYLE_DEFAULTS = ['poster', 'landscape'] as const;
export type CardShape = (typeof ROW_STYLE_DEFAULTS)[number];
/** 'system' follows Windows' animation setting. */
export const MOTIONS = ['system', 'reduce', 'full'] as const;
/** Where posters come from: the addon's (with Orbit's own scores on them), or RPDB's, with their key (catalog/rpdb.ts). */
export const POSTER_PROVIDERS = ['orbit', 'rpdb'] as const;
/** RPDB's poster styles (rpdb.rs has the same list). Free keys get the first only. */
export const RPDB_STYLES = ['poster-default', 'poster-certs', 'poster-mc', 'poster-rt', 'textless-default'] as const;
/**
 * 'reduced' drops blurs, glows and heavy shadows for weaker graphics cards
 * (tokens.css, styles.css); 'auto' does so on a low-end device (auto-effects.ts).
 * Settings call them Off, On and Auto.
 */
export const EFFECTS = ['full', 'reduced', 'auto'] as const;

export interface Appearance {
  /** Tint backgrounds with the accent colour. */
  tint: boolean;
  glow: keyof typeof GLOW;
  detailBackground: (typeof DETAIL_BACKGROUNDS)[number];
  detailLayout: (typeof DETAIL_LAYOUTS)[number];
  heroStyle: (typeof HERO_STYLES)[number];
  heroCount: (typeof HERO_COUNTS)[number];
  /** The cinematic banner only: Home's first row rises well into the banner's faded bottom (home.css). */
  heroOverlap: boolean;
  posterSize: keyof typeof POSTER_SIZES;
  /** Settings → Appearance → Card shape. */
  rowStyle: CardShape;
  corners: keyof typeof CORNERS;
  /** Percent. */
  scale: (typeof SCALES)[number];
  wallpaperDim: keyof typeof WALLPAPER_DIMS;
  /** The old "Hide spoilers" switch: only read once, as the starting point of a profile's spoiler settings (library/spoilers.ts). */
  spoilers: boolean;
  /** The old "Hide episode descriptions" switch: as above. */
  hideEpisodeDescriptions: boolean;
  /** List a long show's episodes by story arc where TMDB has arcs (Settings → Library & Metadata). */
  storyArcs: boolean;
  /** Show a title's logo artwork instead of its name on title pages (Settings → Library & Metadata). */
  logos: boolean;
  /** Show the best quality its sources offer (4K, HDR, Atmos…) on a title page (Settings → Appearance). */
  qualityBadges: boolean;
  /** Show a title's age rating (PG-13, TV-MA, 12…) beside its year on banners, title pages and the pause screen (Settings → Appearance). */
  ageRatings: boolean;
  /** Show regional streaming-provider logos in banner and title-page meta rows. */
  whereToWatch: boolean;
  /** Mark titles the profile finished on browsing cards (Settings → Home & Library). */
  watchedMarks: boolean;
  /** Save and ⋯ buttons on a card while it's pointed at or focused (Settings → Appearance → Cards; components/card-actions.ts). */
  cardActions: boolean;
  /** Name, year and genre under poster cards; off leaves just the posters (Settings → Appearance → Cards). */
  cardTitles: boolean;
  /** Scores drawn on posters (Settings → Appearance → Posters; lib/poster-ratings.ts). */
  posterRatings: PosterRatings;
  posterProvider: (typeof POSTER_PROVIDERS)[number];
  rpdbStyle: (typeof RPDB_STYLES)[number];
  motion: (typeof MOTIONS)[number];
  effects: (typeof EFFECTS)[number];
}

/** Out of the box (Settings → Reset this section puts these back). */
export const APPEARANCE_DEFAULTS: Appearance = { tint: false, glow: 'normal', detailBackground: 'normal', detailLayout: 'classic', heroStyle: 'card', heroCount: 5, heroOverlap: false, posterSize: 'standard', rowStyle: 'poster', corners: 'classic', scale: 100, wallpaperDim: 'medium', spoilers: true, hideEpisodeDescriptions: false, storyArcs: false, logos: true, qualityBadges: true, ageRatings: true, whereToWatch: true, watchedMarks: true, cardActions: true, cardTitles: true, posterRatings: 'minimal', posterProvider: 'orbit', rpdbStyle: 'poster-default', motion: 'system', effects: 'auto' };
const KEY = 'appearance';

let current: Appearance = APPEARANCE_DEFAULTS;
let wallpaperUrl: string | null = null;

export const appearance = (): Appearance => current;

/** Whether the effects are down: On, or Auto on a device that struggles with them (see auto-effects.ts). */
export const effectsReduced = (a: Pick<Appearance, 'effects'> = current): boolean => a.effects === 'reduced' || (a.effects === 'auto' && autoReason() !== null);

/** Whether to hold still: the setting, or Windows' animation setting when it's on System. */
export function reducedMotion(): boolean {
  return current.motion === 'reduce' || (current.motion === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** Keeps each saved field only if it's still a valid choice (saved values can come from a hand-edited backup). */
export function parseAppearance(value: unknown): Appearance {
  const saved = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const pick = <T>(key: keyof Appearance, valid: readonly T[]): T => (valid.includes(saved[key] as T) ? (saved[key] as T) : (APPEARANCE_DEFAULTS[key] as T));
  return {
    tint: saved.tint === true,
    glow: pick('glow', Object.keys(GLOW) as Appearance['glow'][]),
    detailBackground: pick('detailBackground', DETAIL_BACKGROUNDS),
    detailLayout: pick('detailLayout', DETAIL_LAYOUTS),
    heroStyle: pick('heroStyle', HERO_STYLES),
    heroCount: pick('heroCount', HERO_COUNTS),
    heroOverlap: saved.heroOverlap === true,
    posterSize: pick('posterSize', Object.keys(POSTER_SIZES) as Appearance['posterSize'][]),
    rowStyle: pick('rowStyle', ROW_STYLE_DEFAULTS),
    corners: pick('corners', Object.keys(CORNERS) as Appearance['corners'][]),
    scale: pick('scale', SCALES),
    wallpaperDim: pick('wallpaperDim', Object.keys(WALLPAPER_DIMS) as Appearance['wallpaperDim'][]),
    spoilers: saved.spoilers !== false,
    hideEpisodeDescriptions: saved.hideEpisodeDescriptions === true,
    storyArcs: saved.storyArcs === true,
    logos: saved.logos !== false,
    qualityBadges: saved.qualityBadges !== false,
    ageRatings: saved.ageRatings !== false,
    whereToWatch: saved.whereToWatch !== false,
    watchedMarks: saved.watchedMarks !== false,
    cardActions: saved.cardActions !== false,
    cardTitles: saved.cardTitles !== false,
    posterRatings: pick('posterRatings', POSTER_RATINGS),
    posterProvider: pick('posterProvider', POSTER_PROVIDERS),
    rpdbStyle: pick('rpdbStyle', RPDB_STYLES),
    motion: pick('motion', MOTIONS),
    effects: pick('effects', EFFECTS),
  };
}

function apply(a: Appearance, zoom = true): void {
  const root = document.documentElement;
  root.dataset.tint = a.tint ? 'on' : 'off';
  root.dataset.detailBackground = a.detailBackground;
  root.dataset.hero = a.heroStyle;
  root.dataset.heroOverlap = a.heroOverlap ? 'on' : 'off';
  root.dataset.motion = a.motion;
  root.dataset.effects = effectsReduced(a) ? 'reduced' : 'full';
  // Cards always carry their scores; this shows none, one or all of them (styles.css), so a change needs no redraw.
  root.dataset.posterRatings = a.posterRatings;
  root.dataset.cardActions = a.cardActions ? 'on' : 'off';
  root.dataset.cardText = a.cardTitles ? 'show' : 'hide';
  root.style.setProperty('--ambient-strength', String(GLOW[a.glow]));
  root.style.setProperty('--poster-width', `${POSTER_SIZES[a.posterSize]}px`);
  root.style.setProperty('--radius-card', `${CORNERS[a.corners]}px`);
  root.style.setProperty('--wallpaper-dim', String(WALLPAPER_DIMS[a.wallpaperDim]));
  if (!zoom) return;
  // Android's WebView has no zoom Tauri can set; CSS zoom scales layout and hit-testing alike there.
  if (isAndroid) {
    root.style.zoom = String(a.scale / 100);
    return;
  }
  // The webview's own zoom, so layout and hit-testing stay consistent.
  getCurrentWebview()
    .setZoom(a.scale / 100)
    .catch((err: unknown) => console.error('Could not set the interface scale', err));
}

export async function loadAppearance(): Promise<void> {
  current = parseAppearance(await settings.get(KEY).catch(() => null));
  apply(current);
  await loadWallpaper();
}

/** Measures the frame rate once Orbit is up, for Auto (see auto-effects.ts); a slow result turns the effects down. */
export function startAutoEffects(): void {
  document.addEventListener(AUTO_EFFECTS_CHANGED, () => apply(current, false));
  void probeFrameRate(() => current.effects === 'auto');
}

/** Dispatched on `document` when the card shape changes (Home redraws its rails; other cards follow, rooms/title-card.ts). */
export const ROW_STYLE_CHANGED = 'orbit:row-style-changed';

/** Dispatched on `document` when Ratings on posters changes (cards' descriptions follow, components/poster-scores.ts). */
export const POSTER_RATINGS_CHANGED = 'orbit:poster-ratings-changed';

export async function setAppearance(patch: Partial<Appearance>): Promise<void> {
  const { rowStyle, posterRatings } = current;
  current = { ...current, ...patch };
  apply(current);
  // As soon as the scores on screen change, not once saved.
  if (current.posterRatings !== posterRatings) document.dispatchEvent(new Event(POSTER_RATINGS_CHANGED));
  await settings.set(KEY, current);
  if (current.rowStyle !== rowStyle) document.dispatchEvent(new Event(ROW_STYLE_CHANGED));
}

/** Shows `patch` over the saved appearance without saving it (Theme Studio's live preview). */
export function previewAppearance(patch: Partial<Appearance>): void {
  apply({ ...current, ...patch }, false);
}

/** Shows the saved wallpaper, if any. */
async function loadWallpaper(): Promise<void> {
  const bytes = await invoke<ArrayBuffer>('wallpaper_get').catch(() => new ArrayBuffer(0));
  if (wallpaperUrl) URL.revokeObjectURL(wallpaperUrl);
  wallpaperUrl = bytes.byteLength ? URL.createObjectURL(new Blob([bytes])) : null;
  const root = document.documentElement;
  root.dataset.wallpaper = wallpaperUrl ? 'on' : 'off';
  // A blob: URL Orbit made itself, so nothing in it needs escaping.
  if (wallpaperUrl) root.style.setProperty('--wallpaper', `url("${wallpaperUrl}")`);
  else root.style.removeProperty('--wallpaper');
}

export const hasWallpaper = () => document.documentElement.dataset.wallpaper === 'on';

/** Saves `file` as the wallpaper (Rust checks it's a PNG, JPEG or WebP). */
export async function setWallpaper(file: File): Promise<void> {
  await invoke('wallpaper_set', new Uint8Array(await file.arrayBuffer()));
  await loadWallpaper();
}

export async function clearWallpaper(): Promise<void> {
  await invoke('wallpaper_clear');
  await loadWallpaper();
}
