import { describe, expect, it } from 'vitest';
import { BEST_MATCH_SCORE, bestMatch, parseRelease, releaseName, releaseScore, shortReleaseName, subtitleRelease } from './subtitle-match';

describe('releaseName', () => {
  it('decodes names from web addresses and drops folders and extension', () => {
    expect(releaseName('https://debrid.example/dl/abc/Sandfall.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-NOVA.mkv')).toBe('Sandfall.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-NOVA');
    expect(releaseName('Sandfall%20Part%20Two%202024%201080p%20BluRay%20x264-ALPHA.mkv')).toBe('Sandfall Part Two 2024 1080p BluRay x264-ALPHA');
    expect(releaseName('Sandfall+Part+Two+2024+1080p+BluRay.mkv?token=x')).toBe('Sandfall Part Two 2024 1080p BluRay');
    expect(releaseName('100%.real.srt')).toBe('100%.real');
  });
});

describe('parseRelease', () => {
  it('reads a movie release', () => {
    expect(parseRelease('The.Quiet.Harbour.1994.1080p.BluRay.x264-ALPHA.mkv')).toEqual({
      title: ['the', 'quiet', 'harbour'],
      year: 1994,
      source: 'bluray',
      resolution: 1080,
      group: 'alpha',
    });
  });

  it('reads episodes, web sources and subtitle tags', () => {
    const r = parseRelease('Lighthouse.S02E03.Who.Is.Here.2160p.ATVP.WEB-DL.DDP5.1.HDR.H.265-ZeTa.eng.forced.srt');
    expect(r).toMatchObject({ title: ['lighthouse'], season: 2, episode: 3, source: 'web-dl', resolution: 2160, group: 'zeta' });
    expect(parseRelease('show 1x05 HDTV').source).toBe('hdtv');
    expect(parseRelease('Show.S01.E05.720p.WEBRip').episode).toBe(5);
    expect(parseRelease('[SubsGroup] Starfall - 12 (1080p) [ABCD1234].mkv')).toMatchObject({ group: 'subsgroup', resolution: 1080 });
  });

  it('keeps a year that is the title', () => {
    expect(parseRelease('1917.2019.1080p.BluRay').title).toEqual(['1917']);
    expect(parseRelease('1917.2019.1080p.BluRay').year).toBe(2019);
  });

  it('does not take format words for a group', () => {
    expect(parseRelease('Movie.2020.1080p.WEB-DL').group).toBeUndefined();
    expect(parseRelease('Movie.2020.1080p.BluRay.DTS-HD').group).toBeUndefined();
    expect(parseRelease('Movie.2020.25fps.DVDRip').fps).toBe(25);
  });
});

describe('releaseScore', () => {
  const video = parseRelease('Sandfall.Part.Two.2024.1080p.BluRay.x264-ALPHA.mkv');

  it('prefers the same release group', () => {
    const same = parseRelease('Sandfall.Part.Two.2024.1080p.BluRay.x264-ALPHA.srt');
    const other = parseRelease('Sandfall.Part.Two.2024.1080p.BluRay.x264-BRAVO.srt');
    expect(releaseScore(video, same)).toBeGreaterThan(releaseScore(video, other));
  });

  it('weighs the source almost like the title: BluRay over WEB-DL for a BluRay', () => {
    const bluray = parseRelease('Sandfall Part Two 2024 BluRay.srt');
    const web = parseRelease('Sandfall.Part.Two.2024.1080p.WEB-DL.DDP5.1-NOVA.srt');
    expect(releaseScore(video, bluray)).toBeGreaterThan(releaseScore(video, web));
    // WEB-DL and WEBRip are usually the same cut.
    const webVideo = parseRelease('Sandfall.Part.Two.2024.1080p.WEB-DL');
    expect(releaseScore(webVideo, parseRelease('Sandfall.Part.Two.2024.WEBRip'))).toBeGreaterThan(releaseScore(webVideo, parseRelease('Sandfall.Part.Two.2024.BluRay')));
  });

  it('scores names from web addresses once decoded', () => {
    const encoded = parseRelease('https://debrid.example/d/Sandfall%20Part%20Two%202024%201080p%20BluRay%20x264-ALPHA.mkv');
    expect(releaseScore(encoded, parseRelease('Sandfall.Part.Two.2024.1080p.BluRay.x264-ALPHA.srt'))).toBeGreaterThanOrEqual(BEST_MATCH_SCORE);
    const plus = parseRelease('Sandfall+Part+Two+2024+1080p+BluRay+x264-ALPHA.mkv');
    expect(plus.group).toBe('alpha');
    expect(plus.title).toEqual(['sandfall', 'part', 'two']);
  });

  it('counts a different episode or year against it', () => {
    const episode = parseRelease('Show.S01E02.1080p.WEB-DL-GRP');
    expect(releaseScore(episode, parseRelease('Show.S01E03.1080p.WEB-DL-GRP'))).toBeLessThan(0);
    expect(releaseScore(episode, parseRelease('Show.S01E02.1080p.WEB-DL-GRP'))).toBeGreaterThan(BEST_MATCH_SCORE);
    expect(releaseScore(video, parseRelease('Sandfall.1984.BluRay'))).toBeLessThan(releaseScore(video, parseRelease('Sandfall.Part.Two.2024')));
  });

  it('uses frame rates when both are known', () => {
    const pal = parseRelease('Movie.1999.25fps.DVDRip');
    expect(releaseScore(pal, subtitleRelease({ name: 'Movie.1999.DVDRip.srt', fps: 25 }))).toBeGreaterThan(releaseScore(pal, subtitleRelease({ name: 'Movie.1999.DVDRip.srt', fps: 23.976 })));
  });

  it('is 0 when nothing is known', () => {
    expect(releaseScore(parseRelease(''), parseRelease('36919'))).toBe(0);
  });
});

describe('bestMatch', () => {
  const video = parseRelease('Movie.2019.1080p.WEB-DL.x264-GRP');
  const subs = [
    { name: 'https://subs.example/file/1' },
    { name: 'Movie.2019.BluRay.x264-OTHER.srt' },
    { name: 'Movie.2019.1080p.WEB-DL.x264-GRP.srt', group: 'GRP' },
    { name: 'Movie.2019.1080p.WEB-DL.x264-GRP.srt' },
  ];

  it('picks the closest, the first on a tie', () => {
    expect(bestMatch(subs, video, subtitleRelease).index).toBe(2);
    expect(bestMatch([subs[0]!, { name: 'https://subs.example/file/2' }], video, subtitleRelease).index).toBe(0);
    expect(bestMatch([], video, subtitleRelease).index).toBe(-1);
  });

  it('fills the group from what the addon says', () => {
    expect(subtitleRelease({ name: 'movie.srt', group: 'GRP', fps: 23.976 })).toMatchObject({ group: 'grp', fps: 23.976 });
  });
});

describe('shortReleaseName', () => {
  it('reads as words, without the extension or language tags', () => {
    expect(shortReleaseName('The.Movie.2019.1080p.WEB-DL.x264-NTb.eng.sdh.srt')).toBe('The Movie 2019 1080p WEB-DL x264-NTb');
  });

  it('is cut to fit', () => {
    const name = shortReleaseName(`${'Long.Name.'.repeat(10)}srt`, 20)!;
    expect([...name].length).toBe(20);
    expect(name.endsWith('…')).toBe(true);
  });

  it('never shows an address or an empty name', () => {
    expect(shortReleaseName('https://subs.example/download/abc?token=1')).toBeUndefined();
    expect(shortReleaseName('www.example.com/x.srt')).toBeUndefined();
    expect(shortReleaseName(undefined)).toBeUndefined();
    expect(shortReleaseName('.srt')).toBeUndefined();
  });
});
