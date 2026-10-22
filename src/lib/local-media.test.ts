import { describe, expect, it } from 'vitest';
import { dropKind, fileName, isLocalId, titleFromFileName } from './local-media';

describe('local files', () => {
  it('knows local ids from real ones', () => {
    expect(isLocalId('local:0123456789abcdef')).toBe(true);
    expect(isLocalId('cloud:torbox:t42:3')).toBe(true);
    for (const id of ['tt0133093', 'kitsu:1', 'tmdb:603', 'tt1:1:2', 'localhost', 'Local:1']) expect(isLocalId(id)).toBe(false);
  });

  it('sorts dropped files by extension', () => {
    expect(dropKind('C:\\Videos\\Film.MKV')).toBe('video');
    expect(dropKind('/home/me/clip.m2ts')).toBe('video');
    expect(dropKind('C:\\Videos\\Film.en.srt')).toBe('subtitle');
    expect(dropKind('/x/y.ass')).toBe('subtitle');
    for (const path of ['C:\\setup.exe', '/x/list.m3u', '/x/folder', '/x/notes.txt', '/x/.mkv.lnk']) expect(dropKind(path)).toBeNull();
  });

  it('takes the file name from either kind of path', () => {
    expect(fileName('C:\\Videos\\Film.mkv')).toBe('Film.mkv');
    expect(fileName('/home/me/Film.mkv')).toBe('Film.mkv');
  });

  it('turns release names into titles', () => {
    expect(titleFromFileName('The.Matrix.1999.1080p.BluRay.x264-GROUP')).toEqual({ name: 'The Matrix', year: '1999' });
    expect(titleFromFileName('Blade_Runner_2049_2017_2160p')).toEqual({ name: 'Blade Runner 2049', year: '2017' });
    expect(titleFromFileName('Some Show S02E05 720p WEB-DL')).toEqual({ name: 'Some Show S02E05' });
    expect(titleFromFileName('[Group] Movie Name (2020) [1080p]')).toEqual({ name: 'Movie Name', year: '2020' });
    expect(titleFromFileName('holiday video')).toEqual({ name: 'holiday video' });
    // A show's year before the episode code doesn't cut the code off: it's what tells its files apart.
    expect(titleFromFileName('Doctor.Who.2005.S01E01.1080p')).toEqual({ name: 'Doctor Who S01E01', year: '2005' });
    // A title that is only a year stays a title.
    expect(titleFromFileName('1917.2019.1080p')).toEqual({ name: '1917', year: '2019' });
  });
});
