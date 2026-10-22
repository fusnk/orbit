import { describe, expect, it } from 'vitest';
import type { Collection } from './collections';
import { CollectionsFileError, exportCollections, mapSource, MAX_FILE_CHARS, parseCollectionsFile } from './nuvio-collections';

/** Shaped like real files: Nuvio's own export and a community builder's output (trimmed). */
const SAMPLE = [
  {
    id: 'collection-SPOTLIGHTS',
    title: 'Spotlight',
    pinToTop: true,
    focusGlowEnabled: true,
    showAllTab: true,
    viewMode: 'FOLLOW_LAYOUT',
    folders: [
      {
        id: 'folder-SPOTHEAD',
        title: 'The Headliner',
        hideTitle: true,
        tileShape: 'LANDSCAPE',
        focusGifEnabled: true,
        coverImageUrl: 'https://raw.githubusercontent.com/example/art/headliner-cover.png',
        titleLogoUrl: 'https://raw.githubusercontent.com/example/art/headliner-logo.png',
        heroBackdropUrl: 'https://raw.githubusercontent.com/example/art/headliner-backdrop.jpg',
        catalogSources: [],
        sources: [
          { title: 'The Headliner: Pedro Pascal', name: 'The Headliner', genre: 'All', provider: 'tmdb', mediaType: 'MOVIE', tmdbSourceType: 'LIST', tmdbId: '8687275', sortBy: 'vote_average.desc', filters: {} },
        ],
      },
      {
        id: 'folder-SAGA',
        title: 'The Saga: Alien',
        tileShape: 'POSTER',
        coverImageUrl: 'http://insecure.example/alien.jpg',
        sources: [
          { provider: 'tmdb', mediaType: 'MOVIE', tmdbSourceType: 'COLLECTION', tmdbId: 8091, sortBy: 'original' },
          { provider: 'tmdb', mediaType: 'TV', tmdbSourceType: 'DISCOVER', tmdbId: null, sortBy: 'first_air_date.desc', filters: { withGenres: '10765', withOriginalLanguage: 'en', voteCountGte: 10, 'vote_count.gte': 10, releaseDateGte: 'yesterday' } },
          { provider: 'trakt', mediaType: 'TV', traktListId: 35035001, sortBy: 'rank', sortHow: 'asc', title: 'All Services Combined' },
          { provider: 'mdblist', listId: 123, title: 'MDBList picks' },
        ],
      },
    ],
  },
  {
    id: 'd2c67354-d395-4345-9901-d83e5f10e000',
    title: 'Streaming Services',
    backdropImageUrl: null,
    viewMode: 'FOLLOW_HOME',
    showAllTab: false,
    folders: [
      {
        id: '3b417ba7-118e-4b34-a98e-627dbce08975',
        title: 'Netflix',
        coverImageUrl: 'https://raw.githubusercontent.com/example/images/Netflix.jpg',
        focusGifUrl: null,
        coverEmoji: null,
        tileShape: 'LANDSCAPE',
        hideTitle: true,
        catalogSources: [{ addonId: 'pw.ers.netflix-catalog', type: 'movie', catalogId: 'nfx' }],
        _coverMode: 'image',
      },
      {
        id: 'fad8800d',
        title: 'Disney+',
        sources: [{ type: 'movies', genre: '', addonId: 'aio-metadata', provider: 'addon', catalogId: 'tmdb.discover.movie.disney', addonName: 'AIOMetadata', title: 'Disney+ Movies' }],
        catalogSources: [{ type: 'movies', addonId: 'aio-metadata', catalogId: 'tmdb.discover.movie.disney' }],
      },
      { id: 'blank', title: '   ', sources: [] },
    ],
  },
];

describe('collections files', () => {
  it('reads every folder as a collection, mapping each source', () => {
    const { folders, skipped } = parseCollectionsFile(JSON.stringify(SAMPLE));
    expect(skipped).toBe(1);
    expect(folders.map((f) => [f.group, f.name, f.shape])).toEqual([
      ['Spotlight', 'The Headliner', 'landscape'],
      ['Spotlight', 'The Saga: Alien', 'poster'],
      ['Streaming Services', 'Netflix', 'landscape'],
      ['Streaming Services', 'Disney+', 'poster'],
    ]);
    const [headliner, saga, netflix, disney] = folders;
    expect(headliner!.cover).toBe('https://raw.githubusercontent.com/example/art/headliner-cover.png');
    expect(headliner!.backdrop).toBe('https://raw.githubusercontent.com/example/art/headliner-backdrop.jpg');
    // Ids written as strings are read as numbers.
    expect(headliner!.sources).toEqual([{ kind: 'tmdb', tmdb: 'list', id: 8687275, media: 'movie', sort: 'vote_average.desc', filters: undefined, label: 'The Headliner: Pedro Pascal' }]);
    // http art is dropped; known filters with valid values are kept, the rest left out.
    expect(saga!.cover).toBeUndefined();
    expect(saga!.sources).toEqual([
      { kind: 'tmdb', tmdb: 'collection', id: 8091, media: 'movie', sort: 'original', filters: undefined, label: undefined },
      { kind: 'tmdb', tmdb: 'discover', id: undefined, media: 'tv', sort: 'first_air_date.desc', filters: { withGenres: '10765', withOriginalLanguage: 'en', voteCountGte: 10 }, label: undefined },
      { kind: 'trakt', list: 35035001, media: 'tv', sort: 'rank', sortHow: 'asc', label: 'All Services Combined' },
    ]);
    expect(saga!.dropped).toEqual([{ provider: 'mdblist', label: 'MDBList picks' }]);
    // Older files' catalogSources are addon sources; "movies" is Stremio's "movie".
    expect(netflix!.sources).toEqual([{ kind: 'addon', addon: 'pw.ers.netflix-catalog', type: 'movie', catalog: 'nfx', genre: undefined, addonName: undefined, label: undefined }]);
    expect(disney!.sources).toEqual([{ kind: 'addon', addon: 'aio-metadata', type: 'movie', catalog: 'tmdb.discover.movie.disney', genre: undefined, addonName: 'AIOMetadata', label: 'Disney+ Movies' }]);
  });

  it('reads the other shapes found in the wild', () => {
    const folder = { title: 'Pixar', sources: [{ provider: 'tmdb', tmdbSourceType: 'COMPANY', tmdbId: 3, mediaType: 'MOVIE' }] };
    for (const shape of [{ collections: SAMPLE }, SAMPLE[1], [folder], { name: 'Mine', folders: [folder] }]) {
      expect(parseCollectionsFile(JSON.stringify(shape)).folders.length).toBeGreaterThan(0);
    }
    expect(parseCollectionsFile(JSON.stringify([folder])).folders[0]!.group).toBeUndefined();
  });

  it('keeps names Orbit’s storage accepts: whole characters, no control characters', () => {
    const file = JSON.stringify([{ title: 'g\u0080', folders: [{ title: `${'A'.repeat(59)}🎬🎬`, sources: [] }, { title: 'Pixar\u0085', sources: [] }] }]);
    const [long, pixar] = parseCollectionsFile(file).folders;
    expect(long!.name).toBe(`${'A'.repeat(59)}🎬`);
    expect(pixar!.name).toBe('Pixar');
    expect(pixar!.group).toBe('g');
  });

  it('refuses junk', () => {
    const problem = (text: string) => {
      try {
        parseCollectionsFile(text);
        return null;
      } catch (err) {
        return err instanceof CollectionsFileError ? err.problem : 'other';
      }
    };
    expect(problem('not json')).toBe('not-json');
    expect(problem('{"orbitBackup":1}')).toBe('not-collections');
    expect(problem('[1, "two", null]')).toBe('not-collections');
    expect(problem('[{"title":"x","folders":[{"title":""}]}]')).toBe('not-collections');
    expect(problem(' '.repeat(MAX_FILE_CHARS + 1))).toBe('too-large');
  });

  it('reads a file as large as Orbit exports (8 MiB; 2 MiB ran out near 1,500 titles)', () => {
    expect(MAX_FILE_CHARS).toBe(8 * 1024 * 1024);
    const titles = Array.from({ length: 1600 }, (_, i) => ({ meta: { id: `tt${i}`, type: 'movie', name: `Title ${i}`, description: 'd'.repeat(1500) } }));
    const file = JSON.stringify([{ title: 'Mine', folders: [{ title: 'Picks', orbitTitles: titles }] }]);
    expect(file.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(parseCollectionsFile(file).folders[0]!.titles.length).toBeGreaterThan(0);
  });

  it('leaves out a title larger than Orbit stores, rather than failing the import', () => {
    const big = { meta: { id: 'tt2', type: 'movie', name: 'Two' }, origins: [{ key: 'k', name: 'x'.repeat(20_000) }] };
    const file = [{ title: 'Mine', folders: [{ title: 'Picks', orbitTitles: [{ meta: { id: 'tt1', type: 'movie', name: 'One' } }, big] }] }];
    expect(parseCollectionsFile(JSON.stringify(file)).folders[0]!.titles.map((t) => t.id)).toEqual(['tt1']);
  });

  it('never keeps a source it can’t check', () => {
    expect(mapSource({ provider: 'tmdb', tmdbSourceType: 'LIST', mediaType: 'MOVIE' })).toEqual({ dropped: { provider: 'tmdb', label: undefined } });
    expect(mapSource({ provider: 'tmdb', tmdbSourceType: 'SCRIPT', tmdbId: 1 })).toHaveProperty('dropped');
    expect(mapSource({ provider: 'tmdb', tmdbSourceType: 'COMPANY', tmdbId: -4 })).toHaveProperty('dropped');
    expect(mapSource({ provider: 'trakt', traktListId: 0 })).toHaveProperty('dropped');
    expect(mapSource({ addonId: 'a', type: 'movie' })).toHaveProperty('dropped');
    expect(mapSource({ addonId: 'a\u0000', type: 'movie', catalogId: 'c' })).toEqual({ source: { kind: 'addon', addon: 'a', type: 'movie', catalog: 'c', genre: undefined, addonName: undefined, label: undefined } });
    expect(mapSource('addon')).toHaveProperty('dropped');
    expect(mapSource({ provider: 'tmdb', tmdbSourceType: 'DISCOVER', mediaType: 'MOVIE', sortBy: 'revenue.desc', filters: { withGenres: '28&x=1', year: '2020' } })).toEqual({
      source: { kind: 'tmdb', tmdb: 'discover', id: undefined, media: 'movie', sort: undefined, filters: { year: 2020 }, label: undefined },
    });
  });

  it('exports in the same format, and reads its own export back', () => {
    const collections: Collection[] = [
      { id: 'a1', name: 'Pixar', group: 'Studios', cover: 'https://img.example/p.jpg', shape: 'landscape', sources: [{ kind: 'tmdb', tmdb: 'company', id: 3, media: 'movie', sort: 'popularity.desc', filters: undefined, label: undefined }], titles: [], createdAt: 1 },
      { id: 'b2', name: 'Picks', shape: 'poster', sources: [], titles: [{ id: 'tt1', type: 'movie', name: 'One', genres: [], origins: [] }], createdAt: 2 },
      { id: 'c3', name: 'Netflix', group: 'Studios', shape: 'poster', sources: [{ kind: 'addon', addon: 'x', type: 'movie', catalog: 'nfx', genre: 'Drama', addonName: undefined, label: undefined }], titles: [], createdAt: 3 },
    ];
    const file = exportCollections(collections, 'Orbit') as { title: string; folders: { title: string; tileShape: string; catalogSources: unknown[] }[] }[];
    expect(file.map((g) => [g.title, g.folders.map((f) => f.title)])).toEqual([
      ['Studios', ['Pixar', 'Netflix']],
      ['Orbit', ['Picks']],
    ]);
    expect(file[0]!.folders[0]!.tileShape).toBe('LANDSCAPE');
    expect(file[0]!.folders[1]!.catalogSources).toEqual([{ addonId: 'x', type: 'movie', catalogId: 'nfx', genre: 'Drama' }]);
    const back = parseCollectionsFile(JSON.stringify(file)).folders;
    expect(back.map((f) => [f.group, f.name, f.cover, f.shape])).toEqual([
      ['Studios', 'Pixar', 'https://img.example/p.jpg', 'landscape'],
      ['Studios', 'Netflix', undefined, 'poster'],
      ['Orbit', 'Picks', undefined, 'poster'],
    ]);
    expect(back[0]!.sources).toEqual(collections[0]!.sources);
    expect(back[1]!.sources).toEqual(collections[2]!.sources);
    expect(back[2]!.titles.map((t) => t.name)).toEqual(['One']);
  });
});
