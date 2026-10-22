/**
 * The player's seek bar, styled (Theme Studio → Look, Settings → Appearance):
 * the bar's pattern, height and colour or a tiled picture, the buffered part,
 * and the dot's shape and size or a picture of its own. Applied as data
 * attributes and custom properties on <html> (seekbar.css), so the player's
 * seek bar (rooms/player/transport.ts) stays as it is.
 *
 * Pictures are saved by Rust (theme_images.rs) and a style keeps only their
 * names; they're read back as blob: URLs, which the CSP's img-src allows.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { parseHex } from './accent';
import './seekbar.css';

export const SEEK_STYLES = ['flat', 'glass', 'pinstripe', 'rainbow'] as const;
export const SEEK_DOTS = ['circle', 'square', 'image', 'hidden'] as const;
export const SEEK_HEIGHT = { min: 2, max: 14 } as const;
export const SEEK_DOT_SIZE = { min: 8, max: 36 } as const;
/** How bright the buffered part is, as a percentage of white over the bar. */
export const SEEK_BUFFERED = { min: 10, max: 80 } as const;
/** Ready-made bar colours beside "Accent" and a custom one. */
export const SEEK_SWATCHES = ['#ffffff', '#ff4d6d', '#ffb020', '#3ddc84', '#3e9bff', '#a970ff'] as const;
/** Same cap as uploaded profile pictures (Rust checks it too). */
export const SEEK_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const SEEK_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

export interface SeekBar {
  style: (typeof SEEK_STYLES)[number];
  height: number;
  /** null follows the accent. */
  color: string | null;
  /** A saved picture's name, tiled along the bar instead of the colour. */
  barImage: string | null;
  buffered: boolean;
  bufferedBrightness: number;
  dot: (typeof SEEK_DOTS)[number];
  dotSize: number;
  dotImage: string | null;
}

/** Orbit's own seek bar, exactly as it looked before it could be styled. */
export const DEFAULT_SEEK_BAR: SeekBar = { style: 'flat', height: 4, color: null, barImage: null, buffered: true, bufferedBrightness: 30, dot: 'circle', dotSize: 14, dotImage: null };

const imageName = v.nullable(v.pipe(v.string(), v.regex(/^upload-[0-9a-f]{16}$/)));
const whole = (range: { min: number; max: number }) => v.pipe(v.number(), v.integer(), v.minValue(range.min), v.maxValue(range.max));

export const SeekBarSchema = v.object({
  style: v.picklist(SEEK_STYLES),
  height: whole(SEEK_HEIGHT),
  color: v.nullable(
    v.pipe(
      v.string(),
      v.maxLength(9),
      v.transform((value) => parseHex(value)),
      v.string(),
    ),
  ),
  barImage: imageName,
  buffered: v.boolean(),
  bufferedBrightness: whole(SEEK_BUFFERED),
  dot: v.picklist(SEEK_DOTS),
  dotSize: whole(SEEK_DOT_SIZE),
  dotImage: imageName,
});

/** A saved style, or Orbit's own when it isn't valid (settings can come from a hand-edited backup). */
export function parseSeekBar(value: unknown): SeekBar {
  const parsed = v.safeParse(SeekBarSchema, value);
  return parsed.success ? parsed.output : { ...DEFAULT_SEEK_BAR };
}

/** Without its pictures, which are files on this PC (a shared theme can't carry them). */
export function withoutImages(bar: SeekBar): SeekBar {
  return { ...bar, barImage: null, dotImage: null, dot: bar.dot === 'image' ? 'circle' : bar.dot };
}

export const seekImages = (bar: SeekBar): string[] => [bar.barImage, bar.dotImage].filter((name): name is string => !!name);

const urls = new Map<string, Promise<string | null>>();

/** A saved picture as a blob: URL (read once from Rust, then kept). */
export function seekImageUrl(name: string): Promise<string | null> {
  let url = urls.get(name);
  if (!url) {
    url = invoke<ArrayBuffer>('theme_image_get', { name })
      .then((bytes) => (bytes.byteLength ? URL.createObjectURL(new Blob([bytes])) : null))
      .catch(() => null);
    urls.set(name, url);
  }
  return url;
}

/** Saves a picture for the seek bar and returns its name (Rust checks its size and first bytes). */
export async function uploadSeekImage(file: File): Promise<string> {
  const name = await invoke<string>('theme_image_save', new Uint8Array(await file.arrayBuffer()));
  urls.set(name, Promise.resolve(URL.createObjectURL(file)));
  return name;
}

/** Forgets saved pictures nothing uses any more, with their blob: URLs (each holds its image until revoked). */
export function pruneSeekImages(keep: readonly string[]): Promise<void> {
  const kept = new Set(keep);
  for (const [name, url] of urls) {
    if (kept.has(name)) continue;
    urls.delete(name);
    void url.then((src) => src && URL.revokeObjectURL(src));
  }
  return invoke('theme_image_prune', { keep: [...kept] });
}

let applied = 0;

/** Sent with the style each time one is drawn (saved, chosen, or previewed in Theme Studio), so Settings' colour rows follow. */
export const SEEKBAR_SHOWN = 'orbit:seekbar-shown';

/** Draws `bar` on every seek bar (and the previews of it). */
export function applySeekBar(bar: SeekBar): void {
  const root = document.documentElement;
  const run = ++applied;
  document.dispatchEvent(new CustomEvent<SeekBar>(SEEKBAR_SHOWN, { detail: bar }));
  root.dataset.seek = bar.style;
  root.dataset.seekDot = bar.dot;
  root.dataset.seekBuffered = bar.buffered ? 'on' : 'off';
  root.style.setProperty('--seek-height', `${bar.height}px`);
  root.style.setProperty('--seek-dot-size', `${bar.dotSize}px`);
  root.style.setProperty('--seek-buffered-alpha', String(bar.bufferedBrightness / 100));
  if (bar.color) root.style.setProperty('--seek-color', bar.color);
  else root.style.removeProperty('--seek-color');
  const picture = (name: string | null, property: string, flag: 'seekImage' | 'seekDotImage') => {
    if (!name) {
      root.style.removeProperty(property);
      root.dataset[flag] = 'off';
      return;
    }
    void seekImageUrl(name).then((url) => {
      // A later style won the race.
      if (run !== applied) return;
      // A blob: URL Orbit made itself, so nothing in it needs escaping.
      if (url) root.style.setProperty(property, `url("${url}")`);
      root.dataset[flag] = url ? 'on' : 'off';
    });
  };
  picture(bar.barImage, '--seek-bar-image', 'seekImage');
  picture(bar.dot === 'image' ? bar.dotImage : null, '--seek-dot-image', 'seekDotImage');
}
