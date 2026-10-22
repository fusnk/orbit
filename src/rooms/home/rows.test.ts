import { describe, expect, it, vi } from 'vitest';

const saved = new Map<string, unknown>();
vi.mock('../../lib/ipc', () => ({
  settings: { get: async (key: string) => saved.get(key) ?? null, set: async (key: string, value: unknown) => void saved.set(key, value) },
}));
// Slow, like a round trip to Rust.
vi.mock('../../library/profiles', () => ({ activeProfileId: () => new Promise((resolve) => setTimeout(() => resolve('main'), 5)) }));

import { arrange, dashboardLayout, drawStep, movedOrder, initialLayout, layoutKey, MAX_ADDED, pairHalves, parseLayout, resetArrangement, restorePrevious, styleOf, updateLayout, withExtra, withHalf, withHeroNext } from './rows';

describe('arrange', () => {
  it('reorders saved rows and keeps unsaved ones in place', () => {
    expect(arrange(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['c', 'b', 'a', 'd']);
    expect(arrange(['a', 'b', 'new', 'c'], ['c', 'b', 'a'])).toEqual(['c', 'b', 'new', 'a']);
  });

  it('ignores saved rows that no longer exist', () => {
    expect(arrange(['a', 'b'], ['gone', 'b', 'a'])).toEqual(['b', 'a']);
    expect(arrange(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});

describe('moving a row', () => {
  it('moves it among the rows shown, keeping saved rows that aren’t shown now where they were', () => {
    // TMDB's row was moved to the top, then TMDB went away for a while.
    expect(movedOrder(['a', 'b', 'c'], ['tmdb', 'a', 'b', 'c'], 'c', -1)).toEqual(['tmdb', 'a', 'c', 'b']);
    expect(movedOrder(['a', 'b', 'c'], ['a', 'tmdb', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'tmdb', 'c']);
  });

  it('moves from the order as it is now, so two quick presses move it twice', () => {
    const once = movedOrder(['a', 'b', 'c', 'd'], [], 'a', 1);
    expect(movedOrder(['a', 'b', 'c', 'd'], once, 'a', 1)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('stays put at either end', () => {
    expect(movedOrder(['a', 'b'], ['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
    expect(movedOrder(['a', 'b'], ['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
  });
});

describe('Home layout', () => {
  const catalog = { kind: 'catalog', addon: 'com.linvo.cinemeta', type: 'movie', catalog: 'top', genre: 'Horror' };

  it('reads a full layout', () => {
    const saved = {
      order: ['row-abc', 'continue'],
      hidden: ['for-you'],
      styles: { 'row-abc': 'landscape', top: 'poster' },
      added: [
        { id: 'row-abc', source: catalog, name: '  Scary  ' },
        { id: 'row-mood-short', source: { kind: 'mood', mood: 'short' } },
        { id: 'row-lib', source: { kind: 'library' } },
        { id: 'row-list', source: { kind: 'list', list: 'abc123' } },
        { id: 'row-netflix', source: { kind: 'service', service: 'netflix' } },
      ],
    };
    const layout = parseLayout(saved);
    expect(layout.order).toEqual(['row-abc', 'continue']);
    expect(layout.hidden).toEqual(['for-you']);
    expect(layout.styles).toEqual({ 'row-abc': 'landscape', top: 'poster' });
    expect(layout.added).toHaveLength(5);
    expect(layout.added[0]).toEqual({ id: 'row-abc', source: catalog, name: 'Scary' });
  });

  it('drops bad rows one by one and keeps the good ones', () => {
    const layout = parseLayout({
      styles: { a: 'giant', b: 'top10', constructor: 7 },
      added: [
        { id: 'row-ok', source: { kind: 'library' } },
        { id: 'row-ok', source: { kind: 'library' } }, // duplicate id
        { id: 'not a row id', source: { kind: 'library' } },
        { id: 'row-x', source: { kind: 'mood', mood: 'sleepy' } },
        { id: 'row-y', source: { kind: 'service', service: '../netflix' } },
        { id: 'row-z', source: { kind: 'catalog', addon: '', type: 'movie', catalog: 'top' } },
        { id: 'row-w', source: { kind: 'telepathy' } },
        { id: 'row-name', source: { kind: 'library' }, name: 42 },
        { id: 'row-blank', source: { kind: 'library' }, name: '\u0007  ' },
      ],
    });
    expect(layout.styles).toEqual({ b: 'top10' });
    expect(layout.added.map((r) => r.id)).toEqual(['row-ok', 'row-name', 'row-blank']);
    expect(layout.added[1]!.name).toBeUndefined();
    expect(layout.added[2]!.name).toBeUndefined();
  });

  it('caps names and the number of added rows', () => {
    const many = Array.from({ length: MAX_ADDED + 10 }, (_, i) => ({ id: `row-${i}`, source: { kind: 'library' }, name: 'x'.repeat(200) }));
    const layout = parseLayout({ added: many });
    expect(layout.added).toHaveLength(MAX_ADDED);
    expect(layout.added[0]!.name).toHaveLength(60);
  });

  it('styles fall back to the row default, and only own keys count', () => {
    const layout = parseLayout({ styles: { a: 'landscape' } });
    expect(styleOf(layout, 'a', 'poster')).toBe('landscape');
    expect(styleOf(layout, 'b', 'top10')).toBe('top10');
    expect(styleOf(layout, 'constructor', 'poster')).toBe('poster');
    expect(styleOf(parseLayout(JSON.parse('{"styles": {"__proto__": "top10"}}')), 'x', 'poster')).toBe('poster');
  });

  it('poster rails without a style of their own follow the card shape; picked styles and Top 10 rows keep theirs', () => {
    const layout = parseLayout({ styles: { picked: 'poster', ranked: 'landscape' } });
    expect(styleOf(layout, 'other', 'poster', 'landscape')).toBe('landscape');
    expect(styleOf(layout, 'other', 'poster', 'poster')).toBe('poster');
    expect(styleOf(layout, 'picked', 'poster', 'landscape')).toBe('poster');
    expect(styleOf(layout, 'top', 'top10', 'landscape')).toBe('top10');
    expect(styleOf(layout, 'ranked', 'top10', 'poster')).toBe('landscape');
  });

  it('starts from the old shared order, adding mood rows only for a new setup', () => {
    const legacy = { order: ['top', 'continue'], hidden: ['letterboxd'] };
    expect(initialLayout(legacy, false)).toEqual({ order: ['top', 'continue'], hidden: ['letterboxd'], styles: {}, added: [] });
    const fresh = initialLayout(null, true);
    expect(fresh.order).toEqual([]);
    expect(fresh.added.map((r) => r.source)).toEqual([
      { kind: 'mood', mood: 'short' },
      { kind: 'mood', mood: 'mind-bending' },
      { kind: 'mood', mood: 'feel-good' },
    ]);
    // What it saves reads back the same.
    expect(parseLayout(JSON.parse(JSON.stringify(fresh)))).toEqual(fresh);
    expect(initialLayout(null, false).added).toEqual([]);
  });

  it('keys the layout by profile, with safe characters only', () => {
    expect(layoutKey('0a1b2c3d4e5f6071')).toBe('home.layout.0a1b2c3d4e5f6071');
    expect(layoutKey(null)).toBe('home.layout');
    expect(layoutKey('../Evil Profile')).toBe('home.layout');
    expect(layoutKey('x'.repeat(60))).toBe('home.layout');
    expect(layoutKey('0a1b2c3d4e5f6071').length).toBeLessThanOrEqual(64);
  });
});

describe('half-width rows and the banner option', () => {
  it('reads them, and leaves them out of layouts saved before they existed', () => {
    const older = { order: ['top'], hidden: [], styles: {}, added: [] };
    expect(parseLayout(older)).toEqual(older);
    expect(parseLayout(JSON.parse(JSON.stringify(older)))).not.toHaveProperty('half');
    const layout = parseLayout({ ...older, half: ['continue', 7, 'top'], heroNext: true });
    expect(layout.half).toEqual(['continue', 'top']);
    expect(layout.heroNext).toBe(true);
    // Anything but `true` is off; a list of nothing usable is no list.
    expect(parseLayout({ heroNext: 'yes', half: [1, null] })).toEqual({ order: [], hidden: [], styles: {}, added: [] });
  });

  it('reads the tile rows', () => {
    const tiles = ['status', 'today', 'live'].map((kind) => ({ id: `row-${kind}`, source: { kind } }));
    expect(parseLayout({ added: tiles }).added).toEqual(tiles);
    expect(parseLayout({ added: [{ id: 'row-x', source: { kind: 'status', extra: '<b>' } }] }).added).toEqual([{ id: 'row-x', source: { kind: 'status' } }]);
  });

  it('pairs consecutive half-width rows, and draws a lone one full width', () => {
    const pairs = pairHalves(['continue', 'status', 'today', 'top', 'live', 'genres'], ['continue', 'status', 'today', 'top']);
    expect([...pairs]).toEqual([
      ['continue', 'start'],
      ['status', 'end'],
      ['today', 'start'],
      ['top', 'end'],
    ]);
    // Three in a row: the first two pair, the third is alone.
    expect([...pairHalves(['a', 'b', 'c'], ['a', 'b', 'c']).keys()]).toEqual(['a', 'b']);
    // Not next to each other (a full-width row between): neither pairs.
    expect(pairHalves(['a', 'x', 'b'], ['a', 'b']).size).toBe(0);
    // A hidden row isn't in `visible`, so its neighbours can pair across it.
    expect(pairHalves(['a', 'b'], ['a', 'b', 'gone']).size).toBe(2);
  });

  it('turns half width and the banner option on and off without leaving empty fields', () => {
    const base = parseLayout({});
    const on = withHeroNext(withHalf(base, 'a', true), true);
    expect(on.half).toEqual(['a']);
    expect(on.heroNext).toBe(true);
    expect(withHeroNext(withHalf(on, 'a', false), false)).toEqual(base);
  });
});

describe('the Dashboard preset', () => {
  const shown = ['continue', 'for-you', 'letterboxd', 'top', 'catalog:cinemeta:series:top', 'row-mood-short', 'genres'];
  let n = 0;
  const makeId = () => `row-new${++n}`;

  it('arranges Home like the dashboard, keeps everything else in its order, and keeps what it replaced', () => {
    n = 0;
    const before = parseLayout({ order: ['genres', 'continue'], hidden: ['top', 'for-you'], styles: { top: 'poster' }, added: [{ id: 'row-mood-short', source: { kind: 'mood', mood: 'short' } }] });
    const after = dashboardLayout(before, shown, makeId);
    expect(after.added.map((r) => r.source.kind)).toEqual(['mood', 'status', 'today', 'live']);
    // After the dashboard's rows, the rest as they were arranged (Genres was moved first).
    expect(after.order).toEqual(['continue', 'row-new1', 'row-new2', 'top', 'row-new3', 'genres', 'for-you', 'letterboxd', 'catalog:cinemeta:series:top', 'row-mood-short']);
    expect(after.half).toEqual(['continue', 'row-new1', 'row-new2', 'top']);
    expect(after.heroNext).toBe(true);
    // Trending shows (as a Top 10) even if it was hidden; other hidden rows stay hidden.
    expect(after.hidden).toEqual(['for-you']);
    expect(after.styles.top).toBe('top10');
    expect(after.previous).toEqual(before);
    // What it saves reads back the same.
    expect(parseLayout(JSON.parse(JSON.stringify(after)))).toEqual(after);
  });

  it('keeps the place of saved rows not shown right now', () => {
    n = 0;
    // TMDB's row was moved after Genres, then TMDB went away for a while.
    const before = parseLayout({ order: ['genres', 'tmdb-movies-today', 'continue'] });
    const after = dashboardLayout(before, shown, makeId);
    expect(after.order).toEqual(['continue', 'row-new1', 'row-new2', 'top', 'row-new3', 'genres', 'tmdb-movies-today', 'for-you', 'letterboxd', 'catalog:cinemeta:series:top', 'row-mood-short']);
  });

  it('uses TMDB’s Trending row when Home has it, and reuses tile rows already added', () => {
    n = 0;
    const before = parseLayout({ added: [{ id: 'row-mine', source: { kind: 'today' } }] });
    const after = dashboardLayout(before, ['continue', 'tmdb-movies-today', 'tmdb-trending-week', 'row-mine'], makeId);
    expect(after.added.filter((r) => r.source.kind === 'today').map((r) => r.id)).toEqual(['row-mine']);
    expect(after.half).toEqual(['continue', 'row-new1', 'row-mine', 'tmdb-trending-week']);
    expect(after.styles).toEqual({ 'tmdb-trending-week': 'top10' });
  });

  it('is reversible: restoring brings back the layout it replaced, even after applying it twice', () => {
    n = 0;
    const before = parseLayout({ order: ['top', 'continue'], hidden: ['genres'] });
    const twice = dashboardLayout(dashboardLayout(before, shown, makeId), shown, makeId);
    expect(twice.previous).toEqual(before);
    expect(restorePrevious(twice)).toEqual(before);
    expect(restorePrevious(before)).toBe(before);
  });

  it('adds no tile rows past the limit', () => {
    const full = parseLayout({ added: Array.from({ length: MAX_ADDED }, (_, i) => ({ id: `row-${i}`, source: { kind: 'library' } })) });
    const after = dashboardLayout(full, ['continue', 'top'], makeId);
    expect(after.added).toHaveLength(MAX_ADDED);
    expect(after.half).toEqual(['continue', 'top']);
  });

  it('resetting keeps added rows (and the layout to restore) but drops the arrangement', () => {
    n = 0;
    const after = dashboardLayout(parseLayout({}), shown, makeId);
    const reset = resetArrangement(after);
    expect(reset).toEqual({ order: [], hidden: [], styles: {}, added: after.added, previous: after.previous });
  });
});

describe('the greeting and card tags', () => {
  it('are on unless turned off, and only "off" is saved', () => {
    expect(parseLayout({}).greeting).toBeUndefined();
    expect(parseLayout({ greeting: false, cardTags: false })).toMatchObject({ greeting: false, cardTags: false });
    expect(parseLayout({ greeting: 'no', cardTags: true })).not.toHaveProperty('greeting');
    const off = withExtra(parseLayout({}), 'cardTags', false);
    expect(off.cardTags).toBe(false);
    expect(withExtra(off, 'cardTags', true)).not.toHaveProperty('cardTags');
  });

  it('stay as they are through presets, Reset and Restore', () => {
    const off = withExtra(parseLayout({}), 'greeting', false);
    const dashboard = dashboardLayout(off, ['continue', 'top'], () => 'row-x');
    expect(dashboard.greeting).toBe(false);
    expect(resetArrangement(dashboard).greeting).toBe(false);
    expect(restorePrevious(withExtra(dashboard, 'greeting', true))).not.toHaveProperty('greeting');
  });
});

describe('saving the layout', () => {
  it('keeps both of two quick changes', async () => {
    vi.stubGlobal('document', { dispatchEvent: () => true });
    await Promise.all([
      updateLayout((layout) => ({ ...layout, hidden: [...layout.hidden, 'a'] })),
      updateLayout((layout) => ({ ...layout, hidden: [...layout.hidden, 'b'] })),
    ]);
    await updateLayout((layout) => ({ ...layout, hidden: [...layout.hidden, 'c'] }));
    expect((saved.get('home.layout.main') as { hidden: string[] }).hidden).toEqual(['a', 'b', 'c']);
    vi.unstubAllGlobals();
  });
});

describe('drawing a row', () => {
  it('leaves a hidden row unmade, so its rail loads nothing until it is shown', () => {
    expect(drawStep(undefined, 'poster|Popular', true)).toBe('defer');
    expect(drawStep({ sig: 'poster|Popular', made: false }, 'poster|Popular', true)).toBe('keep');
    expect(drawStep({ sig: 'poster|Popular', made: false }, 'poster|Popular', false)).toBe('make');
  });

  it('keeps a made row while its style, name and contents stay the same, hidden or not', () => {
    expect(drawStep(undefined, 'poster|Popular', false)).toBe('make');
    expect(drawStep({ sig: 'poster|Popular', made: true }, 'poster|Popular', false)).toBe('keep');
    expect(drawStep({ sig: 'poster|Popular', made: true }, 'poster|Popular', true)).toBe('keep');
    expect(drawStep({ sig: 'poster|Popular', made: true }, 'landscape|Popular', false)).toBe('make');
    expect(drawStep({ sig: 'poster|Popular', made: true }, 'landscape|Popular', true)).toBe('defer');
  });
});
