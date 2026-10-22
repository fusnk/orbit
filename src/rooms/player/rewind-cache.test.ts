import { describe, expect, it } from 'vitest';
import { parseRewindCache } from './rewind-cache';

describe('rewind cache', () => {
  it('reads only the fixed presets; anything else is Standard', () => {
    expect(parseRewindCache('more')).toBe('more');
    expect(parseRewindCache('most')).toBe('most');
    for (const other of [null, undefined, 'standard', '2GiB', 'most,cache=no', 3, { preset: 'most' }]) expect(parseRewindCache(other)).toBe('standard');
  });
});
