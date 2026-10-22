/**
 * The dominant hue of a piece of artwork, for the ambient glow behind pages.
 * Images are sampled at 24×24 on a canvas. Anything that fails, or artwork
 * with no real colour (black-and-white films), yields `null`.
 */
import { invoke } from '@tauri-apps/api/core';

const SAMPLE = 24;
/** Hues by artwork address; the oldest go past `MAX_CACHED`, so days of browsing don't grow it without end. */
const cache = new Map<string, Promise<number | null>>();
const MAX_CACHED = 500;
/** What `sample` throws when the artwork couldn't be fetched (rather than read). */
const NOT_FETCHED = new Error('artwork not fetched');

/** Averages the hue of reasonably saturated, mid-brightness pixels (RGBA bytes). */
export function dominantHue(rgba: ArrayLike<number>): number | null {
  let x = 0;
  let y = 0;
  let weight = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]! / 255;
    const g = rgba[i + 1]! / 255;
    const b = rgba[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    // Skip greys and near-black/near-white pixels: their hue is noise.
    if (chroma < 0.12 || max < 0.15 || min > 0.9) continue;
    let hue: number;
    if (max === r) hue = ((g - b) / chroma) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    const radians = (hue * 60 * Math.PI) / 180;
    // Hue is circular, so average it as a vector weighted by colourfulness.
    x += Math.cos(radians) * chroma;
    y += Math.sin(radians) * chroma;
    weight += chroma;
  }
  // Too few colourful pixels to call it (e.g. a black-and-white still).
  if (weight < (rgba.length / 4) * 0.02) return null;
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((degrees + 360) % 360);
}

/**
 * Image hosts often redirect without CORS headers, which stops the canvas
 * reading cross-origin pixels, so Rust fetches the bytes (`art_fetch`, under
 * the addon network rules) and the canvas reads them from a same-origin
 * `blob:` URL instead.
 */
async function sample(url: string): Promise<number | null> {
  const bytes = await invoke<ArrayBuffer>('art_fetch', { url: sampleUrl(url) }).catch(() => {
    throw NOT_FETCHED;
  });
  // Decoded straight to the sample size: a full backdrop decode costs tens of MB for 24×24 pixels.
  const bitmap = await createImageBitmap(new Blob([bytes]), { resizeWidth: SAMPLE, resizeHeight: SAMPLE, resizeQuality: 'low' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, SAMPLE, SAMPLE);
    return dominantHue(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data);
  } finally {
    bitmap.close();
  }
}

/** TMDB serves every image in several sizes; the smallest backdrop has the same colours as the largest. */
export function sampleUrl(url: string): string {
  return url.replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)(?:w\d+|original)\//, '$1w300/');
}

export function artHue(url: string): Promise<number | null> {
  let hue = cache.get(url);
  if (!hue) {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    // A fetch that fails (offline, the network still waking after sleep) isn't kept: the next look asks again.
    const found: Promise<number | null> = sample(url).catch((err: unknown) => {
      if (err === NOT_FETCHED && cache.get(url) === found) cache.delete(url);
      return null;
    });
    hue = found;
    cache.set(url, hue);
  }
  return hue;
}
