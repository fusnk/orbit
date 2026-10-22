import { describe, expect, it } from 'vitest';
import { runtimeMinutes } from './runtime';
import { addPage, fits, pickSurprise, type LoadedPages, type SurpriseConstraints } from './surprise';
import type { Title } from './titles';

const title = (id: string, extra: Partial<Title> = {}): Title => ({ id, type: 'movie', name: id, genres: [], origins: [], ...extra });
const ANY: SurpriseConstraints = { type: 'movie', genre: null, runtime: 'any', era: 'any', unwatchedOnly: false };
const never = () => false;

describe('runtimes', () => {
  it('reads addon runtimes', () => {
    expect(runtimeMinutes('142 min')).toBe(142);
    expect(runtimeMinutes('2h 22min')).toBe(142);
    expect(runtimeMinutes('1 h')).toBe(60);
    expect(runtimeMinutes('95')).toBe(95);
    expect(runtimeMinutes('N/A')).toBe(0);
    expect(runtimeMinutes(undefined)).toBe(0);
  });
});

describe('surprise me', () => {
  it('applies type, genre, runtime and era', () => {
    const film = title('a', { genres: ['Comedy'], runtime: '95 min', year: '2015' });
    expect(fits({ title: film }, ANY, never)).toBe(true);
    expect(fits({ title: film }, { ...ANY, type: 'series' }, never)).toBe(false);
    expect(fits({ title: film }, { ...ANY, genre: 'Comedy' }, never)).toBe(true);
    expect(fits({ title: film }, { ...ANY, genre: 'Horror' }, never)).toBe(false);
    // A title's own genres win over the catalog it came from (Cinemeta's genre
    // catalogs include titles listed under other genres)…
    expect(fits({ title: film, genre: 'Horror' }, { ...ANY, genre: 'Horror' }, never)).toBe(false);
    // …and the catalog's genre counts for titles that list none.
    expect(fits({ title: title('b'), genre: 'Horror' }, { ...ANY, genre: 'Horror' }, never)).toBe(true);
    // A catalog option sent HTML-escaped still matches the title's decoded genre.
    expect(fits({ title: title('c', { genres: ['Action & Adventure'] }) }, { ...ANY, genre: 'Action &amp; Adventure' }, never)).toBe(true);
    expect(fits({ title: film }, { ...ANY, runtime: 'under-100' }, never)).toBe(true);
    expect(fits({ title: title('long', { runtime: '2h 10min' }) }, { ...ANY, runtime: 'under-120' }, never)).toBe(false);
    expect(fits({ title: title('unknown') }, { ...ANY, runtime: 'under-120' }, never)).toBe(false);
    expect(fits({ title: film }, { ...ANY, era: '2010s' }, never)).toBe(true);
    expect(fits({ title: film }, { ...ANY, era: '2020s' }, never)).toBe(false);
    expect(fits({ title: title('old', { year: '1972' }) }, { ...ANY, era: 'earlier' }, never)).toBe(true);
  });

  it('ignores runtime for shows', () => {
    const show = title('s', { type: 'series' });
    expect(fits({ title: show }, { ...ANY, type: 'series', runtime: 'under-100' }, never)).toBe(true);
  });

  it('can leave out titles already started', () => {
    const film = title('a');
    expect(fits({ title: film }, { ...ANY, unwatchedOnly: true }, () => true)).toBe(false);
    expect(fits({ title: film }, { ...ANY, unwatchedOnly: false }, () => true)).toBe(true);
  });

  it('never repeats what was shown', () => {
    const pool = ['a', 'b', 'c'].map((id) => ({ title: title(id) }));
    const shown = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const pick = pickSurprise(pool, ANY, { exclude: shown, started: never });
      expect(pick).toBeDefined();
      expect(shown.has(pick!.id)).toBe(false);
      shown.add(pick!.id);
    }
    expect(pickSurprise(pool, ANY, { exclude: shown, started: never })).toBeUndefined();
  });

  it('picks evenly among distinct titles', () => {
    // "a" twice (from two catalogs) must not crowd out "b".
    const pool = [{ title: title('a') }, { title: title('a') }, { title: title('b') }];
    expect(pickSurprise(pool, ANY, { exclude: new Set(), started: never, random: () => 0.6 })?.id).toBe('b');
    expect(pickSurprise(pool, ANY, { exclude: new Set(), started: never, random: () => 0.99 })?.id).toBe('b');
  });

  it('returns nothing from an empty pool or when nothing fits', () => {
    expect(pickSurprise([], ANY, { exclude: new Set(), started: never })).toBeUndefined();
    expect(pickSurprise([{ title: title('a') }], { ...ANY, genre: 'Horror' }, { exclude: new Set(), started: never })).toBeUndefined();
  });
});

describe('catalog pages', () => {
  it('starts the next page past every title the addon sent, and keeps each title once', () => {
    const state: LoadedPages = { titles: [], done: false, pages: 0, received: 0 };
    // The first page lists one title twice.
    addPage(state, [title('a'), title('a'), title('b')], 'Drama');
    expect(state.received).toBe(3);
    expect(state.titles.map((x) => x.title.id)).toEqual(['a', 'b']);
    expect(state.titles[0]!.genre).toBe('Drama');
    expect(state.done).toBe(false);
    // The next overlaps it (a list that shifted): only the new title is added.
    addPage(state, [title('b'), title('c')], 'Drama');
    expect(state.received).toBe(5);
    expect(state.titles.map((x) => x.title.id)).toEqual(['a', 'b', 'c']);
    // Nothing new: the catalog has run out.
    addPage(state, [title('c')], 'Drama');
    expect(state.done).toBe(true);
    expect(state.pages).toBe(3);
  });
});
