import { describe, expect, it } from 'vitest';
import { clampAdjustment, LOOK_VALUES, LOOKS, lookOf, NEUTRAL, parsePicture, parsePictureQuality, PICTURE_FIELDS } from './picture';

describe('picture quality', () => {
  it('keeps a known preset and falls back to Balanced (what Orbit always did)', () => {
    expect(parsePictureQuality('fast')).toBe('fast');
    expect(parsePictureQuality('high')).toBe('high');
    for (const junk of [null, undefined, 'High', 'gpu-hq', 1, {}]) expect(parsePictureQuality(junk)).toBe('balanced');
  });
});

describe('picture adjustments', () => {
  it('carries over the old Vivid and Cinematic looks as the values they sent to mpv', () => {
    expect(parsePicture(undefined, 'vivid')).toEqual({ brightness: 1, contrast: 6, saturation: 18, gamma: 0 });
    expect(parsePicture(null, 'cinematic')).toEqual({ brightness: -1, contrast: 5, saturation: -6, gamma: -4 });
    expect(parsePicture(undefined, 'original')).toEqual(NEUTRAL);
    expect(parsePicture(undefined, undefined)).toEqual(NEUTRAL);
    expect(parsePicture(undefined, 'toString')).toEqual(NEUTRAL);
  });

  it('prefers saved adjustments over the old look, field by field', () => {
    expect(parsePicture({ brightness: 5, contrast: -3, saturation: 0, gamma: 2 }, 'vivid')).toEqual({ brightness: 5, contrast: -3, saturation: 0, gamma: 2 });
    expect(parsePicture({ brightness: 500, contrast: 'x', saturation: 2.6, gamma: -1e9 })).toEqual({ brightness: 100, contrast: 0, saturation: 3, gamma: -100 });
  });

  it('keeps values whole and in range', () => {
    expect(clampAdjustment(12.4)).toBe(12);
    expect(clampAdjustment(-101)).toBe(-100);
    expect(clampAdjustment(Number.NaN)).toBe(0);
    expect(clampAdjustment('5')).toBe(0);
  });

  it('names the look the values match, if any', () => {
    expect(lookOf(NEUTRAL)).toBe('neutral');
    for (const look of LOOKS) expect(lookOf(LOOK_VALUES[look])).toBe(look);
    expect(lookOf({ ...NEUTRAL, gamma: 1 })).toBeUndefined();
  });

  it('has gentle looks', () => {
    for (const look of LOOKS) for (const field of PICTURE_FIELDS) expect(Math.abs(LOOK_VALUES[look][field])).toBeLessThanOrEqual(25);
  });
});
