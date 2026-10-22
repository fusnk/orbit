import { describe, expect, it } from 'vitest';
import { findCollections, matchesQuery } from './search';

describe('searching collections', () => {
  const collections = [{ name: 'Studio Ghibli' }, { name: 'Marvel: Phase One', group: 'Franchises' }, { name: 'Amélie and friends' }, { name: 'Horror', group: null }];

  it('finds by name or group, ignoring case and accents, in their order', () => {
    expect(findCollections(collections, 'ghib').map((c) => c.name)).toEqual(['Studio Ghibli']);
    expect(findCollections(collections, 'FRANCHISE').map((c) => c.name)).toEqual(['Marvel: Phase One']);
    expect(findCollections(collections, 'amelie').map((c) => c.name)).toEqual(['Amélie and friends']);
    expect(findCollections(collections, 'o').map((c) => c.name)).toEqual(['Studio Ghibli', 'Marvel: Phase One', 'Horror']);
  });

  it('shows everything for an empty or blank search, and nothing for no match', () => {
    expect(findCollections(collections, '')).toHaveLength(4);
    expect(findCollections(collections, '   ')).toHaveLength(4);
    expect(findCollections(collections, 'zzz')).toEqual([]);
  });

  it('matches a title within a collection the same way', () => {
    expect(matchesQuery(' spirited ', 'Spirited Away')).toBe(true);
    expect(matchesQuery('pokemon', 'Pokémon: The First Movie')).toBe(true);
    expect(matchesQuery('totoro', 'Spirited Away')).toBe(false);
    expect(matchesQuery('x', undefined, null)).toBe(false);
  });
});
