import { describe, expect, it } from 'vitest';
import { releasedAt } from './air-date';

// Local times, so the test reads the same in any time zone.
const local = (month: number, day: number, hour = 0) => new Date(2026, month - 1, day, hour).getTime();

describe('releasedAt', () => {
  it('reads a date-only air date as the start of that day where the person is', () => {
    expect(releasedAt('2026-10-20')).toBe(local(10, 20));
    // How addons give a date: UTC midnight, which is the evening before in the Americas.
    expect(releasedAt('2026-10-20T00:00:00.000Z')).toBe(local(10, 20));
    expect(releasedAt('2026-10-20T00:00:00Z')).toBe(local(10, 20));
  });

  it('keeps a real time of day', () => {
    expect(releasedAt('2026-10-20T01:30:00.000Z')).toBe(Date.UTC(2026, 9, 20, 1, 30));
  });

  it('is NaN when missing or not a date', () => {
    expect(releasedAt(undefined)).toBeNaN();
    expect(releasedAt('')).toBeNaN();
    expect(releasedAt('soon')).toBeNaN();
    expect(releasedAt('2026-02-30')).toBeNaN();
  });
});
