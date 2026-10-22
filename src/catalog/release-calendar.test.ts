import { describe, expect, it } from 'vitest';
import { calendarDay, calendarFilms, DEFAULT_CALENDAR_FILTER, filmReleases, parseCalendarFilter } from './release-calendar';

const film = (id: string, year?: string) => ({ id, type: 'movie', ...(year ? { year } : {}) });
const today = new Date(2026, 9, 5);

describe('calendar filter', () => {
  it('reads saved filters and falls back to showing everything', () => {
    expect(parseCalendarFilter(null)).toEqual(DEFAULT_CALENDAR_FILTER);
    expect(parseCalendarFilter('movies')).toEqual(DEFAULT_CALENDAR_FILTER);
    expect(parseCalendarFilter({ show: 'movies', kinds: ['physical', 'cinema', 'cinema', 'vhs'] })).toEqual({ scope: 'for-you', show: 'movies', kinds: ['cinema', 'physical'] });
    expect(parseCalendarFilter({ show: 'films', kinds: [] })).toEqual({ scope: 'for-you', show: 'all', kinds: [] });
    expect(parseCalendarFilter({ show: 'episodes' })).toEqual({ scope: 'for-you', show: 'episodes', kinds: ['cinema', 'digital', 'physical'] });
    // The Radar's scope; a filter saved before it had one shows yours.
    expect(parseCalendarFilter({ scope: 'everything', show: 'all', kinds: [] })).toEqual({ scope: 'everything', show: 'all', kinds: [] });
    expect(parseCalendarFilter({ scope: 'friends', show: 'all', kinds: [] }).scope).toBe('for-you');
  });
});

describe('which saved films are looked up', () => {
  it('keeps recent films with IMDb ids, once each, in order', () => {
    const titles = [film('tt1', '2026'), { id: 'tt2', type: 'series', year: '2026' }, film('tt3', '2025'), film('tt4', '2024'), film('kitsu:5', '2026'), film('tt6'), film('tt1', '2026'), film('tt7', '2027')];
    expect(calendarFilms(titles, today).map((t) => t.id)).toEqual(['tt1', 'tt3', 'tt6', 'tt7']);
    expect(calendarFilms(titles, today, 2).map((t) => t.id)).toEqual(['tt1', 'tt3']);
  });
});

describe('release days', () => {
  it('reads calendar days as local midnight', () => {
    expect(calendarDay('2026-10-05')).toEqual(today);
    expect(calendarDay('2026-02-30')).toBeNull();
    expect(calendarDay('2026-10-05T00:00:00Z')).toBeNull();
  });

  it('keeps releases of the films asked about, by day', () => {
    const found = filmReleases(
      [{ id: 'tt1' }, { id: 'tt2' }],
      [
        { id: 'tt2', releases: [{ kind: 'digital', date: '2026-11-01' }] },
        { id: 'tt1', releases: [{ kind: 'cinema', date: '2026-10-01' }, { kind: 'physical', date: 'soon' }] },
        { id: 'tt9', releases: [{ kind: 'cinema', date: '2026-10-02' }] },
      ],
    );
    expect(found.map((r) => [r.title.id, r.kind, r.day.getDate()])).toEqual([
      ['tt1', 'cinema', 1],
      ['tt2', 'digital', 1],
    ]);
  });
});
