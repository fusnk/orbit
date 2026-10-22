import { describe, expect, it } from 'vitest';
import { episodeLine, formatInfo, formatTime, parseSeconds, qualityLabel } from './format';

describe('parseSeconds', () => {
  it.each([
    ['1.5', 1.5],
    ['1,5', 1.5],
    ['-2', -2],
    ['−0.3 s', -0.3],
    ['+4', 4],
    [' 12 ', 12],
    ['.5', 0.5],
    ['0,25s', 0.25],
  ])('%s → %s', (input, expected) => expect(parseSeconds(input)).toBe(expected));

  it.each(['', 'abc', '1.2.3', '--1', '1-', '1,000,5'])('%s is not a number', (input) => expect(parseSeconds(input)).toBeNull());
});

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [5.9, '0:05'],
    [65, '1:05'],
    [3729, '1:02:09'],
    [-3, '0:00'],
    [Number.NaN, '0:00'],
  ])('%s → %s', (input, expected) => expect(formatTime(input)).toBe(expected));
});

describe('qualityLabel', () => {
  it.each([
    [2160, '4K'],
    [1608, '4K'],
    [1080, '1080p'],
    [800, '1080p'],
    [720, '720p'],
    [536, '720p'],
    [480, 'SD'],
    [0, null],
    [null, null],
  ])('%s → %s', (input, expected) => expect(qualityLabel(input)).toBe(expected));
});

describe('formatInfo', () => {
  it('turns mpv properties into readable rows', () => {
    const rows = formatInfo(
      {
        'video-format': 'hevc',
        width: '3840',
        height: '1606',
        'container-fps': '23.976023',
        'video-params/gamma': 'pq',
        'hwdec-current': 'd3d11va',
        'audio-codec-name': 'eac3',
        'audio-params/hr-channels': '5.1(side)',
        'audio-params/samplerate': '48000',
        'file-format': 'matroska,webm',
        'video-bitrate': '15400000',
        'demuxer-cache-duration': '41.6',
      },
      { addon: 'Open Films', file: 'film.mkv' },
    );
    expect(Object.fromEntries(rows)).toEqual({
      Source: 'Open Films',
      File: 'film.mkv',
      Video: 'HEVC · 3840×1606 · 23.976 fps',
      'Dynamic range': 'HDR10 (PQ)',
      Decoding: 'Hardware (d3d11va)',
      Audio: 'EAC3 · 5.1(side) · 48 kHz',
      Container: 'matroska,webm',
      Bitrate: '15.4 Mb/s video',
      'Buffered ahead': '42 s',
    });
  });

  it('leaves out what mpv does not know yet', () => {
    expect(formatInfo({ 'hwdec-current': 'no' }, { addon: 'A' })).toEqual([
      ['Source', 'A'],
      ['Decoding', 'Software'],
    ]);
  });
});

describe('episodeLine', () => {
  it('names the episode when it has a name, and leaves no dangling separator when it has none', () => {
    expect(episodeLine(1, 2, 'Pilot')).toBe('S1 · E2 · Pilot');
    expect(episodeLine(1, 2, '')).toBe('S1 · E2');
    expect(episodeLine(1, 2, '  ')).toBe('S1 · E2');
  });
});
