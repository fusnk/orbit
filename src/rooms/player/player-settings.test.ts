import { describe, expect, it } from 'vitest';
import { clampVolume, DEFAULT_SEEK_STEP, parsePassthrough, parseSeekStep, PASSTHROUGH_FORMATS, pictureSide, volumeIcon } from './player-settings';

describe('double-click sides', () => {
  it('splits the picture in thirds', () => {
    expect([pictureSide(100, 0, 900), pictureSide(450, 0, 900), pictureSide(800, 0, 900), pictureSide(1300, 1000, 900)]).toEqual([-1, 0, 1, 0]);
    expect(pictureSide(5, 0, 0)).toBe(0);
  });
});

describe('volume icon', () => {
  it('follows the level, crossed out when muted or silent', () => {
    expect([volumeIcon(0, false), volumeIcon(50, true), volumeIcon(20, false), volumeIcon(33, false), volumeIcon(34, false), volumeIcon(66, false), volumeIcon(67, false), volumeIcon(150, false)]).toEqual([
      'volumeOff',
      'volumeOff',
      'volumeLow',
      'volumeLow',
      'volumeMid',
      'volumeMid',
      'volume',
      'volume',
    ]);
  });
});

describe('seek step', () => {
  it('keeps the offered steps and defaults to 10 s', () => {
    for (const step of [5, 10, 15, 30]) expect(parseSeekStep(step)).toBe(step);
    expect(DEFAULT_SEEK_STEP).toBe(10);
    for (const junk of [undefined, null, 0, -10, 7, 10.5, '10', 1e9, Number.NaN, {}, []]) expect(parseSeekStep(junk)).toBe(10);
  });
});

describe('volume limit', () => {
  it('clamps to the limit and rounds', () => {
    expect(clampVolume(105, 100)).toBe(100);
    expect(clampVolume(105, 150)).toBe(105);
    expect(clampVolume(170, 150)).toBe(150);
    expect(clampVolume(-5, 100)).toBe(0);
    expect(clampVolume(42.6, 100)).toBe(43);
    // A saved 130% with the boost turned off since: back to 100.
    expect(clampVolume(130, 100)).toBe(100);
    expect(clampVolume(Number.NaN, 100)).toBe(100);
  });
});

describe('audio passthrough', () => {
  it('is off unless a known choice was saved', () => {
    expect(parsePassthrough('dolby-dts')).toBe('dolby-dts');
    expect(parsePassthrough('all')).toBe('all');
    for (const junk of [undefined, null, true, 'ac3', 'ALL', {}]) expect(parsePassthrough(junk)).toBe('off');
  });

  it('sends only mpv format names Rust allows', () => {
    const allowed = ['ac3', 'eac3', 'dts', 'dts-hd', 'truehd'];
    expect(PASSTHROUGH_FORMATS.off).toEqual([]);
    for (const formats of Object.values(PASSTHROUGH_FORMATS)) for (const f of formats) expect(allowed).toContain(f);
    expect(PASSTHROUGH_FORMATS.all).toEqual(allowed);
  });
});