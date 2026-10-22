import { describe, expect, it } from 'vitest';
import { choiceFor, choiceForAudio, forgetChoice, matchAudio, matchSubtitle, MAX_REMEMBERED, parseTrackMemory, playingAudio, rememberChoice, remembersTracks, subtitleChoice, type Remembered } from './track-memory';
import type { TrackInfo } from './tracks';

describe('remembersTracks', () => {
  it('is for movies and episodes, not live channels, catch-up, trailers or pasted links', () => {
    expect(remembersTracks({})).toBe(true);
    for (const extra of [{ live: true }, { replay: true }, { trailer: true }, { link: true }]) expect(remembersTracks(extra)).toBe(false);
  });
});

const track = (over: Partial<TrackInfo>): TrackInfo => ({
  id: 1,
  kind: 'sub',
  title: null,
  lang: null,
  codec: null,
  channels: null,
  selected: false,
  secondary: false,
  external: false,
  default: false,
  forced: false,
  ...over,
});

describe('subtitleChoice', () => {
  it('keeps the language and whether the subtitles are forced or SDH', () => {
    expect(subtitleChoice('eng')).toBe('en');
    expect(subtitleChoice('eng', true, 'SDH')).toBe('en:forced');
    expect(subtitleChoice('fre', false, 'French (SDH)')).toBe('fr:sdh');
    expect(subtitleChoice('en', false, 'English CC')).toBe('en:sdh');
    expect(subtitleChoice('en', false, 'Chinese')).toBe('en');
    expect(subtitleChoice(null)).toBe('');
  });

  it('tells SDH apart as the subtitle list does', () => {
    // An addon subtitle marked SDH: once added, mpv knows it as "Addon · English 2".
    expect(subtitleChoice('en', false, 'OpenSubtitles v3 · English 2', true)).toBe('en:sdh');
    expect(subtitleChoice('en', false, 'Movie.2019.English_SDH')).toBe('en:sdh');
    expect(subtitleChoice('en', false, 'English (Closed Captions)')).toBe('en:sdh');
    // "HI" is Hindi's code, not hearing-impaired, for Hindi subtitles.
    expect(subtitleChoice('hin', false, 'Hindi HI')).toBe('hi');
  });

  it('finds an embedded track flagged hearing-impaired for an SDH choice', () => {
    const subs = [track({ id: 1, lang: 'eng' }), track({ id: 2, lang: 'eng', hearingImpaired: true })];
    expect(matchSubtitle(subs, 'en:sdh')?.id).toBe(2);
  });
});

describe('matchSubtitle', () => {
  const tracks = [
    track({ id: 1, lang: 'eng', forced: true }),
    track({ id: 2, lang: 'eng', title: 'English SDH' }),
    track({ id: 3, lang: 'eng' }),
    track({ id: 4, lang: 'spa', forced: true }),
    track({ id: 5, kind: 'audio', lang: 'eng' }),
  ];

  it('finds the same language and kind, whatever the track number', () => {
    expect(matchSubtitle(tracks, 'en')?.id).toBe(3);
    expect(matchSubtitle(tracks, 'en:sdh')?.id).toBe(2);
    expect(matchSubtitle(tracks, 'en:forced')?.id).toBe(1);
  });

  it('swaps plain and SDH, but never forced for full subtitles', () => {
    expect(matchSubtitle([tracks[0]!, tracks[1]!], 'en')?.id).toBe(2);
    expect(matchSubtitle([tracks[0]!, tracks[2]!], 'en:sdh')?.id).toBe(3);
    expect(matchSubtitle(tracks, 'es')).toBeUndefined();
    expect(matchSubtitle([tracks[2]!], 'en:forced')).toBeUndefined();
    expect(matchSubtitle(tracks, 'de')).toBeUndefined();
  });
});

describe('choiceForAudio', () => {
  it('keeps a forced choice only over audio in its language (or unknown)', () => {
    expect(choiceForAudio('en:forced', 'en')).toBe('en:forced');
    expect(choiceForAudio('en:forced', 'und')).toBe('en:forced');
    expect(choiceForAudio('en:forced', 'ja')).toBe('en');
    expect(choiceForAudio('en:sdh', 'ja')).toBe('en:sdh');
    expect(choiceForAudio('off', 'ja')).toBe('off');
  });
});

describe('matchAudio', () => {
  it('prefers a track without avoided words', () => {
    const tracks = [track({ id: 1, kind: 'audio', lang: 'eng', title: 'Commentary' }), track({ id: 2, kind: 'audio', lang: 'eng' }), track({ id: 3, kind: 'audio', lang: 'jpn' })];
    expect(matchAudio(tracks, 'en', ['commentary'])?.id).toBe(2);
    expect(matchAudio(tracks, 'ja', ['commentary'])?.id).toBe(3);
    expect(matchAudio([tracks[0]!], 'en', ['commentary'])?.id).toBe(1);
    expect(matchAudio(tracks, 'fr', [])).toBeUndefined();
  });
});

describe('playingAudio', () => {
  const english = track({ id: 1, kind: 'audio', lang: 'eng', selected: true });
  const japanese = track({ id: 2, kind: 'audio', lang: 'jpn' });

  it('is the remembered language when the file has it, else the one playing', () => {
    expect(playingAudio([english, japanese], 'ja', [])).toBe('ja');
    expect(playingAudio([english, japanese], undefined, [])).toBe('en');
    // An English-only release of a show watched in Japanese: the English plays.
    expect(playingAudio([english], 'ja', [])).toBe('en');
    expect(playingAudio([], 'ja', [])).toBe('und');
  });
});

describe('remembering choices', () => {
  it('keeps audio and subtitles per title, most recent last', () => {
    let entries = rememberChoice([], 'tt1', 'audio', 'ja');
    entries = rememberChoice(entries, 'tt2', 'sub', 'off');
    entries = rememberChoice(entries, 'tt1', 'sub', 'en:sdh');
    expect(entries).toEqual([
      ['tt2', '', 'off'],
      ['tt1', 'ja', 'en:sdh'],
    ]);
    expect(choiceFor(entries, 'tt1')).toEqual({ audio: 'ja', sub: 'en:sdh' });
    expect(choiceFor(entries, 'tt2')).toEqual({ sub: 'off' });
    expect(choiceFor(entries, 'tt3')).toEqual({});
    expect(forgetChoice(entries, 'tt1')).toEqual([['tt2', '', 'off']]);
  });

  it('drops the least recently used past the cap', () => {
    let entries: Remembered[] = [];
    for (let i = 0; i <= MAX_REMEMBERED; i++) entries = rememberChoice(entries, `tt${i}`, 'audio', 'en');
    expect(entries).toHaveLength(MAX_REMEMBERED);
    expect(choiceFor(entries, 'tt0')).toEqual({});
    // Using a title again moves it to the end.
    entries = rememberChoice(entries, 'tt1', 'sub', 'off');
    entries = rememberChoice(entries, 'new', 'audio', 'en');
    expect(choiceFor(entries, 'tt1')).toEqual({ audio: 'en', sub: 'off' });
    expect(choiceFor(entries, 'tt2')).toEqual({});
  });

  it('ignores choices that could not be read back', () => {
    expect(rememberChoice([], 'tt1', 'audio', 'e n')).toEqual([]);
    expect(rememberChoice([], 'tt1', 'sub', 'en:weird')).toEqual([]);
    expect(rememberChoice([], 'x'.repeat(101), 'audio', 'en')).toEqual([]);
  });
});

describe('parseTrackMemory', () => {
  it('falls back to nothing on junk', () => {
    for (const junk of [null, undefined, 0, 'junk', true, {}, { a: 1 }, JSON.parse('{"__proto__": {"x": 1}}')]) expect(parseTrackMemory(junk)).toEqual([]);
  });

  it('keeps good entries and drops bad ones', () => {
    const saved = [['tt1', 'en', 'off'], ['tt2', '<b>', ''], ['tt3', '', 'en:forced'], ['', 'en', ''], ['tt4', '', ''], ['tt5', 'en'], 7, ['tt1', 'ja', '']];
    // A duplicated title keeps its later entry.
    expect(parseTrackMemory(saved)).toEqual([
      ['tt3', '', 'en:forced'],
      ['tt1', 'ja', ''],
    ]);
  });

  it('keeps at most the cap, newest first to stay', () => {
    const saved = Array.from({ length: MAX_REMEMBERED + 20 }, (_, i) => [`tt${i}`, 'en', '']);
    const parsed = parseTrackMemory(saved);
    expect(parsed).toHaveLength(MAX_REMEMBERED);
    expect(parsed[0]![0]).toBe('tt20');
    expect(parsed.at(-1)![0]).toBe(`tt${MAX_REMEMBERED + 19}`);
  });
});
