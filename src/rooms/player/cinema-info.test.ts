import { describe, expect, it } from 'vitest';
import { continueTarget, infoMeta, runtimeText, streamBadges } from './cinema-info';
import type { TrackInfo } from './tracks';

const sub: TrackInfo = { id: 3, kind: 'sub', title: null, lang: 'en', codec: null, channels: null, selected: false, secondary: false, external: false, default: false, forced: false };
const source = (meta: string, filename?: string) => ({ label: '1080p', meta, filename });

describe('Cinema info', () => {
  it('writes a runtime in hours and minutes, or keeps text it can’t read', () => {
    expect(runtimeText('92 min', 'en')).toBe('1 hr, 32 min');
    expect(runtimeText('2h', 'en')).toBe('2 hr');
    expect(runtimeText('45', 'en')).toBe('45 min');
    expect(runtimeText('two hours', 'en')).toBe('two hours');
    expect(runtimeText(undefined, 'en')).toBe('');
  });

  it('meta line: first genre, year and runtime, blanks left out', () => {
    expect(infoMeta({ genres: ['Action', 'Thriller'], year: '2020', runtime: '92 min' }, 'en')).toEqual(['Action', '2020', '1 hr, 32 min']);
    expect(infoMeta({ genres: [' '], year: undefined, runtime: '' }, 'en')).toEqual([]);
  });

  it('badges: mpv’s resolution, HDR from the source name, CC with subtitles', () => {
    expect(streamBadges(2160, source('HDR10 · x265 · 12 GB'), [sub])).toEqual(['4K', 'HDR10', 'CC']);
    // A name claiming 4K doesn't count: the resolution is mpv's.
    expect(streamBadges(1080, source('', 'Film.2020.2160p.DV.mkv'), [])).toEqual(['1080p', 'Dolby Vision']);
    expect(streamBadges(null, source(''), [])).toEqual([]);
  });

  it('second pill: episodes for a series, More like this for a film with suggestions', () => {
    expect(continueTarget({ seasons: [{ number: 1, episodes: [] }] } as never, 0, {})).toBe('episodes');
    expect(continueTarget({}, 4, {})).toBe('similar');
    expect(continueTarget({}, 0, {})).toBeNull();
    expect(continueTarget({}, 4, { live: true })).toBeNull();
    expect(continueTarget({}, 4, { trailer: true })).toBeNull();
  });
});
