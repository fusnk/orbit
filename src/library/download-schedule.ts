/**
 * Settings → Downloads: the speed limit and "Only download between", as
 * saved. Rust applies them (src-tauri/src/downloads/schedule.rs); the page
 * sends them, with its offset from UTC, through `applyDownloadSchedule`.
 */
import { clockChoice, hourCycleOptions, usesTwelveHour } from '../lib/clock';
import { locale } from '../i18n';

export const SPEED_LIMIT_KEY = 'downloads.speed-limit';
export const WINDOW_KEY = 'downloads.window';

/** MB/s; 0 is no limit. Kept in step with `LIMITS_MB` in schedule.rs. */
export const SPEED_LIMITS = [0, 1, 2, 5, 10, 20, 50] as const;
export type SpeedLimit = (typeof SPEED_LIMITS)[number];
export const parseSpeedLimit = (value: unknown): SpeedLimit => SPEED_LIMITS.find((n) => n === value) ?? 0;

/** Whole hours of local time, from `start` up to `end`; an end before the start runs past midnight. */
export interface DownloadWindow {
  start: number;
  end: number;
}

/** What the window starts as when turned on: the small hours. */
export const DEFAULT_WINDOW: DownloadWindow = { start: 1, end: 7 };

const isHour = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 24;

/** The saved window, or null (any time) when it's off or junk. */
export function parseWindow(value: unknown): DownloadWindow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { start, end } = value as Record<string, unknown>;
  return isHour(start) && isHour(end) ? { start, end } : null;
}

/** An hour moved by `delta`, round the clock. */
export const stepHour = (hour: number, delta: number): number => (((hour + delta) % 24) + 24) % 24;

/** "01:00" or "1:00 AM", as the interface's language writes times. */
export function hourLabel(hour: number, tag: string = locale()): string {
  // Two-digit hours on a 24-hour clock ("01:00"), but "1:00 AM" rather than "01:00 AM".
  // The Clock setting (Settings → General) decides 12 or 24 hours.
  const twelve = usesTwelveHour(tag);
  return new Intl.DateTimeFormat(tag, { hour: twelve ? 'numeric' : '2-digit', minute: '2-digit', ...hourCycleOptions(clockChoice()) }).format(new Date(2000, 0, 1, hour, 0));
}
