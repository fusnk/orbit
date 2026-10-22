import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstDayOfWeek, leadingDays, weekdayOrder } from './week-start';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('firstDayOfWeek', () => {
  it('follows the locale data when the engine has it', () => {
    // The week info reads 1 = Monday … 7 = Sunday; the grid wants Date.getDay's 0 = Sunday.
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('de')).toBe(1);
    expect(firstDayOfWeek('ar')).toBe(6);
    // Engines that have it as a method rather than a getter.
    vi.spyOn(Intl.Locale.prototype, 'weekInfo', 'get').mockReturnValue(undefined as never);
    Object.defineProperty(Intl.Locale.prototype, 'getWeekInfo', { value: () => ({ firstDay: 7 }), configurable: true });
    expect(firstDayOfWeek('de')).toBe(0);
    delete (Intl.Locale.prototype as { getWeekInfo?: unknown }).getWeekInfo;
  });

  it('falls back to a small table without it: Monday for most, Sunday or Saturday where used', () => {
    // No week info at all (older WebKit).
    vi.spyOn(Intl.Locale.prototype, 'weekInfo', 'get').mockReturnValue(undefined as never);
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('en-CA')).toBe(0);
    expect(firstDayOfWeek('ja')).toBe(0);
    expect(firstDayOfWeek('zh')).toBe(0);
    expect(firstDayOfWeek('he')).toBe(0);
    expect(firstDayOfWeek('en-GB')).toBe(1);
    expect(firstDayOfWeek('fr')).toBe(1);
    expect(firstDayOfWeek('de-DE')).toBe(1);
    expect(firstDayOfWeek('ar')).toBe(6);
    expect(firstDayOfWeek('ar-EG')).toBe(6);
    expect(firstDayOfWeek('ar-MA')).toBe(1);
  });

  it('copes with a tag Intl refuses', () => {
    vi.spyOn(Intl, 'Locale').mockImplementation(() => {
      throw new RangeError('bad tag');
    });
    expect(firstDayOfWeek('en_US')).toBe(0);
    expect(firstDayOfWeek('')).toBe(1);
  });
});

describe('the month grid', () => {
  it('lists the weekday headers from the first day', () => {
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });

  it('starts the grid on the first day of the week, so the 1st lands in the right column', () => {
    // 1 October 2026 is a Thursday.
    const first = new Date(2026, 9, 1);
    expect(leadingDays(first, 1)).toBe(3);
    expect(leadingDays(first, 0)).toBe(4);
    expect(leadingDays(first, 6)).toBe(5);
    // 1 November 2026 is a Sunday: no lead with Sunday weeks, a full row's worth less one with Monday's.
    const sunday = new Date(2026, 10, 1);
    expect(leadingDays(sunday, 0)).toBe(0);
    expect(leadingDays(sunday, 1)).toBe(6);
  });
});
