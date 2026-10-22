import { describe, expect, it, vi } from 'vitest';

const saved = new Map<string, unknown>();
vi.mock('../lib/ipc', () => ({
  settings: { get: async (key: string) => saved.get(key) ?? null, set: async (key: string, value: unknown) => void saved.set(key, value) },
}));
vi.mock('../library/profiles', () => ({ profileSetting: async (prefix: string) => ({ key: `${prefix}.main`, value: saved.get(`${prefix}.main`) ?? null }) }));

import { countryOfDay, genreKeyOf, parseLayout, serviceGenre, yearsAgo } from './explore';
import { favouriteActor, favouriteGenres, genrePairOfDay, interleave, MAX_HIDDEN, parseTaste, seedsFrom, taste, updateTaste, withDown, withHidden, withList, withoutList, withUp } from './taste';
import { isNewRelease, type Title } from './titles';

const title = (id: string, extra: Partial<Title> = {}): Title => ({ id, type: 'movie', name: id, genres: [], origins: [], ...extra });
const DAY = 86_400_000;
const JUNK: unknown[] = [null, undefined, 0, '', 'junk', true, [], [1, 'a', null], {}, JSON.parse('{"__proto__": {"up": [1]}}')];

describe('taste', () => {
  it('falls back to empty on junk, item by item', () => {
    for (const junk of JUNK) expect(parseTaste(junk)).toEqual({ up: [], down: [], hidden: [], lists: [], hintDone: false });
    expect(
      parseTaste({
        up: [{ id: 'tt1', type: 'movie', name: 'A' }, { id: 'tt1', type: 'movie', name: 'Again' }, { id: 'x1', type: 'movie', name: 'B' }, { id: 'tt2', type: 'anime', name: 'C' }],
        down: ['tt3', 4, 'tt3', 'tt4&x'],
        hidden: Array.from({ length: MAX_HIDDEN + 5 }, (_, i) => `tt${i + 1}`),
        lists: [{ owner: 'dave', slug: 'top-250', name: 'Top' }, { owner: 'da ve', slug: 'x', name: 'Bad' }, { owner: 'a', slug: 'b/../c', name: 'Bad' }],
        hintDone: 'yes',
      }),
    ).toEqual({ up: [{ id: 'tt1', type: 'movie', name: 'A' }], down: ['tt3'], hidden: Array.from({ length: MAX_HIDDEN }, (_, i) => `tt${i + 1}`), lists: [{ owner: 'dave', slug: 'top-250', name: 'Top' }], hintDone: false });
  });

  it('thumbs up and down undo each other; not interested drops a seed', () => {
    let t = parseTaste(null);
    t = withUp(t, title('tt1'));
    t = withUp(t, title('tt2', { type: 'series' }));
    expect(t.up.map((s) => s.id)).toEqual(['tt2', 'tt1']);
    t = withDown(t, 'tt1');
    expect([t.up.map((s) => s.id), t.down]).toEqual([['tt2'], ['tt1']]);
    t = withUp(t, title('tt1'));
    expect(t.down).toEqual([]);
    t = withHidden(t, 'tt2');
    expect([t.up.map((s) => s.id), t.hidden]).toEqual([['tt1'], ['tt2']]);
    // Only movies and shows can be seeds.
    expect(withUp(t, title('tt9', { type: 'channel' }))).toBe(t);
  });

  it('adds each list once and removes it', () => {
    const list = { owner: 'dave', slug: 'x', name: 'X' };
    const t = withList(withList(parseTaste(null), list), list);
    expect(t.lists).toEqual([list]);
    expect(withoutList(t, list).lists).toEqual([]);
  });

  it('saves changes in order, per profile', async () => {
    await Promise.all([updateTaste((t) => withHidden(t, 'tt1')), updateTaste((t) => withHidden(t, 'tt2'))]);
    expect((await taste()).hidden).toEqual(['tt2', 'tt1']);
    expect(parseTaste(saved.get('explore.taste.main')).hidden).toEqual(['tt2', 'tt1']);
  });
});

describe('reading history', () => {
  it('finds favourite genres however addons spell them', () => {
    const titles = [title('a', { genres: ['Drama', 'Thriller'] }), title('b', { genres: ['drama', 'Science Fiction', 'Sci-Fi'] }), title('c', { genres: ['Sci-Fi & Fantasy', 'Talk'] })];
    expect(favouriteGenres(titles)).toEqual(['drama', 'scifi', 'thriller']);
    expect(genreKeyOf('__proto__')).toBeUndefined();
    expect([serviceGenre('fantasy'), serviceGenre('western'), serviceGenre('drama')]).toEqual(['scifi', undefined, 'drama']);
    expect([serviceGenre('thriller'), serviceGenre('thriller', 'series'), serviceGenre('fantasy', 'series')]).toEqual(['thriller', undefined, 'scifi']);
  });

  it('pairs favourite genres, a different pair each day', () => {
    expect(genrePairOfDay(['drama'], 0)).toBeNull();
    const favourites = ['drama', 'thriller', 'history'] as const;
    const days = [0, 1, 2, 3].map((d) => genrePairOfDay(favourites, d * DAY));
    expect(days[0]).toEqual(['drama', 'thriller']);
    expect(days[1]).toEqual(['drama', 'history']);
    expect(days[3]).toEqual(days[0]);
  });

  it('finds the actor who leads the most casts', () => {
    const a = { id: 1, name: 'A' };
    const b = { id: 2, name: 'B' };
    const extra = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 100 + i, name: `X${i}` }));
    expect(favouriteActor([[a, b], [b], [a]])).toEqual({ id: 1, name: 'A', count: 2 });
    // Only the leads count, and one appearance isn't a favourite.
    expect(favouriteActor([[...extra(5), a], [...extra(5), a]])).toEqual({ id: 100, name: 'X0', count: 2 });
    expect(favouriteActor([[a], [b]])).toBeNull();
    // Listed twice in one cast (two roles) counts once.
    expect(favouriteActor([[a, a]])).toBeNull();
  });

  it('pools recommendation lists in turn, each title once', () => {
    const lists = [[title('tt1'), title('tt2'), title('tt3')], [title('tt2'), title('tt4')]];
    expect(interleave(lists).map((t) => t.id)).toEqual(['tt1', 'tt2', 'tt4', 'tt3']);
    expect(interleave(lists, (t) => t.id === 'tt2', 2).map((t) => t.id)).toEqual(['tt1', 'tt4']);
    expect(seedsFrom([{ id: 'tt1', type: 'movie', name: 'A' }], [title('tt1'), title('local:x'), title('tt5', { type: 'series' }), title('tt6')], 2).map((s) => s.id)).toEqual(['tt1', 'tt5']);
  });
});

describe('Discover settings and tables', () => {
  it('reads a layout, keeping only well-formed ids', () => {
    for (const junk of JUNK) expect(parseLayout(junk)).toEqual({ order: [], hidden: [] });
    expect(parseLayout({ order: ['genres', 3, 'genres', 'lb:dave/x'], hidden: 'genres' })).toEqual({ order: ['genres', 'lb:dave/x'], hidden: [] });
  });

  it('picks the country of the day', () => {
    expect(countryOfDay('it', 0)).toBe('IT');
    expect(countryOfDay('en', 0)).toBe('IT');
    expect(countryOfDay('en', DAY)).toBe('FR');
    expect(yearsAgo(Date.UTC(2026, 9, 5), 2)).toBe('2024-10-05');
  });
});

describe('new releases', () => {
  const now = Date.UTC(2026, 9, 5, 12);
  it('are out within the last 30 days, by a known date', () => {
    expect(isNewRelease({ released: '2026-10-01' }, now)).toBe(true);
    expect(isNewRelease({ released: '2026-09-06T00:00:00.000Z' }, now)).toBe(true);
    expect(isNewRelease({ released: '2026-08-01' }, now)).toBe(false);
    // Not out yet, unknown, or only a year.
    expect(isNewRelease({ released: '2026-12-01' }, now)).toBe(false);
    expect(isNewRelease({}, now)).toBe(false);
    expect(isNewRelease({ released: '2026' }, now)).toBe(false);
  });
});
