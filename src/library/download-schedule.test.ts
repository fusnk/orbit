import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { hourLabel, parseSpeedLimit, parseWindow, stepHour } from './download-schedule';

describe('download schedule settings', () => {
  it('accepts the offered speed limits only', () => {
    expect(parseSpeedLimit(5)).toBe(5);
    expect(parseSpeedLimit(50)).toBe(50);
    for (const junk of [3, -1, '5', null, undefined, 1e9]) expect(parseSpeedLimit(junk)).toBe(0);
  });

  it('reads a window of whole hours, across midnight too', () => {
    expect(parseWindow({ start: 1, end: 7 })).toEqual({ start: 1, end: 7 });
    expect(parseWindow({ start: 23, end: 6 })).toEqual({ start: 23, end: 6 });
    for (const junk of [null, 'x', { start: 24, end: 1 }, { start: 1.5, end: 3 }, { start: 1 }, []]) expect(parseWindow(junk)).toBeNull();
  });

  it('steps hours round the clock', () => {
    expect(stepHour(23, 1)).toBe(0);
    expect(stepHour(0, -1)).toBe(23);
    expect(stepHour(5, 1)).toBe(6);
  });

  it('writes hours as the language does', () => {
    expect(hourLabel(1, 'en-GB')).toBe('01:00');
    expect(hourLabel(13, 'de-DE')).toBe('13:00');
    expect(hourLabel(1, 'en-US')).toMatch(/^1:00\sAM$/);
  });
});
