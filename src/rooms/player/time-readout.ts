/**
 * The time beside the seek bar. Clicking it cycles: time left, elapsed of
 * the total, then time left with when it'll finish ("Finish at 10:41 PM",
 * in the person's own clock format, allowing for the playback speed). The
 * choice is remembered.
 */
import { t } from '../../i18n';
import { clockFormat } from '../../lib/clock';
import { formatTime } from './format';

export const TIME_MODES = ['remaining', 'elapsed', 'finish'] as const;
export type TimeMode = (typeof TIME_MODES)[number];
export const TIME_MODE_KEY = 'player.time-mode';

export const parseTimeMode = (value: unknown): TimeMode => TIME_MODES.find((m) => m === value) ?? 'remaining';
export const nextTimeMode = (mode: TimeMode): TimeMode => TIME_MODES[(TIME_MODES.indexOf(mode) + 1) % TIME_MODES.length]!;

/** When playback ends, in milliseconds since the epoch, at this speed. */
export function finishTime(now: number, position: number, duration: number, speed: number): number {
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return now + (Math.max(0, duration - position) / rate) * 1000;
}

/** A clock time as the locale writes it ("10:41 PM", "22:41"), or 12/24-hour as the Clock setting asks, like every other clock. */
export const clockTime = (at: number, locale: string) => clockFormat(false, locale).format(at);

/** What the readout says. Without a duration (a live channel) it's just the position. */
export function timeReadout(mode: TimeMode, position: number, duration: number, speed: number, now: number, locale: string): string {
  if (!duration) return formatTime(position);
  const left = `-${formatTime(Math.max(0, duration - position))}`;
  switch (mode) {
    case 'remaining':
      return left;
    case 'elapsed':
      return `${formatTime(position)} / ${formatTime(duration)}`;
    case 'finish':
      return t('playerplus.time.finish', { left, time: clockTime(finishTime(now, position, duration, speed), locale) });
  }
}
