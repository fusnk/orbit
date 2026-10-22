import { describe, expect, it } from 'vitest';
import { addRecentGenre, DEFAULT_RECENT_GENRES, parseRecentGenres } from './recent-genres';

describe('parseRecentGenres', () => {
  it('falls back to the defaults', () => {
    expect(parseRecentGenres(null)).toEqual(DEFAULT_RECENT_GENRES);
    expect(parseRecentGenres({})).toEqual(DEFAULT_RECENT_GENRES);
    expect(parseRecentGenres([1, '', 'x'.repeat(65)])).toEqual(DEFAULT_RECENT_GENRES);
  });

  it('keeps up to three distinct names', () => {
    expect(parseRecentGenres(['Drama', 'Drama', 7, 'Crime', 'War', 'Western'])).toEqual(['Drama', 'Crime', 'War']);
  });
});

describe('addRecentGenre', () => {
  it('puts a new genre first and drops the oldest', () => {
    expect(addRecentGenre(['Action', 'Comedy', 'Horror'], 'Drama')).toEqual(['Drama', 'Action', 'Comedy']);
  });

  it('leaves the order alone for a genre already there', () => {
    expect(addRecentGenre(['Action', 'Comedy', 'Horror'], 'Horror')).toEqual(['Action', 'Comedy', 'Horror']);
  });
});
