import { describe, expect, it } from 'vitest';
import { showsWatchedMark } from './watched-mark';

describe('showsWatchedMark', () => {
  const base = { type: 'movie', watched: true, newEpisodes: 0, enabled: true };

  it('marks a finished film', () => {
    expect(showsWatchedMark(base)).toBe(true);
    expect(showsWatchedMark({ ...base, watched: false })).toBe(false);
  });

  it('marks a finished series only while nothing new has aired', () => {
    expect(showsWatchedMark({ ...base, type: 'series' })).toBe(true);
    expect(showsWatchedMark({ ...base, type: 'series', newEpisodes: 2 })).toBe(false);
    expect(showsWatchedMark({ ...base, type: 'series', watched: false })).toBe(false);
  });

  it('treats an anime addon\'s show as a series', () => {
    expect(showsWatchedMark({ ...base, type: 'anime' })).toBe(true);
    expect(showsWatchedMark({ ...base, type: 'anime', newEpisodes: 1 })).toBe(false);
  });

  it('marks nothing with the setting off', () => {
    expect(showsWatchedMark({ ...base, enabled: false })).toBe(false);
    expect(showsWatchedMark({ ...base, type: 'series', enabled: false })).toBe(false);
  });
});
