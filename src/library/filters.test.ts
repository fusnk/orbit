import { describe, expect, it } from 'vitest';
import type { Title } from '../catalog/titles';
import { filtersActive, filtersOn, genresOf, gridState, matchesFilters, nameOrder, NO_FILTERS, parseSavedFilters, restoreFilters, ratingOf, releaseYear, savedFilters, type WatchStatus } from './filters';

const title = (name: string, genres: string[], id = name): Title => ({ id, type: 'movie', name, genres, origins: [] });

describe('library filters', () => {
  it('reads years and ratings from addon text', () => {
    expect(releaseYear('2011–2019')).toBe(2011);
    expect(releaseYear('2010')).toBe(2010);
    expect(releaseYear(undefined)).toBe(0);
    expect(releaseYear('soon')).toBe(0);
    expect(ratingOf('8.4')).toBe(8.4);
    expect(ratingOf('N/A')).toBe(0);
    expect(ratingOf(undefined)).toBe(0);
  });

  it('counts genres, most common first', () => {
    const titles = [title('A', ['Drama', 'Crime']), title('B', ['Drama']), title('C', ['Comedy', 'Comedy'])];
    expect(genresOf(titles)).toEqual([
      { genre: 'Drama', count: 2 },
      { genre: 'Comedy', count: 1 },
      { genre: 'Crime', count: 1 },
    ]);
  });

  it('matches by name (ignoring case and accents), genre and status', () => {
    const amelie = title('Amélie', ['Comedy', 'Romance']);
    const status = (): WatchStatus => 'started';
    expect(matchesFilters(amelie, { ...NO_FILTERS, query: ' AMEL ' }, status)).toBe(true);
    expect(matchesFilters(amelie, { ...NO_FILTERS, query: 'heat' }, status)).toBe(false);
    expect(matchesFilters(amelie, { ...NO_FILTERS, genre: 'Romance' }, status)).toBe(true);
    expect(matchesFilters(amelie, { ...NO_FILTERS, genre: 'Horror' }, status)).toBe(false);
    expect(matchesFilters(amelie, { ...NO_FILTERS, status: 'started' }, status)).toBe(true);
    expect(matchesFilters(amelie, { ...NO_FILTERS, status: 'watched' }, status)).toBe(false);
    expect(filtersActive(NO_FILTERS)).toBe(false);
    expect(filtersActive({ ...NO_FILTERS, query: '  ' })).toBe(false);
    expect(filtersActive({ ...NO_FILTERS, genre: 'Drama' })).toBe(true);
  });

  it('filters by whether the profile rated a title', () => {
    const status = (): WatchStatus => 'unstarted';
    const rated = (t: Title) => t.id === 'A';
    expect(matchesFilters(title('A', []), { ...NO_FILTERS, rated: 'rated' }, status, rated)).toBe(true);
    expect(matchesFilters(title('B', []), { ...NO_FILTERS, rated: 'rated' }, status, rated)).toBe(false);
    expect(matchesFilters(title('B', []), { ...NO_FILTERS, rated: 'unrated' }, status, rated)).toBe(true);
    expect(matchesFilters(title('A', []), { ...NO_FILTERS, rated: 'unrated' }, status, rated)).toBe(false);
    expect(filtersActive({ ...NO_FILTERS, rated: 'unrated' })).toBe(true);
  });
});

describe('remembered library filters', () => {
  it('saves genre, status and rated, never the typed name', () => {
    const saved = savedFilters({ query: 'alien', genre: 'Horror', status: 'started', rated: 'rated' });
    expect(saved).toEqual({ genre: 'Horror', status: 'started', rated: 'rated' });
    // What's saved comes back as it was (through JSON, as settings store it).
    expect(parseSavedFilters(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it('keeps only valid saved values', () => {
    const none = { genre: null, status: null, rated: null };
    for (const junk of [null, undefined, 'Horror', 42, [], { genre: 7, status: 'paused', rated: true }]) expect(parseSavedFilters(junk)).toEqual(none);
    expect(parseSavedFilters({ genre: '  Science Fiction ', status: 'watched', rated: 'unrated' })).toEqual({ genre: 'Science Fiction', status: 'watched', rated: 'unrated' });
    expect(parseSavedFilters({ genre: 'x'.repeat(61) }).genre).toBeNull();
    expect(parseSavedFilters({ genre: '   ' }).genre).toBeNull();
  });

  it('restores saved filters under what was picked before they loaded, and only a genre the tab has', () => {
    const saved = { genre: 'Horror', status: 'started' as const, rated: 'rated' as const };
    const now = { ...NO_FILTERS, query: 'ali' };
    expect(restoreFilters(now, saved, new Set(), ['Horror', 'Drama'])).toEqual({ query: 'ali', genre: 'Horror', status: 'started', rated: 'rated' });
    // Picked while loading: the person's choice stays (All genres too).
    expect(restoreFilters({ ...now, status: 'watched' }, saved, new Set(['status', 'genre']), ['Horror'])).toEqual({ query: 'ali', genre: null, status: 'watched', rated: 'rated' });
    // A genre none of this tab's titles have would show nothing, with no way to see why.
    expect(restoreFilters(now, saved, new Set(), ['Drama']).genre).toBeNull();
  });
});

describe('filters per view', () => {
  // Continue Watching is all started and Watched all finished: a status chosen on All doesn't narrow them,
  // so they mustn't count it as a filter ("12 of 12", a Clear filters button for a filter not shown).
  it('leaves status out on Continue Watching and Watched', () => {
    const picked = { ...NO_FILTERS, status: 'unstarted' as WatchStatus };
    expect(filtersActive(filtersOn('watched', picked))).toBe(false);
    expect(filtersActive(filtersOn('continue', picked))).toBe(false);
    expect(filtersOn('all', picked)).toEqual(picked);
    expect(filtersOn('watched', { ...picked, genre: 'Drama' })).toEqual({ ...NO_FILTERS, genre: 'Drama' });
  });
});
describe('nameOrder', () => {
  it('puts numbers in a name in number order, as a list page sorted by name does', () => {
    const names = ['2001: A Space Odyssey', '10 Cloverfield Lane', '9', '300', '28 Days Later'];
    expect([...names].sort(nameOrder('en'))).toEqual(['9', '10 Cloverfield Lane', '28 Days Later', '300', '2001: A Space Odyssey']);
  });

  it('follows the language Orbit is in, not the system’s', () => {
    // In Swedish Ö is a letter after Z.
    expect(['Ödesmark', 'Zorro', 'Alfons'].sort(nameOrder('sv'))).toEqual(['Alfons', 'Zorro', 'Ödesmark']);
    expect(['Ödesmark', 'Zorro', 'Alfons'].sort(nameOrder('en'))).toEqual(['Alfons', 'Ödesmark', 'Zorro']);
  });

  it('ignores case', () => {
    expect(['the Office', 'The Americans', 'THE BEAR'].sort(nameOrder('en'))).toEqual(['The Americans', 'THE BEAR', 'the Office']);
  });
});

describe('gridState', () => {
  it('shows the titles, or says nothing matches while filters hide them all', () => {
    expect(gridState(5, 2)).toBe('titles');
    expect(gridState(5, 0)).toBe('no-match');
  });

  it('says a view with nothing in it is empty (All with only watch history), rather than leaving it blank', () => {
    expect(gridState(0, 0)).toBe('empty');
  });
});
