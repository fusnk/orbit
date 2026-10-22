import { afterEach, describe, expect, it, vi } from 'vitest';
import { besideColumn, dayFrom, firstShowing, keptScrollLeft, sameTimeOn, slotStart } from './guide-grid';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('guide grid time', () => {
  it('starts slots on the local half hour', () => {
    // Nepal is UTC+5:45: 10:00 UTC is 15:45 there, so the slot starts at 15:30 local (09:45 UTC).
    vi.stubEnv('TZ', 'Asia/Kathmandu');
    expect(slotStart(Date.UTC(2026, 9, 13, 10, 0) / 1000)).toBe(Date.UTC(2026, 9, 13, 9, 45) / 1000);
    vi.stubEnv('TZ', 'UTC');
    expect(slotStart(Date.UTC(2026, 9, 13, 10, 10) / 1000)).toBe(Date.UTC(2026, 9, 13, 10, 0) / 1000);
  });

  it('goes right from a channel to the programme showing beside it, even one begun under the channel column', () => {
    // The channel column ends at 320px; the programme on now runs from 250px (under the column) to 600px.
    const cells = [{ right: 248 }, { right: 600 }, { right: 900 }];
    expect(firstShowing(cells, 320)).toBe(cells[1]);
    expect(firstShowing(cells, 1000)).toBeUndefined();
  });

  it('going left, brings an earlier programme out from under the channel column', () => {
    // The column ends at 320px and the grid shows to 1200px. A programme wholly under the column scrolls
    // back until it starts at the column's edge; one already beside it stays put.
    expect(besideColumn({ left: 200, right: 298 }, 320, 1200)).toBe(-120);
    expect(besideColumn({ left: -400, right: -250 }, 320, 1200)).toBe(-720);
    expect(besideColumn({ left: 330, right: 600 }, 320, 1200)).toBe(0);
    // The programme on now, begun under the column: its start comes into view too.
    expect(besideColumn({ left: 250, right: 600 }, 320, 1200)).toBe(-70);
  });

  it('keeps the same time at the left edge when a redraw moves the grid on', () => {
    // 5px a minute: 120px in was 24 minutes past 10:00; after the half hour the grid starts at 10:30.
    const from = Date.UTC(2026, 9, 13, 10, 0) / 1000;
    expect(keptScrollLeft(120, from, from + 1800)).toBe(0);
    expect(keptScrollLeft(300, from, from + 1800)).toBe(150);
    // Past midnight with catch-up: from yesterday's midnight to 23:30, 23:50 stays 20 minutes in, not 12 hours ahead.
    expect(keptScrollLeft(23 * 300 + 250, from, from + 23.5 * 3600)).toBe(100);
    expect(keptScrollLeft(500, from, from)).toBe(500);
  });

  it('keeps the earlier day being looked at once midnight passes', () => {
    vi.stubEnv('TZ', 'Europe/London');
    // Yesterday (24 October) picked late on the 25th: just after midnight it is two days back, not the 25th.
    const picked = Date.UTC(2026, 9, 23, 23, 0) / 1000;
    expect(dayFrom(picked, Date.UTC(2026, 9, 25, 22, 55))).toBe(-1);
    expect(dayFrom(picked, Date.UTC(2026, 9, 26, 0, 5))).toBe(-2);
    // Across the clock change (the 25th has 25 hours) it is still whole calendar days.
    expect(dayFrom(Date.UTC(2026, 9, 25, 0, 0) / 1000, Date.UTC(2026, 9, 26, 23, 30))).toBe(-1);
  });

  it('goes back a calendar day across a clock change', () => {
    // UK clocks went back on 25 October 2026: noon the day before was 11:00 UTC, not 12:00.
    vi.stubEnv('TZ', 'Europe/London');
    expect(sameTimeOn(-1, Date.UTC(2026, 9, 25, 12, 0))).toBe(Date.UTC(2026, 9, 24, 11, 0) / 1000);
  });
});
