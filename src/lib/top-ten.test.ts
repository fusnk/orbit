import { describe, expect, it } from 'vitest';
import { splitTopTen } from './top-ten';

describe('splitTopTen', () => {
  it('splits a leading "Top 10" from the rest of a heading', () => {
    expect(splitTopTen('Top 10 Movies Today')).toEqual(['Top 10', 'Movies Today']);
    expect(splitTopTen('Top 10 des séries sur Netflix')).toEqual(['Top 10', 'des séries sur Netflix']);
    expect(splitTopTen('TOP10 Filme')).toEqual(['TOP10', 'Filme']);
  });

  it('leaves other headings whole', () => {
    expect(splitTopTen('Trending This Week')).toBeNull();
    expect(splitTopTen('Top 100 Movies')).toBeNull();
    expect(splitTopTen('Top 10')).toBeNull();
    expect(splitTopTen('أفضل 10 أفلام اليوم')).toBeNull();
  });
});
