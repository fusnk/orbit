import fc from 'fast-check';
import { expect, it } from 'vitest';
import { hiddenFor, parseSpoilers, type Spoilers } from './spoilers';

const options = { seed: 20261007, numRuns: 300 };
const settings: fc.Arbitrary<Spoilers> = fc.record({ titles: fc.boolean(), descriptions: fc.boolean(), thumbnails: fc.boolean(), ratings: fc.boolean(), unaired: fc.boolean(), scope: fc.constantFrom('all', 'unwatched') });

it('arbitrary saved JSON yields valid spoiler preferences and is stable after saving again', () => {
  fc.assert(fc.property(fc.jsonValue({ maxDepth: 4 }), fc.boolean(), fc.boolean(), (value, spoilers, hideEpisodeDescriptions) => {
    const legacy = { spoilers, hideEpisodeDescriptions };
    const result = parseSpoilers(value, legacy);
    expect(['all', 'unwatched']).toContain(result.scope);
    expect(Object.values(result).filter((entry) => typeof entry === 'boolean')).toHaveLength(5);
    expect(parseSpoilers(result, legacy)).toEqual(result);
  }), options);
});

it('watched and started episodes stay visible with unwatched scope for every switch combination', () => {
  fc.assert(fc.property(settings, fc.constantFrom('watched', 'in-progress'), (value, kind) => {
    expect(Object.values(hiddenFor(kind, { ...value, scope: 'unwatched' })).every((hidden) => !hidden)).toBe(true);
  }), options);
});

it('expanding scope to every episode cannot reveal previously hidden content or mutate settings', () => {
  fc.assert(fc.property(settings, fc.constantFrom('watched', 'in-progress', 'unwatched', 'up-next', 'unaired'), (value, kind) => {
    const saved = structuredClone(value);
    const before = hiddenFor(kind, value);
    const after = hiddenFor(kind, { ...value, scope: 'all' });
    for (const field of Object.keys(before) as (keyof typeof before)[]) {
      if (before[field]) expect(after[field]).toBe(true);
    }
    if (kind !== 'watched' && kind !== 'in-progress') expect(after).toEqual(before);
    expect(value).toEqual(saved);
  }), options);
});
