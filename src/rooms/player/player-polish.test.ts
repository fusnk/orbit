import { describe, expect, it } from 'vitest';
import { parsePlayerLayout } from './layout';
import { formatInfo } from './format';
import { parseVolumeBoost } from './player-settings';

describe('custom control scale', () => {
  it('keeps valid bounded values without overriding old size presets', () => {
    expect(parsePlayerLayout({ size: 'large', scale: 0.7 })).toMatchObject({ size: 'large', scale: 0.7 });
    expect(parsePlayerLayout({ scale: 1.4 })).toMatchObject({ scale: 1.4 });
    for (const scale of [0, 0.69, 1.41, '1.2', Number.NaN, Infinity]) expect(parsePlayerLayout({ scale }).scale).toBeUndefined();
    expect(parsePlayerLayout({ size: 'compact' }).scale).toBeUndefined();
  });
});
describe('saved volume boost', () => {
  it('migrates the legacy switch and accepts only the supported presets', () => {
    expect(parseVolumeBoost(true)).toBe(150);
    expect(parseVolumeBoost(false)).toBe(100);
    for (const level of [100, 125, 150, 200]) expect(parseVolumeBoost(level)).toBe(level);
    for (const junk of [undefined, null, '200', 250, NaN, {}, []]) expect(parseVolumeBoost(junk)).toBe(100);
  });
});
describe('playback diagnostics', () => {
  it('reports render and decoder drops without counting them twice', () => {
    expect(formatInfo({ 'frame-drop-count': '3', 'decoder-frame-drop-count': '2' }, { addon: 'A' })).toContainEqual(['Dropped frames', '3 / 2']);
  });
  it('omits invalid drop counters', () => {
    expect(formatInfo({ 'frame-drop-count': '-2', 'decoder-frame-drop-count': 'NaN' }, { addon: 'A' })).toEqual([['Source', 'A']]);
  });
});
