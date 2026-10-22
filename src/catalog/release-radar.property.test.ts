import fc from 'fast-check';
import { expect, it } from 'vitest';
import { DEFAULT_CALENDAR_FILTER } from './release-calendar';
import { comingSoon, dayOffset, radarReleases, weekColumns, type RadarRelease } from './release-radar';

const options = { seed: 20261007, numRuns: 300 };
const release = fc.record({ id: fc.integer({ min: 0, max: 15 }), offset: fc.integer({ min: -30, max: 150 }), rank: fc.constantFrom(0, 1, 2), number: fc.integer({ min: 1, max: 24 }) });
const dates = fc.record({ year: fc.integer({ min: 2000, max: 2035 }), month: fc.integer({ min: 0, max: 11 }), date: fc.integer({ min: 1, max: 28 }) });

it('local calendar dates group into exactly one day across month/year and DST boundaries', () => {
  fc.assert(fc.property(dates, fc.array(release, { maxLength: 100 }), (base, raw) => {
    const today = new Date(base.year, base.month, base.date);
    const releases = raw.map((entry) => ({ ...entry, day: new Date(base.year, base.month, base.date + entry.offset) }));
    const columns = weekColumns(releases, today);
    expect(columns.flatMap((column) => column.releases)).toHaveLength(releases.filter((entry) => entry.offset >= 0 && entry.offset < 7).length);
    for (const column of columns) {
      expect(dayOffset(today, column.day)).toBe(column.offset);
      expect(column.releases.every((entry) => entry.offset === column.offset)).toBe(true);
    }
  }), options);
});

it('radar deduplicates release identities, keeps the most relevant copy and sorts by day', () => {
  fc.assert(fc.property(fc.array(release, { maxLength: 100 }), (raw) => {
    const releases: RadarRelease<{ id: string }>[] = raw.map((entry) => ({ title: { id: String(entry.id) }, day: new Date(2026, 9, 7 + entry.offset), rank: entry.rank, release: { type: 'episode', season: 1, number: entry.number } }));
    const result = radarReleases('everything', { forYou: releases }, DEFAULT_CALENDAR_FILTER);
    const key = (entry: RadarRelease<{ id: string }>) => `${entry.title.id}:${entry.release.type === 'episode' ? entry.release.number : ''}`;
    expect(new Set(result.map(key)).size).toBe(result.length);
    for (const entry of result) expect(entry.rank).toBe(Math.min(...releases.filter((candidate) => key(candidate) === key(entry)).map((candidate) => candidate.rank)));
    for (let i = 1; i < result.length; i++) expect(result[i - 1]!.day.getTime()).toBeLessThanOrEqual(result[i]!.day.getTime());
  }), options);
});

it('coming soon uses each title earliest eligible date, respects its horizon and count cap', () => {
  fc.assert(fc.property(fc.array(release, { maxLength: 100 }), fc.integer({ min: 1, max: 20 }), (raw, cap) => {
    const today = new Date(2026, 9, 7);
    const releases = raw.map((entry) => ({ title: { id: String(entry.id) }, day: new Date(2026, 9, 7 + entry.offset), offset: entry.offset }));
    const result = comingSoon(releases, today, cap);
    expect(result.length).toBeLessThanOrEqual(cap);
    expect(new Set(result.map((entry) => entry.title.id)).size).toBe(result.length);
    for (const entry of result) {
      expect(entry.offset).toBeGreaterThanOrEqual(7);
      expect(entry.offset).toBeLessThan(120);
      expect(entry.offset).toBe(Math.min(...releases.filter((candidate) => candidate.title.id === entry.title.id && candidate.offset >= 7 && candidate.offset < 120).map((candidate) => candidate.offset)));
    }
  }), options);
});
