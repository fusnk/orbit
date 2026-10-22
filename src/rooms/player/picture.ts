/**
 * How the picture looks: a quality preset (how mpv scales and cleans up the
 * picture, Settings → Video) and adjustments (brightness, contrast,
 * saturation, gamma: mpv's equalizer, also in the player's Playback &
 * picture panel), with one-tap looks that set the adjustments. Both are per
 * device: they depend on the screen and GPU, not on who's watching.
 */

/** Settings → Video → Picture quality: 'fast', 'balanced' (default) or 'high'. */
export const PICTURE_QUALITY_KEY = 'video.quality';
export const PICTURE_QUALITIES = ['fast', 'balanced', 'high'] as const;
export type PictureQuality = (typeof PICTURE_QUALITIES)[number];

/** The saved preset, or 'balanced' (what Orbit did before presets existed). */
export const parsePictureQuality = (value: unknown): PictureQuality => PICTURE_QUALITIES.find((q) => q === value) ?? 'balanced';

/** The adjustments, as `{ brightness, contrast, saturation, gamma }`. */
export const PICTURE_KEY = 'player.picture';
/** The look chosen before adjustments existed: 'original', 'vivid' or 'cinematic'. Read once, to carry it over. */
export const LEGACY_LOOK_KEY = 'player.look';

export const PICTURE_FIELDS = ['brightness', 'contrast', 'saturation', 'gamma'] as const;
export type PictureField = (typeof PICTURE_FIELDS)[number];
export type Picture = Record<PictureField, number>;

/** mpv's range for each; 0 is the picture as the file has it. */
export const PICTURE_MIN = -100;
export const PICTURE_MAX = 100;

export const NEUTRAL: Picture = { brightness: 0, contrast: 0, saturation: 0, gamma: 0 };

/** The old looks, as the values they sent to mpv, so whoever chose one keeps it. */
const LEGACY_LOOKS: Record<string, Picture> = {
  original: NEUTRAL,
  vivid: { brightness: 1, contrast: 6, saturation: 18, gamma: 0 },
  cinematic: { brightness: -1, contrast: 5, saturation: -6, gamma: -4 },
};

/** One-tap looks. Gentle values: mpv's equalizer clips quickly past about ±25. */
export const LOOKS = ['brighten', 'punchy', 'gentle', 'crisp'] as const;
export type LookId = (typeof LOOKS)[number];
export const LOOK_VALUES: Record<LookId, Picture> = {
  // Lifts the shadows (gamma) more than the whole picture, so blacks stay black-ish.
  brighten: { brightness: 3, contrast: 0, saturation: 4, gamma: 14 },
  punchy: { brightness: 0, contrast: 8, saturation: 22, gamma: 0 },
  // Dimmer and softer, for a dark room.
  gentle: { brightness: -6, contrast: -6, saturation: -12, gamma: 0 },
  // Firmer lines and cleaner flat colour, as in animation.
  crisp: { brightness: 0, contrast: 10, saturation: 12, gamma: -3 },
};

/** A whole number in mpv's range; anything else is 0. */
export function clampAdjustment(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(PICTURE_MIN, Math.min(PICTURE_MAX, Math.round(value)));
}

/**
 * The saved adjustments. With none saved yet, the old look's values (so a
 * Vivid or Cinematic choice carries over); otherwise neutral.
 */
export function parsePicture(value: unknown, legacyLook?: unknown): Picture {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const saved = value as Record<string, unknown>;
    return Object.fromEntries(PICTURE_FIELDS.map((field) => [field, clampAdjustment(saved[field])])) as Picture;
  }
  return { ...(typeof legacyLook === 'string' && Object.hasOwn(LEGACY_LOOKS, legacyLook) ? LEGACY_LOOKS[legacyLook]! : NEUTRAL) };
}

/** The look `picture` is exactly, 'neutral' for no adjustments, or undefined when it's the person's own mix. */
export function lookOf(picture: Picture): LookId | 'neutral' | undefined {
  const same = (other: Picture) => PICTURE_FIELDS.every((field) => picture[field] === other[field]);
  if (same(NEUTRAL)) return 'neutral';
  return LOOKS.find((look) => same(LOOK_VALUES[look]));
}
