import { describe, expect, it } from 'vitest';
import { CATEGORIES, GROUPS, LEGACY_CATEGORIES, resolvePlace } from './categories';

/** Every Settings link built into Orbit: `openSettingsTo('<id>'…)` anywhere in the source. */
const sources = import.meta.glob<string>('../../**/*.ts', { query: '?raw', import: 'default', eager: true });
const linkedIds = [...new Set(Object.values(sources).flatMap((text) => [...text.matchAll(/openSettings(?:To|At)\(\s*'([a-z-]+)'/g)].map((m) => m[1]!)))];

describe('settings categories', () => {
  it('has eleven categories in two groups, each group used', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(['general', 'appearance', 'home-library', 'playback', 'player', 'subtitles', 'picture-sound', 'addons', 'accounts', 'downloads', 'shortcuts']);
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
    for (const group of GROUPS) expect(CATEGORIES.some((c) => c.group === group.id)).toBe(true);
    // Grouped in order: "For everyone" first, then "Sources & connections".
    const order = CATEGORIES.map((c) => GROUPS.findIndex((g) => g.id === c.group));
    expect(order).toEqual([...order].sort());
  });

  it('maps every old category id to where it lives now', () => {
    expect(resolvePlace('video')).toEqual({ category: 'picture-sound' });
    expect(resolvePlace('audio')).toEqual({ category: 'subtitles' });
    expect(resolvePlace('library')).toEqual({ category: 'home-library' });
    expect(resolvePlace('integrations')).toEqual({ category: 'accounts' });
    expect(resolvePlace('livetv')).toEqual({ category: 'accounts', section: '.live-tv-section' });
    expect(resolvePlace('advanced')).toEqual({ category: 'general', section: '.backup-section' });
    for (const [id, place] of Object.entries(LEGACY_CATEGORIES)) {
      const category = CATEGORIES.find((c) => c.id === place.category);
      expect(category, id).toBeDefined();
      if (place.tab) expect(category!.tabs?.map((t) => t.id)).toContain(place.tab);
      // An old id never shadows a current one.
      expect(CATEGORIES.some((c) => c.id === id)).toBe(false);
    }
  });

  it('keeps current ids, opens a tabbed category on its first tab unless asked, and honours a section', () => {
    expect(resolvePlace('playback')).toEqual({ category: 'playback' });
    // The player's look and behaviour have their own page now; its old id is that page's.
    expect(resolvePlace('player')).toEqual({ category: 'player' });
    expect(resolvePlace('appearance')).toEqual({ category: 'appearance' });
    expect(resolvePlace('appearance', 'player')).toEqual({ category: 'appearance' });
    expect(resolvePlace('addons')).toEqual({ category: 'addons', tab: 'installed' });
    expect(resolvePlace('addons', 'sources')).toEqual({ category: 'addons', tab: 'sources' });
    expect(resolvePlace('addons', 'nonsense')).toEqual({ category: 'addons', tab: 'installed' });
    expect(resolvePlace('integrations', undefined, '.tmdb-row')).toEqual({ category: 'accounts', section: '.tmdb-row' });
    expect(resolvePlace('library', undefined, '.home-rows-section')).toEqual({ category: 'home-library', section: '.home-rows-section' });
    expect(resolvePlace('no-such-category')).toBeNull();
  });

  it('resolves every Settings link in the source', () => {
    expect(linkedIds.length).toBeGreaterThan(4);
    expect(linkedIds.filter((id) => !resolvePlace(id))).toEqual([]);
  });
});
