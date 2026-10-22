import { describe, expect, it } from 'vitest';
import { addonGroups, createAddonFilter, fromAddon, offerAddonFilter } from './source-filter';

const list = (...addons: string[]) => addons.map((addon, i) => ({ addon, id: i }));

describe('addonGroups', () => {
  it('counts each addon, most sources first, ties in the order they came', () => {
    expect(addonGroups(list('Addon B', 'Addon A', 'Addon A', 'Addon C', 'Addon B', 'Addon A', 'Jellyfin'))).toEqual([
      { addon: 'Addon A', count: 3 },
      { addon: 'Addon B', count: 2 },
      { addon: 'Addon C', count: 1 },
      { addon: 'Jellyfin', count: 1 },
    ]);
    expect(addonGroups([])).toEqual([]);
  });

  it('handles many addons', () => {
    const names = Array.from({ length: 10 }, (_, i) => `Addon ${i}`);
    const groups = addonGroups(names.flatMap((name, i) => list(...Array<string>(10 - i).fill(name))));
    expect(groups.map((g) => g.count)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });
});

describe('fromAddon', () => {
  it('keeps one addon’s sources in order, or all for null', () => {
    const sources = list('A', 'B', 'A', 'C');
    expect(fromAddon(sources, 'A').map((s) => s.id)).toEqual([0, 2]);
    expect(fromAddon(sources, null)).toEqual(sources);
    expect(fromAddon(sources, 'Z')).toEqual([]);
  });
});

describe('offerAddonFilter', () => {
  it('only with two addons or more', () => {
    expect(offerAddonFilter(addonGroups(list('A', 'A')))).toBe(false);
    expect(offerAddonFilter(addonGroups(list('A', 'B')))).toBe(true);
  });
});

describe('createAddonFilter', () => {
  it('starts on all addons', () => {
    expect(createAddonFilter().resolve(addonGroups(list('A', 'B')), true)).toBeNull();
  });

  it('applies the chosen addon to the next title that has it', () => {
    const filter = createAddonFilter();
    filter.choose('B');
    expect(filter.resolve(addonGroups(list('A', 'B')), true)).toBe('B');
    expect(filter.resolve(addonGroups(list('B', 'C', 'C')), true)).toBe('B');
  });

  it('waits while sources are still coming, then forgets an addon the title doesn’t have', () => {
    const filter = createAddonFilter();
    filter.choose('B');
    expect(filter.resolve(addonGroups(list('A', 'C')), false)).toBeNull();
    expect(filter.chosen()).toBe('B');
    expect(filter.resolve(addonGroups(list('A', 'C', 'B')), false)).toBe('B');
    expect(filter.resolve(addonGroups(list('A', 'C')), true)).toBeNull();
    expect(filter.chosen()).toBeNull();
    expect(filter.resolve(addonGroups(list('A', 'B')), true)).toBeNull();
  });

  it('doesn’t filter when the addon is the only one, but keeps the choice', () => {
    const filter = createAddonFilter();
    filter.choose('B');
    expect(filter.resolve(addonGroups(list('B', 'B')), true)).toBeNull();
    expect(filter.chosen()).toBe('B');
  });

  it('All addons clears it', () => {
    const filter = createAddonFilter();
    filter.choose('B');
    filter.choose(null);
    expect(filter.resolve(addonGroups(list('A', 'B')), true)).toBeNull();
  });
});
