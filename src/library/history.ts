/**
 * My Library → History: what was watched, newest first, grouped by day.
 * Consecutive episodes of one show on the same day are one entry ("3
 * episodes"). Built from the progress rows in watch.ts, each stamped with
 * when it was last watched.
 */
import type { Title } from '../catalog/titles';
import { t } from '../i18n';
import { isLocalId } from '../lib/local-media';
import type { Progress } from './watch';

export interface HistoryEntry {
  /** Stable while the entry exists (its newest row's video id). */
  key: string;
  title: Title;
  /** When its newest movie or episode was watched (ms). */
  at: number;
  /** Its rows, newest first: one for a movie, one or more episodes of the same show. */
  rows: Progress[];
  /** A file (on this PC or untitled in the cloud): it can't be opened or played again from here. */
  file: boolean;
}

export interface HistoryDay {
  /** Local date, e.g. "2026-10-05". */
  key: string;
  label: string;
  entries: HistoryEntry[];
}

const pad = (n: number) => String(n).padStart(2, '0');
/** The local calendar day of `at`, as "yyyy-mm-dd". */
export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const isEpisode = (row: Progress) => row.season !== null && row.episode !== null;

/** Rows (with their titles) as history entries, newest first; episodes of one show watched one after another on a day are one entry. */
export function historyEntries(rows: readonly { row: Progress; title: Title }[]): HistoryEntry[] {
  const sorted = [...rows].sort((a, b) => b.row.updatedAt - a.row.updatedAt || a.row.videoId.localeCompare(b.row.videoId));
  const entries: HistoryEntry[] = [];
  for (const { row, title } of sorted) {
    const last = entries[entries.length - 1];
    if (last && last.title.id === row.titleId && isEpisode(row) && isEpisode(last.rows[0]!) && dayKey(last.at) === dayKey(row.updatedAt)) {
      last.rows.push(row);
      continue;
    }
    entries.push({ key: row.videoId, title, at: row.updatedAt, rows: [row], file: isLocalId(row.titleId) });
  }
  return entries;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", a weekday within the last week, then a date (with the year when it's another year). */
export function dayLabel(at: number, now: number, tag: string): string {
  const day = new Date(at);
  const today = new Date(now);
  // Calendar days apart, counted at noon so a daylight-saving change doesn't skew it.
  const noon = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
  const days = Math.round((noon(today) - noon(day)) / DAY_MS);
  if (days === 0) return t('insights.history.today');
  if (days === 1) return t('insights.history.yesterday');
  if (days > 1 && days < 7) return new Intl.DateTimeFormat(tag, { weekday: 'long' }).format(day);
  const sameYear = day.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat(tag, sameYear ? { weekday: 'long', month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric', year: 'numeric' }).format(day);
}

/** Entries by local day, newest day first (entries keep their order). */
export function groupByDay(entries: readonly HistoryEntry[], now: number, tag: string): HistoryDay[] {
  const days: HistoryDay[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.at);
    const last = days[days.length - 1];
    if (last?.key === key) last.entries.push(entry);
    else days.push({ key, label: dayLabel(entry.at, now, tag), entries: [entry] });
  }
  return days;
}

/** Entries whose title's name holds `query` (any case and accents). */
export function filterHistory(entries: readonly HistoryEntry[], query: string): HistoryEntry[] {
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const wanted = fold(query.trim());
  return wanted ? entries.filter((e) => fold(e.title.name).includes(wanted)) : [...entries];
}
