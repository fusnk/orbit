import fc from 'fast-check';
import { expect, it } from 'vitest';
import type { Title } from '../../catalog/titles';
import { mixHero } from './hero-mix';

const title = (id: string): Title => ({ id, type: 'movie', name: id, genres: [], origins: [], background: 'https://example.test/art', description: 'Summary' });

it('never repeats a title across generated trending and personal pools', () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 0, max: 12 }), { maxLength: 40 }),
    fc.array(fc.integer({ min: 0, max: 12 }), { maxLength: 40 }),
    fc.array(fc.integer({ min: 0, max: 12 }), { maxLength: 12 }),
    fc.integer({ min: 0, max: 20 }), fc.integer(),
    (popular, personal, excluded, count, seed) => {
      const input = {
        trending: popular.map((id, rank) => ({ title: title(String(id)), rank: rank + 1 })),
        personal: personal.map((id) => ({ title: title(String(id)), reason: { kind: 'watchlist' as const } })),
        exclude: new Set(excluded.map(String)), count, seed,
      };
      const result = mixHero(input);
      expect(result).toEqual(mixHero(input));
      expect(result.length).toBeLessThanOrEqual(count);
      expect(new Set(result.map((pick) => pick.title.id)).size).toBe(result.length);
      expect(result.every((pick) => !input.exclude.has(pick.title.id))).toBe(true);
    },
  ), { seed: 20261007, numRuns: 300 });
});
