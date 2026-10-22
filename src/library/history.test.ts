import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import type { Title } from '../catalog/titles';
import { dayKey, dayLabel, filterHistory, groupByDay, historyEntries } from './history';
import type { Progress } from './watch';

const show: Title = { id: 'tt1', type: 'series', name: 'Café Society', genres: [], origins: [] };
const other: Title = { id: 'tt2', type: 'series', name: 'Other Show', genres: [], origins: [] };
const film: Title = { id: 'tt3', type: 'movie', name: 'Film', genres: [], origins: [] };
const file: Title = { id: 'local:abcdef0123456789', type: 'movie', name: 'Holiday', genres: [], origins: [] };

/** A local time on 5 October 2026 (or `day` days later). */
const at = (hour: number, minute = 0, day = 0) => new Date(2026, 9, 5 + day, hour, minute).getTime();

const episode = (title: Title, season: number, number: number, when: number): { row: Progress; title: Title } => ({
  row: { videoId: `${title.id}:${season}:${number}`, titleId: title.id, season, episode: number, position: 1200, duration: 1300, watched: true, updatedAt: when },
  title,
});
const movie = (title: Title, when: number): { row: Progress; title: Title } => ({
  row: { videoId: title.id, titleId: title.id, season: null, episode: null, position: 3000, duration: 6000, watched: false, updatedAt: when },
  title,
});

describe('watch history', () => {
  it('lists newest first and collapses episodes of one show watched one after another on a day', () => {
    const entries = historyEntries([
      episode(show, 1, 1, at(20)),
      episode(show, 1, 2, at(21)),
      episode(show, 1, 3, at(22)),
      movie(film, at(23)),
      episode(show, 1, 4, at(23, 30)),
    ]);
    expect(entries.map((e) => [e.title.id, e.rows.map((r) => r.videoId)])).toEqual([
      ['tt1', ['tt1:1:4']],
      ['tt3', ['tt3']],
      // Newest first within the entry.
      ['tt1', ['tt1:1:3', 'tt1:1:2', 'tt1:1:1']],
    ]);
    expect(entries[2]!.at).toBe(at(22));
  });

  it("doesn't collapse across days, or around another show", () => {
    const entries = historyEntries([episode(show, 1, 1, at(23, 50)), episode(show, 1, 2, at(0, 10, 1)), episode(other, 1, 1, at(1, 0, 1)), episode(show, 1, 3, at(2, 0, 1))]);
    expect(entries.map((e) => e.rows.length)).toEqual([1, 1, 1, 1]);
  });

  it('marks files, which can only be removed', () => {
    const [entry] = historyEntries([movie(file, at(10))]);
    expect(entry!.file).toBe(true);
    expect(historyEntries([movie(film, at(10))])[0]!.file).toBe(false);
  });

  it('groups by day with Today, Yesterday, weekdays, then dates', () => {
    const now = at(12);
    expect(dayLabel(at(1), now, 'en-US')).toBe('Today');
    expect(dayLabel(at(23, 59, -1), now, 'en-US')).toBe('Yesterday');
    expect(dayLabel(at(9, 0, -3), now, 'en-US')).toBe('Friday');
    expect(dayLabel(at(9, 0, -7), now, 'en-US')).toBe('Monday, September 28');
    expect(dayLabel(new Date(2025, 11, 31, 9).getTime(), now, 'en-US')).toBe('December 31, 2025');
    // Dates follow the interface's language.
    expect(dayLabel(at(9, 0, -3), now, 'fr-FR')).toBe('vendredi');

    const days = groupByDay(historyEntries([movie(film, at(9)), episode(show, 1, 1, at(8)), episode(other, 1, 1, at(22, 0, -1))]), now, 'en-US');
    expect(days.map((d) => [d.key, d.label, d.entries.length])).toEqual([
      [dayKey(at(9)), 'Today', 2],
      [dayKey(at(22, 0, -1)), 'Yesterday', 1],
    ]);
  });

  it('filters by name, ignoring case and accents', () => {
    const entries = historyEntries([episode(show, 1, 1, at(9)), movie(film, at(10))]);
    expect(filterHistory(entries, 'cafe').map((e) => e.title.id)).toEqual(['tt1']);
    expect(filterHistory(entries, '  FILM ').map((e) => e.title.id)).toEqual(['tt3']);
    expect(filterHistory(entries, '')).toHaveLength(2);
  });
});
