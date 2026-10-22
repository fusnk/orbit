import { describe, expect, it } from 'vitest';
import type { Title } from '../../catalog/titles';
import type { ContinueEntry } from '../../library/watch';
import { DEFAULT_AMBIENT, parseAmbientPrefs } from './settings';
import { allowedSlides, continueNote, MAX_SLIDES, pickSlides, slideMeta, type SlideSources } from './slides';

const title = (id: string, extra: Partial<Title> = {}): Title => ({ id, type: 'movie', name: id, genres: [], origins: [], background: `https://img.example/${id}.jpg`, ...extra });
const cw = (t: Title, extra: Partial<ContinueEntry> = {}): ContinueEntry => ({ title: t, progress: 0.4, sub: '', left: '23m left', ...extra });
const none: SlideSources = { continueWatching: [], library: [], recent: [], trending: [] };
const ids = (slides: { title: Title }[]) => slides.map((s) => s.title.id);

describe('pickSlides', () => {
  const sources: SlideSources = {
    continueWatching: [cw(title('c1')), cw(title('c2'))],
    library: [title('l1'), title('c1'), title('l2')],
    recent: [title('r1'), title('l2')],
    trending: [title('t1'), title('c2'), title('t2'), title('t3')],
  };

  it('For you: Continue Watching, then My Library, then recently watched', () => {
    expect(ids(pickSlides('for-you', sources))).toEqual(['c1', 'c2', 'l1', 'l2', 'r1']);
  });

  it('Trending: only the catalog', () => {
    expect(ids(pickSlides('trending', sources))).toEqual(['t1', 'c2', 't2', 't3']);
  });

  it('keeps only the slides the profile’s content limit allows, in order', async () => {
    const slides = pickSlides('both', sources);
    // As `allowedTitles` answers on a Kids profile: the R-rated trending t1 and the imported c2 are left out.
    const allowed = async (titles: readonly Title[]) => titles.filter((t) => t.id !== 't1' && t.id !== 'c2');
    expect(ids(await allowedSlides(slides, allowed))).toEqual(['c1', 't2', 'l1', 't3', 'l2', 'r1']);
  });

  it('Both: personal and trending take turns, each title once', () => {
    expect(ids(pickSlides('both', sources))).toEqual(['c1', 't1', 'c2', 't2', 'l1', 't3', 'l2', 'r1']);
  });

  it('keeps the most personal appearance of a title', () => {
    const slides = pickSlides('for-you', sources);
    expect(slides.find((s) => s.title.id === 'c1')?.kind).toBe('continue');
    expect(slides.find((s) => s.title.id === 'l2')?.kind).toBe('library');
  });

  it('skips titles without an https backdrop', () => {
    const slides = pickSlides('for-you', {
      ...none,
      library: [title('a', { background: undefined }), title('b', { background: '' }), title('c', { background: 'http://img.example/c.jpg' }), title('d')],
    });
    expect(ids(slides)).toEqual(['d']);
  });

  it('a duplicate without a backdrop does not hide one with', () => {
    const slides = pickSlides('for-you', { ...none, continueWatching: [cw(title('x', { background: undefined }))], library: [title('x')] });
    expect(slides.map((s) => [s.title.id, s.kind])).toEqual([['x', 'library']]);
  });

  it('is empty with nothing to show', () => {
    expect(pickSlides('both', none)).toEqual([]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_SLIDES + 20 }, (_, i) => title(`t${i}`));
    expect(pickSlides('trending', { ...none, trending: many })).toHaveLength(MAX_SLIDES);
  });
});

describe('continueNote', () => {
  it('resumes an episode', () => {
    expect(continueNote(cw(title('s', { type: 'series' }), { sub: 'S2 · E4' }))).toBe('Resume S2 · E4 · 23m left');
  });
  it('resumes a movie without repeating its year', () => {
    expect(continueNote(cw(title('m'), { sub: '2019 · 2h 10m' }))).toBe('Resume · 23m left');
  });
  it('names the next episode', () => {
    expect(continueNote({ title: title('s', { type: 'series' }), progress: 0, sub: 'S2 · E5 · Pilot', badge: 'Next episode' })).toBe('Next episode · S2 · E5 · Pilot');
  });
});

describe('slideMeta', () => {
  it('year and up to two genres', () => {
    expect(slideMeta(title('a', { year: '2019', genres: ['Drama', ' ', 'Thriller', 'Crime'] }))).toBe('2019 · Drama, Thriller');
  });
  it('leaves blanks out', () => {
    expect(slideMeta(title('a', { year: ' ', genres: ['Drama'] }))).toBe('Drama');
    expect(slideMeta(title('a'))).toBe('');
  });
});

describe('parseAmbientPrefs', () => {
  it('falls back to the defaults on junk', () => {
    for (const junk of [null, undefined, 'x', 7, -1, 1e308, {}, [], true]) {
      expect(parseAmbientPrefs({ after: junk, source: junk, clock: junk, paused: junk })).toEqual(DEFAULT_AMBIENT);
    }
  });
  it('keeps valid choices', () => {
    expect(parseAmbientPrefs({ after: 0, source: 'trending', clock: false, paused: false })).toEqual({ afterMinutes: 0, source: 'trending', clock: false, paused: false });
    expect(parseAmbientPrefs({ after: 30, source: 'for-you' })).toEqual({ ...DEFAULT_AMBIENT, afterMinutes: 30, source: 'for-you' });
  });
});
