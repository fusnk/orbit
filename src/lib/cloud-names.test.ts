import { describe, expect, it } from 'vitest';
import { arrangeCloud, countByProvider, displayName, matchingItems, normalizeName, parseCloudName, pickFiles, pickMatch, sameTitle, type CloudFile, type CloudItem } from './cloud-names';

const item = (over: Partial<CloudItem>): CloudItem => ({ provider: 'torbox', id: 't1', name: 'X', size: 0, state: 'ready', progress: 100, added: null, deletable: true, ...over });
const file = (over: Partial<CloudFile>): CloudFile => ({ index: 0, name: 'a.mkv', size: 100, video: true, extra: false, address: 'orbit-debrid://torbox/t1/0', ...over });

describe('parseCloudName', () => {
  it('reads movies with their year', () => {
    expect(parseCloudName('The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv')).toEqual({ name: 'The Matrix', year: '1999', pack: false });
    expect(parseCloudName('Blade Runner 2049 (2017) [2160p]')).toEqual({ name: 'Blade Runner 2049', year: '2017', pack: false });
    expect(parseCloudName('1917.2019.REMUX')).toEqual({ name: '1917', year: '2019', pack: false });
  });

  it('reads episodes and season packs', () => {
    expect(parseCloudName('Show.Name.S02E03.1080p.WEB.h264.mkv')).toEqual({ name: 'Show Name', season: 2, episode: 3, pack: false });
    expect(parseCloudName('Show Name 1x05 720p')).toEqual({ name: 'Show Name', season: 1, episode: 5, pack: false });
    expect(parseCloudName('Show.Name.2019.S01.1080p')).toEqual({ name: 'Show Name', year: '2019', season: 1, pack: true });
    expect(parseCloudName('Show Name Season 3 Complete')).toEqual({ name: 'Show Name', season: 3, pack: true });
    expect(parseCloudName('Show.Name.S01-S04.Complete')).toEqual({ name: 'Show Name', season: 1, pack: true });
    expect(parseCloudName('Show Name COMPLETE 1080p')).toEqual({ name: 'Show Name', pack: true });
  });

  it('never reads a resolution as an episode', () => {
    expect(parseCloudName('Movie.1920x1080.2020').episode).toBeUndefined();
  });

  it('names untitled files', () => {
    expect(displayName(parseCloudName('Show.S02E03.mkv'))).toBe('Show S02E03');
    expect(displayName(parseCloudName('Movie.2020.mkv'))).toBe('Movie');
  });
});

describe('matching', () => {
  it('compares names loosely', () => {
    expect(normalizeName('The Lord of the Rings: The Fellowship')).toBe(normalizeName('Lord.of.the.Rings The Fellowship'.replace(/\./g, ' ')));
    expect(normalizeName('Amélie')).toBe('amelie');
    expect(normalizeName("Grey's Anatomy")).toBe('greys anatomy');
    expect(normalizeName('Fast & Furious')).toBe('fast and furious');
  });

  it('needs the same kind, name and a year that fits', () => {
    const movie = { name: 'The Matrix', type: 'movie', year: '1999' };
    expect(sameTitle(parseCloudName('The.Matrix.1999.1080p'), movie)).toBe(true);
    expect(sameTitle(parseCloudName('The.Matrix.2000.1080p'), movie)).toBe(true);
    expect(sameTitle(parseCloudName('The.Matrix.2003.1080p'), movie)).toBe(false);
    expect(sameTitle(parseCloudName('The.Matrix.Reloaded.2003'), movie)).toBe(false);
    expect(sameTitle(parseCloudName('The.Matrix.S01E01'), movie)).toBe(false);
    const show = { name: 'Show Name', type: 'series', year: '2011–2019' };
    expect(sameTitle(parseCloudName('Show.Name.S03E01'), show)).toBe(true);
    expect(sameTitle(parseCloudName('Show.Name.2015.S05'), show)).toBe(true);
    expect(sameTitle(parseCloudName('Show.Name.2022.S01'), show)).toBe(false);
    expect(sameTitle(parseCloudName('Show.Name.2026.S01'), { name: 'Show Name', type: 'series', year: '2025-' })).toBe(true);
    expect(sameTitle(parseCloudName('Show.Name.S01'), { name: 'Show Name', type: 'channel' })).toBe(false);
  });

  it('picks a search result only when confident', () => {
    const results = [
      { id: 'tt1', name: 'Dune', type: 'movie', year: '1984' },
      { id: 'tt2', name: 'Dune', type: 'movie', year: '2021' },
      { id: 'tt3', name: 'Dune: Part Two', type: 'movie', year: '2024' },
    ];
    expect(pickMatch(results, parseCloudName('Dune.2021.2160p'))?.id).toBe('tt2');
    expect(pickMatch(results, parseCloudName('Dune.1984.1080p'))?.id).toBe('tt1');
    // Two films of that name and no year: not a guess.
    expect(pickMatch(results, parseCloudName('Dune.1080p.WEB'))).toBeUndefined();
    expect(pickMatch([results[2]!], parseCloudName('Dune Part Two 2160p'))?.id).toBe('tt3');
    expect(pickMatch(results, parseCloudName('Arrival.2016'))).toBeUndefined();
  });

  it('finds ready items that may hold a title', () => {
    const items = [
      item({ id: 't1', name: 'Show.Name.S01.1080p' }),
      item({ id: 't2', name: 'Show.Name.S02.1080p' }),
      item({ id: 't3', name: 'Show.Name.S01E04.720p', provider: 'realdebrid' }),
      item({ id: 't4', name: 'Show.Name.S01.2160p', state: 'downloading' }),
      item({ id: 't5', name: 'Other.Show.S01' }),
      item({ id: 't6', name: 'Show Name Complete Series' }),
    ];
    const show = { name: 'Show Name', type: 'series' };
    expect(matchingItems(items, show, 1).map((i) => i.id)).toEqual(['t1', 't3', 't6']);
    expect(matchingItems(items, show).map((i) => i.id)).toEqual(['t1', 't2', 't3', 't6']);
  });

  it('picks the files that play a movie or an episode', () => {
    const files = [
      file({ index: 1, name: 'Movie/Movie.mkv', size: 900 }),
      file({ index: 2, name: 'Movie/Sample/sample.mkv', size: 10, extra: true }),
      file({ index: 3, name: 'Movie/Movie.Extended.mkv', size: 1200 }),
      file({ index: 4, name: 'Movie/Movie.Packed.mkv', size: 5000, address: undefined }),
    ];
    expect(pickFiles(files, 'Movie.2020', 'movie').map((f) => f.index)).toEqual([3]);
    const pack = [
      file({ index: 1, name: 'S01/Show.S01E01.mkv', season: 1, episode: 1 }),
      file({ index: 2, name: 'S01/Show.S01E02.mkv', season: 1, episode: 2 }),
    ];
    expect(pickFiles(pack, 'Show.S01', 'series', { season: 1, episode: 2 }).map((f) => f.index)).toEqual([2]);
    expect(pickFiles(pack, 'Show.S01', 'series', { season: 1, episode: 3 })).toEqual([]);
    expect(pickFiles(pack, 'Show.S01', 'series')).toEqual([]);
    // One episode whose file has an unnumbered name: the item's name says which.
    const single = [file({ index: 7, name: 'Show.Episode.mkv' })];
    expect(pickFiles(single, 'Show.S01E04.720p', 'series', { season: 1, episode: 4 }).map((f) => f.index)).toEqual([7]);
    expect(pickFiles(single, 'Show.S01E04.720p', 'series', { season: 1, episode: 5 })).toEqual([]);
  });
});

describe('arrangeCloud', () => {
  const items = [
    item({ provider: 'realdebrid', id: 'A', name: 'Alpha.2020', size: 5, added: 1, state: 'ready' }),
    item({ provider: 'torbox', id: 't1', name: 'Beta.S01', size: 50, added: 3, state: 'downloading' }),
    item({ provider: 'torbox', id: 't2', name: 'Gamma.2019', size: 20, added: null, state: 'error' }),
    item({ provider: 'realdebrid', id: 'B', name: 'The.Delta.2021', size: 1, added: 2, state: 'queued' }),
  ];
  const all = { query: '', provider: null, filter: 'all', sort: 'added' } as const;
  const ids = (list: CloudItem[]) => list.map((i) => i.id);

  it('merges providers newest first, undated last', () => {
    expect(ids(arrangeCloud(items, all))).toEqual(['t1', 'B', 'A', 't2']);
  });

  it('filters by provider, status and name', () => {
    expect(ids(arrangeCloud(items, { ...all, provider: 'torbox' }))).toEqual(['t1', 't2']);
    expect(ids(arrangeCloud(items, { ...all, filter: 'ready' }))).toEqual(['A']);
    expect(ids(arrangeCloud(items, { ...all, filter: 'active' }))).toEqual(['t1', 'B']);
    expect(ids(arrangeCloud(items, { ...all, filter: 'error' }))).toEqual(['t2']);
    expect(ids(arrangeCloud(items, { ...all, query: 'delta' }))).toEqual(['B']);
    expect(ids(arrangeCloud(items, { ...all, query: 'GAM' }))).toEqual(['t2']);
  });

  it('sorts by name or size', () => {
    expect(ids(arrangeCloud(items, { ...all, sort: 'name' }))).toEqual(['A', 't1', 't2', 'B']);
    expect(ids(arrangeCloud(items, { ...all, sort: 'size' }))).toEqual(['t1', 't2', 'A', 'B']);
  });

  it('counts each provider', () => {
    expect([...countByProvider(items)]).toEqual([
      ['realdebrid', 2],
      ['torbox', 2],
    ]);
  });
});
