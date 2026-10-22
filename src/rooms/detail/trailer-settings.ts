/** Settings → Video: the trailers behind title pages and the Home and Discover banners. */

export const HERO_TRAILER_KEY = 'video.hero-trailer';
export const BANNER_TRAILER_KEY = 'video.banner-trailers';
export const TRAILER_DELAY_KEY = 'video.trailer-delay';
export const TRAILER_SOUND_KEY = 'video.trailer-sound';

/** How long a trailer waits before it starts, in seconds. The first, the default, is what it always waited. */
export const TRAILER_DELAYS = [1.5, 3, 5] as const;
export type TrailerDelay = (typeof TRAILER_DELAYS)[number];

export function parseTrailerDelay(value: unknown): TrailerDelay {
  return TRAILER_DELAYS.find((delay) => delay === value) ?? TRAILER_DELAYS[0];
}

export const trailerDelayMs = (value: unknown): number => parseTrailerDelay(value) * 1000;

/** Whether trailers start with their sound on; muted unless the person chose it. */
export const trailerSound = (value: unknown): boolean => value === true;
