import { describe, expect, it } from 'vitest';
import { ManifestSchema, MetaResponseSchema, parseWith } from '../addons/schema';
import type { UsableAddon } from '../addons/types';
import { browsableCatalogs, displayYear, episodeAfter, episodeBefore, fallbackHue, fromDetail, genreLine, isShowType, metaValues, railTitle, runtimeLabel, seasonsFrom, showKind, upcomingRelease, type Episode, type Title } from './titles';

describe('showKind', () => {
  it('counts an anime addon\'s "anime" titles as TV shows, and nothing else as either', () => {
    expect(showKind('movie')).toBe('movie');
    expect(showKind('series')).toBe('series');
    expect(showKind('anime')).toBe('series');
    expect(isShowType('anime')).toBe(true);
    expect(showKind('channel')).toBeNull();
    expect(showKind('tv')).toBeNull();
  });
});

describe('displayYear', () => {
  it('shows ranges with a dash and running shows as ongoing', () => {
    expect(displayYear('2026-')).toBe('2026–present');
    expect(displayYear('2008-2013')).toBe('2008–2013');
    expect(displayYear('2005–2013')).toBe('2005–2013');
    expect(displayYear('2010')).toBe('2010');
    expect(displayYear(undefined)).toBeUndefined();
  });
});

describe('trailers', () => {
  it('keeps YouTube ids only, trailers first, without repeats', () => {
    const { meta } = parseWith(MetaResponseSchema, {
      meta: {
        id: 'tt1',
        type: 'movie',
        name: 'X',
        trailers: [
          { source: 'teaser00001', type: 'Teaser' },
          { source: 'trailer0001', type: 'Trailer' },
          { source: 'https://evil.example/x', type: 'Trailer' },
        ],
        trailerStreams: [{ ytId: 'trailer0001' }, { ytId: 'stream00001' }, { ytId: '--exec=calc' }],
      },
    });
    expect(fromDetail(meta!, []).trailers).toEqual(['trailer0001', 'stream00001', 'teaser00001']);
    expect(fromDetail({ ...meta!, trailers: undefined, trailerStreams: undefined }, []).trailers).toBeUndefined();
  });
});

describe('seasonsFrom', () => {
  const now = new Date('2026-09-29T00:00:00Z');

  it('groups episodes by season, specials last, sorted by episode', () => {
    const seasons = seasonsFrom(
      [
        { id: 'a', season: 1, episode: 2, title: 'Two' },
        { id: 'b', season: 0, episode: 1, title: 'Special' },
        { id: 'c', season: 1, episode: 1, title: 'One' },
        { id: 'd', season: 2, episode: 1, title: '' },
        { id: 'e', title: 'Trailer' },
      ],
      now,
    );
    expect(seasons.map((s) => s.number)).toEqual([1, 2, 0]);
    expect(seasons[0]!.episodes.map((e) => e.title)).toEqual(['One', 'Two']);
    expect(seasons[1]!.episodes[0]!.title).toBe('Episode 1');
  });

  it('labels episodes that have not aired yet', () => {
    const [season] = seasonsFrom(
      [
        { id: 'past', season: 1, episode: 1, released: '2026-01-10T00:00:00Z' },
        { id: 'future', season: 1, episode: 2, released: '2026-11-04T00:00:00Z' },
      ],
      now,
    );
    expect(season!.episodes[0]!.airs).toBeUndefined();
    expect(season!.episodes[1]!.airs).toBe('Airs Nov 4');
  });

  it('lists an episode an addon repeats once, keeping what each copy knows', () => {
    const [season] = seasonsFrom(
      [
        { id: 'ex:1:1', season: 1, episode: 1 },
        { id: 'ex:1:1', season: 1, episode: 1, title: 'Pilot', thumbnail: 'https://img.example/1.jpg' },
        { id: 'ex:1:2', season: 1, episode: 2, title: 'Two', overview: 'What happens.' },
        { id: 'ex:1:2b', season: 1, episode: 2, title: 'two', released: '2026-01-10T00:00:00Z' },
      ],
      now,
    );
    expect(season!.episodes).toHaveLength(2);
    expect(season!.episodes[0]).toMatchObject({ id: 'ex:1:1', title: 'Pilot', thumbnail: 'https://img.example/1.jpg' });
    // The richer copy's id stands; the other fills in what it lacks.
    expect(season!.episodes[1]).toMatchObject({ id: 'ex:1:2', title: 'Two', overview: 'What happens.', released: '2026-01-10T00:00:00Z' });
  });

  it('keeps two different videos under one number (parts of an episode)', () => {
    const [season] = seasonsFrom(
      [
        { id: 'ex:1:5a', season: 1, episode: 5, title: 'Finale (Part 1)' },
        { id: 'ex:1:5b', season: 1, episode: 5, title: 'Finale (Part 2)' },
      ],
      now,
    );
    expect(season!.episodes.map((e) => e.id)).toEqual(['ex:1:5a', 'ex:1:5b']);
  });

  it('dedupes the same way whatever order the copies come in', () => {
    const copies = [
      { id: 'ex:2:1', season: 2, episode: 1 },
      { id: 'ex:2:1', season: 2, episode: 1, title: 'Return', overview: 'Back.' },
    ];
    expect(seasonsFrom(copies, now)).toEqual(seasonsFrom([...copies].reverse(), now));
  });
});

describe('catalog helpers', () => {
  const addon = (catalogs: object[]): UsableAddon => ({
    key: 'cinemeta',
    manifest: parseWith(ManifestSchema, { id: 'c', version: '3.0.0', name: 'Cinemeta', types: ['movie', 'series'], resources: ['catalog'], catalogs }),
    displayHost: 'v3-cinemeta.strem.io',
    enabled: true,
    installedAt: 0,
    urlReadable: true,
    builtIn: true,
    owned: false,
    shared: false,
    sharedBy: null,
  });

  it('names rails after the catalog and its type', () => {
    expect(railTitle({ type: 'series', id: 'top', name: 'Popular', extra: [] })).toBe('Popular TV Shows');
    expect(railTitle({ type: 'channel', id: 'x', name: 'Live', extra: [] })).toBe('Live');
    expect(railTitle({ type: 'movie', id: 'open-films', name: 'Open Films', extra: [] })).toBe('Open Films');
  });

  it('keeps catalogs that need no input and fills a required genre option', () => {
    const refs = browsableCatalogs([
      addon([
        { type: 'movie', id: 'top', name: 'Popular', extra: [{ name: 'genre' }, { name: 'search' }] },
        { type: 'movie', id: 'year', name: 'New', extra: [{ name: 'genre', isRequired: true, options: ['2026', '2025'] }] },
        { type: 'series', id: 'last-videos', extra: [{ name: 'lastVideosIds', isRequired: true }] },
      ]),
    ]);
    expect(refs.map((r) => [r.catalog.id, r.extra])).toEqual([
      ['top', []],
      ['year', [['genre', '2026']]],
    ]);
  });

  it('gives each title a stable fallback hue', () => {
    expect(fallbackHue('tt0944947')).toBe(fallbackHue('tt0944947'));
    expect(fallbackHue('tt0944947')).toBeGreaterThanOrEqual(0);
    expect(fallbackHue('tt0944947')).toBeLessThan(360);
  });
});

describe('episodeAfter', () => {
  const ep = (number: number, airs?: string): Episode => ({ id: `tt1:x:${number}`, number, title: `E${number}`, ...(airs ? { airs } : {}) });
  const show: Title = {
    id: 'tt1',
    type: 'series',
    name: 'Show',
    genres: [],
    origins: [],
    seasons: [
      { number: 1, episodes: [ep(1), ep(2)] },
      { number: 2, episodes: [ep(1), ep(2, 'Airs Dec 1')] },
      { number: 0, episodes: [ep(1)] },
    ],
  };

  it('moves to the next episode, then across seasons', () => {
    expect(episodeAfter(show, 1, 1)).toMatchObject({ season: 1, episode: { number: 2 } });
    expect(episodeAfter(show, 1, 2)).toMatchObject({ season: 2, episode: { number: 1 } });
  });

  it('stops before unaired episodes and specials', () => {
    expect(episodeAfter(show, 2, 1)).toBeUndefined();
    expect(episodeAfter(show, 0, 1)).toBeUndefined();
  });

  it('goes back across seasons, and not before the first', () => {
    expect(episodeBefore(show, 2, 1)).toMatchObject({ season: 1, episode: { number: 2 } });
    expect(episodeBefore(show, 1, 1)).toBeUndefined();
    expect(episodeBefore(show, 0, 1)).toBeUndefined();
  });

  it('goes on from the part playing when two parts share an episode number', () => {
    const part = (id: string, title: string): Episode => ({ id, number: 5, title });
    const twoParts: Title = { ...show, seasons: [{ number: 1, episodes: [ep(4), part('p1', 'Finale, Part 1'), part('p2', 'Finale, Part 2'), ep(6)] }] };
    expect(episodeAfter(twoParts, 1, 5, 'p1')?.episode.id).toBe('p2');
    // Not Part 2 again: Next Up would play the same episode over and over.
    expect(episodeAfter(twoParts, 1, 5, 'p2')?.episode.id).toBe('tt1:x:6');
    expect(episodeBefore(twoParts, 1, 5, 'p2')?.episode.id).toBe('p1');
    expect(episodeBefore(twoParts, 1, 5, 'p1')?.episode.id).toBe('tt1:x:4');
  });
});

describe('metaValues', () => {
  const base: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };

  it('keeps only the parts a title has, so separators never dangle', () => {
    expect(metaValues({ ...base, year: '2010', runtime: '15 min', genres: ['Animation', 'Fantasy'] })).toEqual(['2010', '15 min', 'Animation, Fantasy']);
    expect(metaValues({ ...base, runtime: '15 min' })).toEqual(['15 min']);
    expect(metaValues(base)).toEqual([]);
  });

  it('treats blank values from an addon as missing', () => {
    expect(metaValues({ ...base, year: ' ', runtime: '', genres: ['  ', 'Drama', ''] })).toEqual(['Drama']);
    expect(metaValues({ ...base, year: '2010', genres: [' '] })).toEqual(['2010']);
  });

  it('leaves out genres when asked, and lists at most three', () => {
    expect(metaValues({ ...base, year: '2010', genres: ['Drama'] }, { genres: false })).toEqual(['2010']);
    expect(genreLine({ ...base, genres: ['A', 'B', 'C', 'D'] })).toBe('A, B, C');
  });
});

describe('runtimeLabel', () => {
  it('writes a readable runtime in the interface’s words, and keeps the addon’s text otherwise', () => {
    expect(runtimeLabel('111 min')).toBe('111 min');
    expect(runtimeLabel('2h 22min')).toBe('142 min');
    expect(runtimeLabel('45')).toBe('45 min');
    expect(runtimeLabel('two hours')).toBe('two hours');
    expect(runtimeLabel(undefined)).toBeUndefined();
  });
});

describe('upcomingRelease', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  it('gives a future release date, and nothing once it is out', () => {
    expect(upcomingRelease({ released: '2026-12-18T00:00:00.000Z' }, now)).toBe(Date.parse('2026-12-18T00:00:00Z'));
    expect(upcomingRelease({ released: '2026-10-14' }, now)).toBeNull();
    expect(upcomingRelease({ released: '2025-01-01' }, now)).toBeNull();
  });

  it('says soon for a later year without a date, and ignores ranges and junk', () => {
    expect(upcomingRelease({ year: '2027' }, now)).toBe('soon');
    expect(upcomingRelease({ year: '2026' }, now)).toBeNull();
    expect(upcomingRelease({ year: '2027–' }, now)).toBeNull();
    expect(upcomingRelease({ released: 'soon', year: undefined }, now)).toBeNull();
  });
});
