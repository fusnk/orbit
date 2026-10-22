/**
 * Times of day as the person wants them (Settings → General → Clock):
 * as their language and region write them ("System"), or always 12-hour or
 * 24-hour. Every clock (the player's too) formats through here, so the
 * setting reaches all of them.
 */
import { locale } from '../i18n';
import { settings } from './ipc';

export const CLOCK_KEY = 'general.clock';
export const CLOCKS = ['system', '12', '24'] as const;
export type Clock = (typeof CLOCKS)[number];

export const parseClock = (value: unknown): Clock => (CLOCKS.includes(value as Clock) ? (value as Clock) : 'system');

let choice: Clock = 'system';
export const clockChoice = (): Clock => choice;

/** The Intl options for the choice: none for System, else the hour cycle asked for. */
export function hourCycleOptions(clock: Clock): Intl.DateTimeFormatOptions {
  if (clock === '12') return { hourCycle: 'h12' };
  if (clock === '24') return { hourCycle: 'h23' };
  return {};
}

const cache = new Map<string, Intl.DateTimeFormat>();

/** A time-of-day formatter: "11:32 PM" or "23:32" ("23" or "11 PM" with `hourOnly`). */
export function clockFormat(hourOnly = false, tag: string = locale()): Intl.DateTimeFormat {
  const key = `${tag}|${choice}|${hourOnly}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(tag, { hour: 'numeric', ...(hourOnly ? {} : { minute: '2-digit' }), ...hourCycleOptions(choice) });
    cache.set(key, format);
  }
  return format;
}

/** A time of day, e.g. "11:32 PM", as the Clock setting says. */
export const formatClock = (at: Date | number): string => clockFormat().format(at);

/** Whether times show as 12-hour ones (with AM and PM). */
export const usesTwelveHour = (tag: string = locale()): boolean => clockFormat(true, tag).resolvedOptions().hour12 === true;

export async function loadClock(): Promise<void> {
  choice = parseClock(await settings.get(CLOCK_KEY).catch(() => null));
}

export async function setClock(next: Clock): Promise<void> {
  choice = next;
  await settings.set(CLOCK_KEY, next);
}
