import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR_FILTER, type CalendarFilter } from './release-calendar';
import { chipUntil, comingSoon, dayOffset, upcomingCount, featuredRelease, isOut, premiere, radarReleases, shortUntil, upcomingGroups, weekColumns, whenLine, type RadarRank, type RadarRelease } from './release-radar';

const today = new Date(2026, 9, 6);
const day = (offset: number) => new Date(2026, 9, 6 + offset);
type R = RadarRelease<{ id: string }>;
const episode = (id: string, offset: number, rank: RadarRank = 0, number = 2): R => ({ title: { id }, day: day(offset), rank, release: { type: 'episode', season: 1, number } });
const film = (id: string, offset: number, rank: RadarRank = 0, kind: 'cinema' | 'digital' | 'physical' = 'cinema'): R => ({ title: { id }, day: day(offset), rank, release: { type: 'film', kind } });
const ids = (list: readonly R[]) => list.map((r) => r.title.id);

describe('day offsets', () => {
  it('counts calendar days, across a daylight-saving change', () => {
    expect(dayOffset(today, day(0))).toBe(0);
    expect(dayOffset(today, day(3))).toBe(3);
    expect(dayOffset(today, day(-2))).toBe(-2);
    // Late October has a 25-hour day in much of Europe; still 30 days.
    expect(dayOffset(today, day(30))).toBe(30);
  });
});

describe('the releases a scope shows', () => {
  const forYou = [episode('show', 1), film('saved', 2)];
  const matched = [film('match', 0, 1), episode('show', 1, 1)];
  const popular = [film('hit', 0, 2), film('match', 0, 2)];
  const all = { forYou, matched, popular };

  it('For you: only yours', () => {
    expect(ids(radarReleases('for-you', all, DEFAULT_CALENDAR_FILTER))).toEqual(['show', 'saved']);
  });

  it('Matched: only new titles, not ones you already have', () => {
    expect(ids(radarReleases('matched', all, DEFAULT_CALENDAR_FILTER))).toEqual(['match']);
    expect(radarReleases('matched', { forYou }, DEFAULT_CALENDAR_FILTER)).toEqual([]);
  });

  it('Everything: all of them, each release once, the most relevant copy first on a day', () => {
    const found = radarReleases('everything', all, DEFAULT_CALENDAR_FILTER);
    expect(found.map((r) => [r.title.id, r.rank])).toEqual([
      ['match', 1],
      ['hit', 2],
      ['show', 0],
      ['saved', 0],
    ]);
  });

  it('follows the episodes / films and release-type filter', () => {
    const only = (filter: Partial<CalendarFilter>) => ids(radarReleases('everything', all, { ...DEFAULT_CALENDAR_FILTER, ...filter }));
    expect(only({ show: 'episodes' })).toEqual(['show']);
    expect(only({ show: 'movies' })).toEqual(['match', 'hit', 'saved']);
    expect(only({ kinds: ['digital'] })).toEqual(['show']);
  });
});

describe('the featured release', () => {
  it('is today’s or the next one, yours ahead of a popular one a day or two sooner', () => {
    expect(featuredRelease([film('later', 3), film('soon', 1)], today)?.title.id).toBe('soon');
    expect(featuredRelease([film('popular-today', 0, 2), episode('yours', 2)], today)?.title.id).toBe('yours');
    expect(featuredRelease([film('popular-today', 0, 2), episode('yours', 5)], today)?.title.id).toBe('popular-today');
    // A matched one tomorrow still beats a popular one today.
    expect(featuredRelease([film('matched-tomorrow', 1, 1), film('popular-today', 0, 2)], today)?.title.id).toBe('matched-tomorrow');
  });

  it('with nothing ahead, is the latest one out; with nothing at all, none', () => {
    expect(featuredRelease([film('old', -9), film('recent', -2)], today)?.title.id).toBe('recent');
    expect(featuredRelease([], today)).toBeUndefined();
  });
});

describe('this week', () => {
  it('has a column per day from today, each with its releases in order', () => {
    const columns = weekColumns([film('yesterday', -1), film('a', 0), episode('b', 0), film('c', 6), film('next-week', 7)], today);
    expect(columns).toHaveLength(7);
    expect(columns[0]!.day).toEqual(today);
    expect(columns.map((c) => ids(c.releases))).toEqual([['a', 'b'], [], [], [], [], [], ['c']]);
    expect(weekColumns([], today, 5)).toHaveLength(5);
  });

  it('starts each column at local midnight, across month ends', () => {
    const end = new Date(2026, 9, 30);
    expect(weekColumns([], end).map((c) => c.day.getDate())).toEqual([30, 31, 1, 2, 3, 4, 5]);
  });
});

describe('coming soon', () => {
  it('lists each title’s first release after this week, soonest first, within the window', () => {
    const list = comingSoon([film('far', 150), film('b', 20, 0, 'digital'), film('a', 8), film('b', 10), film('this-week', 6)], today);
    expect(list.map((r) => [r.title.id, dayOffset(today, r.day)])).toEqual([
      ['a', 8],
      ['b', 10],
    ]);
    expect(comingSoon([film('a', 8), film('b', 9), film('c', 10)], today, 2)).toHaveLength(2);
  });
});

describe('upcoming', () => {
  const shape = (groups: ReturnType<typeof upcomingGroups<R>>) => groups.map(({ group, rows }) => [group, rows.map((row) => [row.releases[0]!.title.id, row.offset, row.releases.length])]);

  it('groups from today on into Today, This week and Later, leaving out what aired and what is too far off', () => {
    const groups = upcomingGroups([episode('aired', -1), episode('b', 3), episode('a', 0), episode('c', 6), episode('d', 7), episode('far', 120)], today);
    expect(shape(groups)).toEqual([
      ['today', [['a', 0, 1]]],
      [
        'week',
        [
          ['b', 3, 1],
          ['c', 6, 1],
        ],
      ],
      ['later', [['d', 7, 1]]],
    ]);
    expect(groups[0]!.rows[0]!.day).toEqual(today);
  });

  it('puts a title’s episodes on one day in one row, in the order given', () => {
    const drop = [episode('show', 2, 0, 1), episode('show', 2, 0, 2), episode('other', 2), episode('show', 2, 0, 3)];
    const [week] = upcomingGroups(drop, today);
    expect(week!.rows.map((row) => [row.releases[0]!.title.id, row.releases.map((r) => (r.release.type === 'episode' ? r.release.number : 0))])).toEqual([
      ['show', [1, 2, 3]],
      ['other', [2]],
    ]);
  });

  it('lists every day this week, but each title once Later (its next day)', () => {
    const weekly = [0, 3, 10, 17, 24].map((offset) => episode('weekly', offset));
    const groups = upcomingGroups([...weekly, episode('weekly', 10, 0, 3)], today);
    expect(shape(groups)).toEqual([
      ['today', [['weekly', 0, 1]]],
      ['week', [['weekly', 3, 1]]],
      ['later', [['weekly', 10, 2]]],
    ]);
  });

  it('has no groups when nothing is coming', () => {
    expect(upcomingGroups([], today)).toEqual([]);
    expect(upcomingGroups([episode('aired', -3)], today)).toEqual([]);
  });

  it('counts days across a month end and a daylight-saving change', () => {
    const end = new Date(2026, 9, 24);
    const groups = upcomingGroups([episode('x', 0), { ...episode('y', 0), day: new Date(2026, 9, 30) }, { ...episode('z', 0), day: new Date(2026, 10, 2) }], end);
    expect(groups.map(({ group, rows }) => [group, rows.map((row) => row.offset)])).toEqual([
      ['week', [6]],
      ['later', [9]],
    ]);
  });
});

describe('when, in words', () => {
  it('says today, tomorrow, the weekday this week, else the date; or how long ago', () => {
    expect(whenLine(0, day(0))).toEqual({ key: 'today' });
    expect(whenLine(1, day(1))).toEqual({ key: 'tomorrow' });
    expect(whenLine(4, day(4))).toEqual({ key: 'weekday', day: day(4) });
    expect(whenLine(9, day(9))).toEqual({ key: 'date', day: day(9) });
    expect(whenLine(-3, day(-3))).toEqual({ key: 'past', days: 3 });
  });

  it('badges posters with days, then weeks, then months', () => {
    expect(shortUntil(3, 'en-US')).toBe('in 3d');
    expect(shortUntil(7, 'en-US')).toBe('in 1w');
    expect(shortUntil(20, 'en-US')).toBe('in 2w');
    expect(shortUntil(90, 'en-US')).toBe('in 3mo');
    expect(shortUntil(3, 'de-DE')).toBe('in 3 Tagen');
  });

  it('puts the featured chip as “tomorrow” / “in 3 days”, and nothing once out', () => {
    expect(chipUntil(0, 'en-US')).toBeNull();
    expect(chipUntil(-2, 'en-US')).toBeNull();
    expect(chipUntil(1, 'en-US')).toBe('tomorrow');
    expect(chipUntil(3, 'en-US')).toBe('in 3 days');
    expect(chipUntil(3, 'fr-FR')).toBe('dans 3 jours');
  });

  it('knows a premiere', () => {
    expect(premiere(1, 1)).toBe('series');
    expect(premiere(3, 1)).toBe('season');
    expect(premiere(1, 2)).toBeNull();
  });
});

describe('isOut', () => {
  const now = Date.UTC(2026, 9, 6, 18, 0);
  it('counts earlier days and today as out', () => {
    expect(isOut(-3, undefined, now)).toBe(true);
    expect(isOut(0, undefined, now)).toBe(true);
    expect(isOut(1, undefined, now)).toBe(false);
  });

  it('keeps an episode airing later today as still to come', () => {
    expect(isOut(0, now + 3_600_000, now)).toBe(false);
    expect(isOut(0, now - 60_000, now)).toBe(true);
    // Yesterday's is out whatever its time said.
    expect(isOut(-1, now + 3_600_000, now)).toBe(true);
  });
});

describe('the Release Radar tab count', () => {
  // The tab counts what's coming, as the Radar lists it, not the shows and films it looks up.
  it('counts your releases from today on, each once, under the filter', () => {
    const forYou = [episode('show', -3, 0, 1), episode('show', 0), episode('show', 7, 0, 3), episode('show', 7, 0, 3), film('saved', 2), film('saved', 2, 0, 'physical')];
    expect(upcomingCount(forYou, DEFAULT_CALENDAR_FILTER, today)).toBe(4);
    expect(upcomingCount(forYou, { ...DEFAULT_CALENDAR_FILTER, show: 'episodes' }, today)).toBe(2);
    expect(upcomingCount([], DEFAULT_CALENDAR_FILTER, today)).toBe(0);
  });
});