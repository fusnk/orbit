/**
 * Playback speed choices: the presets the Speed view offers as pills, and
 * the Custom stepper's range and step (Rust accepts 0.25–4×, see
 * `player_set_speed`). Speed isn't saved: it starts at 1× whenever a title
 * is opened, and carries across that title's episodes and sources while the
 * player stays open (mpv keeps it from file to file).
 */

import { locale } from '../../i18n';

export const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const CUSTOM_MIN = 0.25;
export const CUSTOM_MAX = 3;
export const CUSTOM_STEP = 0.05;

/** A speed as mpv may report it (1.3500000001), to two decimals. */
export const roundSpeed = (speed: number) => Math.round(speed * 100) / 100;

/** Whether `speed` is one of the pills. */
export const isPreset = (speed: number) => SPEED_PRESETS.some((p) => Math.abs(p - speed) < 0.005);

/** One Custom step slower (-1) or faster (1), kept to the range and the 0.05 grid. */
export function stepSpeed(current: number, direction: 1 | -1): number {
  const steps = current / CUSTOM_STEP;
  const nearest = Math.round(steps);
  // Off the grid (e.g. 1.33× from elsewhere), the first step lands on it in that direction.
  const next = Math.abs(steps - nearest) < 0.01 ? nearest + direction : direction > 0 ? Math.ceil(steps) : Math.floor(steps);
  return roundSpeed(Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, next * CUSTOM_STEP)));
}

/** "1.35×", with the language's decimal mark ("1,35×" in German). */
export const speedLabel = (speed: number) => `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(roundSpeed(speed))}×`;

/**
 * The next pill speed slower (-1) or faster (1) than `current`, for the
 * speed keys (`<` and `>`); from a speed between pills, the nearest one that
 * way. At either end it stays where it is.
 */
export function presetStep(current: number, direction: 1 | -1): number {
  const ordered = direction > 0 ? SPEED_PRESETS : [...SPEED_PRESETS].reverse();
  return ordered.find((p) => (direction > 0 ? p > current + 0.005 : p < current - 0.005)) ?? roundSpeed(current);
}
