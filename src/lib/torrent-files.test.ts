import { describe, expect, it } from 'vitest';
import { arrangeFiles, baseName, defaultSort, episodeHint, episodeOfFile, folderOf, infoHashOf, matchesHint, parseTorrentFiles, withFile, type TorrentFile } from './torrent-files';

const HASH = '08ada5a7a6183aae1e09d831df6748d566095a10';
const ep = (number: number) => ({ id: `e${number}`, number });
const show = {
  seasons: [
    { number: 1, episodes: [ep(1), ep(2), ep(3)] },
    { number: 2, episodes: [ep(1), ep(2)] },
    { number: 0, episodes: [ep(1)] },
  ],
};
const file = (index: number, name: string, extra: Partial<TorrentFile> = {}): TorrentFile => ({ index, name, size: 100, video: true, extra: false, ...extra });

describe('episodeHint', () => {
  it('counts the episode from the first season, leaving specials out', () => {
    expect(episodeHint(show, { season: 1, episode: { number: 2 } })).toEqual({ season: 1, episode: 2, absolute: 2 });
    expect(episodeHint(show, { season: 2, episode: { number: 1 } })).toEqual({ season: 2, episode: 1, absolute: 4 });
  });

  it('gives no count for specials or episodes the title doesn’t list', () => {
    expect(episodeHint(show, { season: 0, episode: { number: 1 } })).toEqual({ season: 0, episode: 1 });
    expect(episodeHint(show, { season: 3, episode: { number: 1 } })).toEqual({ season: 3, episode: 1 });
    expect(episodeHint({}, { season: 1, episode: { number: 1 } })).toEqual({ season: 1, episode: 1 });
    expect(episodeHint(show, undefined)).toBeUndefined();
  });
});

describe('episodeOfFile', () => {
  it('finds the episode by season and number', () => {
    expect(episodeOfFile(show, { season: 2, episode: 2 })).toEqual({ season: 2, episode: ep(2) });
    expect(episodeOfFile(show, { season: 0, episode: 1 })).toEqual({ season: 0, episode: ep(1) });
    expect(episodeOfFile(show, { season: 2, episode: 9 })).toBeUndefined();
    expect(episodeOfFile(show, { season: 1 })).toBeUndefined();
  });

  it('reads a number without a season as counted across seasons', () => {
    expect(episodeOfFile(show, { episode: 2 })).toEqual({ season: 1, episode: ep(2) });
    expect(episodeOfFile(show, { episode: 4 })).toEqual({ season: 2, episode: ep(1) });
    expect(episodeOfFile(show, { episode: 6 })).toBeUndefined();
    expect(episodeOfFile(show, { episode: 0 })).toBeUndefined();
  });
});

describe('matchesHint', () => {
  it('reads files as the automatic choice does', () => {
    expect(matchesHint({ season: 2, episode: 1 }, { season: 2, episode: 1, absolute: 4 })).toBe(true);
    expect(matchesHint({ season: 1, episode: 1, lastEpisode: 2 }, { season: 1, episode: 2 })).toBe(true);
    expect(matchesHint({ episode: 4 }, { season: 2, episode: 1, absolute: 4 })).toBe(true);
    expect(matchesHint({ episode: 2 }, { season: 1, episode: 2 })).toBe(true);
    expect(matchesHint({ episode: 1 }, { season: 2, episode: 1 })).toBe(false);
    expect(matchesHint({ season: 2, episode: 4 }, { season: 2, episode: 1, absolute: 4 })).toBe(true);
    expect(matchesHint({ season: 1, episode: 3 }, { season: 1, episode: 2 })).toBe(false);
    expect(matchesHint({ season: 1 }, { season: 1, episode: 2 })).toBe(false);
    expect(matchesHint({ season: 1, episode: 2 }, undefined)).toBe(false);
  });
});

describe('magnets', () => {
  it('reads the info hash', () => {
    expect(infoHashOf(`magnet:?xt=urn:btih:${HASH}&so=2`)).toBe(HASH);
    expect(infoHashOf(`magnet:?xt=urn:btih:${HASH}`)).toBe(HASH);
    expect(infoHashOf('https://example.com/a.mkv')).toBeUndefined();
  });

  it('sets the file to play, replacing the addon’s', () => {
    expect(withFile(`magnet:?xt=urn:btih:${HASH}`, 4)).toBe(`magnet:?xt=urn:btih:${HASH}&so=4`);
    expect(withFile(`magnet:?xt=urn:btih:${HASH}&so=2&tr=udp%3A%2F%2Ft%3A80`, 7)).toBe(`magnet:?xt=urn:btih:${HASH}&so=7&tr=udp%3A%2F%2Ft%3A80`);
  });
});

describe('parseTorrentFiles', () => {
  it('keeps well-formed files and caps names', () => {
    const parsed = parseTorrentFiles({
      files: [
        { index: 0, name: 'x'.repeat(400), size: 5, video: true, extra: false, season: 1, episode: 2, lastEpisode: null },
        { index: -1, name: 'bad', size: 5 },
        { index: 1, name: 7, size: 5 },
        'nonsense',
      ],
      chosen: 0,
      playing: 'no',
    });
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]!.name).toHaveLength(300);
    expect(parsed.files[0]).toMatchObject({ season: 1, episode: 2, lastEpisode: undefined });
    expect(parsed.chosen).toBe(0);
    expect(parsed.playing).toBeUndefined();
    expect(parseTorrentFiles(null)).toEqual({ files: [], chosen: undefined, playing: undefined });
  });
});

describe('arrangeFiles', () => {
  const files = [
    file(0, 'Show S02/Show.S02E01.mkv', { season: 2, episode: 1, size: 300 }),
    file(1, 'Show S01/Show.S01E10.mkv', { season: 1, episode: 10, size: 200 }),
    file(2, 'Show S01/Show.S01E02.mkv', { season: 1, episode: 2, size: 500 }),
    file(3, 'Specials/Show.S00E01.mkv', { season: 0, episode: 1 }),
    file(4, 'Bonus.mkv', { size: 900 }),
    file(5, 'Sample/sample.mkv', { extra: true }),
    file(6, 'Show S01/Show.S01E02.srt', { video: false }),
  ];
  const order = (sort: 'episode' | 'name' | 'size', query = '', all = false) => arrangeFiles(files, { query, sort, all }).map((f) => f.index);

  it('lists episodes in order, specials after, unnumbered last', () => {
    expect(order('episode')).toEqual([2, 1, 0, 3, 4]);
  });

  it('sorts by name (numbers as numbers) and by size', () => {
    expect(order('name')).toEqual([4, 2, 1, 0, 3]);
    expect(order('size')).toEqual([4, 2, 0, 1, 3]);
  });

  it('hides extras and other files unless asked, and searches names', () => {
    expect(order('name', '', true)).toEqual([4, 5, 2, 6, 1, 0, 3]);
    expect(order('episode', 's01e0')).toEqual([2]);
    expect(order('episode', 'SAMPLE')).toEqual([]);
    expect(order('episode', 'SAMPLE', true)).toEqual([5]);
  });

  it('starts in episode order only when names carry episode numbers', () => {
    expect(defaultSort(files)).toBe('episode');
    expect(defaultSort([file(0, 'a.mkv'), file(1, 'b.mkv')])).toBe('name');
  });

  it('splits names into folder and file', () => {
    expect(baseName('Season 1/Show.S01E01.mkv')).toBe('Show.S01E01.mkv');
    expect(folderOf('Season 1/Show.S01E01.mkv')).toBe('Season 1');
    expect(baseName('film.mkv')).toBe('film.mkv');
    expect(folderOf('film.mkv')).toBe('');
  });
});
