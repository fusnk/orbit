import { describe, expect, it } from 'vitest';
import { parseRelease } from './subtitle-match';
import { subtitleChoice } from './track-memory';
import { audioLabel, autoSubtitle, bestOffers, forcedApplies, forcedFix, groupSubtitles, isAvoided, isSdh, matchLabel, parseAvoidWords, replacementTrack, subtitleToShow, subtitleTrackOption, titleOffers, UPLOADED_GROUP, type TrackInfo } from './tracks';

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

describe('audioLabel', () => {
  it('names the language and describes the format', () => {
    expect(audioLabel(track({ kind: 'audio', lang: 'eng', codec: 'eac3', channels: 6 }))).toEqual({ label: 'English', detail: 'E-AC-3 · 5.1' });
    expect(audioLabel(track({ kind: 'audio', title: 'Commentary', codec: 'aac', channels: 2 })).detail).toBe('Commentary · AAC · Stereo');
  });
});

describe('titleOffers', () => {
  it('numbers offers per addon and language', () => {
    const titled = titleOffers([
      { url: 'https://a/1', lang: 'eng', addon: 'OS' },
      { url: 'https://a/2', lang: 'en', addon: 'OS' },
      { url: 'https://a/3', lang: 'spa', addon: 'OS' },
    ]);
    expect(titled.map((t) => t.title)).toEqual(['OS · English 1', 'OS · English 2', 'OS · Spanish 1']);
  });
});

describe('groupSubtitles', () => {
  const offers = titleOffers([
    { url: 'https://a/1', lang: 'eng', addon: 'OS' },
    { url: 'https://a/2', lang: 'fre', addon: 'OS' },
  ]);

  it('groups by language, preferred first, unknown last', () => {
    const groups = groupSubtitles([track({ id: 1, lang: 'ger' }), track({ id: 2 }), track({ id: 3, lang: 'en', selected: true })], offers, ['en']);
    expect(groups.map((g) => g.name)).toEqual(['English', 'French', 'German', 'Unknown']);
    expect(groups[0]?.options.map((o) => o.kind)).toEqual(['track', 'addon']);
    expect(groups[0]?.selected).toBe(true);
  });

  it('shows an added addon subtitle once, as its track', () => {
    const groups = groupSubtitles([track({ id: 5, external: true, title: offers[0]!.title, selected: true })], offers, ['en']);
    const english = groups.find((g) => g.key === 'en')!;
    expect(english.options).toHaveLength(1);
    expect(english.options[0]).toMatchObject({ kind: 'track', label: 'OS' });
  });

  it('puts files the user added first', () => {
    const groups = groupSubtitles([track({ id: 6, external: true, title: 'my.srt' })], offers, ['en']);
    expect(groups[0]?.key).toBe(UPLOADED_GROUP);
  });
});

describe('autoSubtitle', () => {
  const offers = titleOffers([
    { url: 'https://a/1', lang: 'spa', addon: 'OS' },
    { url: 'https://a/2', lang: 'eng', addon: 'OS' },
  ]);

  it('loads an addon subtitle only when the file has none in the language', () => {
    expect(autoSubtitle([], offers, 'en')?.url).toBe('https://a/2');
    expect(autoSubtitle([track({ lang: 'eng' })], offers, 'en')).toBeUndefined();
    expect(autoSubtitle([track({ lang: 'fre', selected: true })], offers, 'en')).toBeUndefined();
    expect(autoSubtitle([track({ kind: 'audio', lang: 'eng' })], offers, 'en')?.url).toBe('https://a/2');
  });

  it('does nothing without a preference or a match', () => {
    expect(autoSubtitle([], offers, '')).toBeUndefined();
    expect(autoSubtitle([], offers, 'ja')).toBeUndefined();
  });
});

describe('matching subtitles to the release playing', () => {
  const offers = titleOffers([
    { url: 'https://subs.example/file/1', lang: 'eng', addon: 'OS', release: { name: 'Movie.2019.1080p.BluRay.x264-OTHER.srt' } },
    { url: 'https://subs.example/file/2', lang: 'eng', addon: 'OS', release: { name: 'Movie.2019.1080p.WEB-DL.x264-GRP.srt' } },
    { url: 'https://subs.example/Movie%20Name%202019%20WEB-DL-GRP.srt', lang: 'spa', addon: 'Other' },
    { url: 'https://subs.example/file/4', lang: 'spa', addon: 'OS' },
  ]);
  const video = parseRelease('https://debrid.example/d/Movie%202019%201080p%20WEB-DL%20x264-GRP.mkv');

  it('picks the offer made for the release, among those in the language', () => {
    expect(autoSubtitle([], offers, 'en', 'en', video)?.url).toBe('https://subs.example/file/2');
    expect(autoSubtitle([], offers, 'en')?.url).toBe('https://subs.example/file/1');
    // Names in web addresses count too, once decoded.
    expect(autoSubtitle([], offers, 'es', 'en', video)?.url).toBe('https://subs.example/Movie%20Name%202019%20WEB-DL-GRP.srt');
  });

  it('marks the best match per language in the list', () => {
    const best = bestOffers(offers, video);
    expect([...best]).toEqual(['https://subs.example/file/2', 'https://subs.example/Movie%20Name%202019%20WEB-DL-GRP.srt']);
    expect(bestOffers(offers, undefined).size).toBe(0);
    const english = groupSubtitles([], offers, ['en'], best).find((g) => g.key === 'en')!;
    expect(english.options.map((o) => o.detail)).toEqual(['#1', '#2 · Best match']);
  });
});

describe('forced subtitles', () => {
  const forcedEn = track({ id: 1, lang: 'eng', forced: true, selected: true });
  const fullEn = track({ id: 2, lang: 'eng' });
  const offers = titleOffers([{ url: 'https://a/en', lang: 'eng', addon: 'OS' }]);

  it('apply only over audio in their language, or when a language is unknown', () => {
    expect(forcedApplies(forcedEn, 'en')).toBe(true);
    expect(forcedApplies(forcedEn, 'und')).toBe(true);
    expect(forcedApplies(track({ forced: true }), 'ja')).toBe(true);
    expect(forcedApplies(forcedEn, 'ja')).toBe(false);
    expect(forcedApplies(fullEn, 'ja')).toBe(true);
  });

  it('a forced track for other audio does not stop full subtitles loading', () => {
    expect(autoSubtitle([forcedEn], offers, 'en', 'ja')?.url).toBe('https://a/en');
  });

  it('a forced track in the audio’s own language is not the full subtitles wanted', () => {
    // English film, English subtitles wanted ("forced only" off: the player doesn't ask then),
    // and the file has only the forced English track for its foreign lines.
    expect(autoSubtitle([forcedEn], offers, 'en', 'en')?.url).toBe('https://a/en');
    expect(autoSubtitle([{ ...forcedEn, selected: false }], offers, 'en', 'en')?.url).toBe('https://a/en');
    // With the audio's language unknown, it may be all that's needed.
    expect(autoSubtitle([forcedEn], offers, 'en', 'und')).toBeUndefined();
    expect(autoSubtitle([forcedEn, fullEn], offers, 'en', 'en')).toBeUndefined();
  });

  it('swaps a forced track meant for other audio for the full one, or none', () => {
    expect(forcedFix([forcedEn, fullEn], 'ja')).toEqual({ id: 2 });
    expect(forcedFix([forcedEn], 'ja')).toEqual({ id: null });
    expect(forcedFix([forcedEn], 'en')).toBeUndefined();
    expect(forcedFix([{ ...fullEn, selected: true }], 'ja')).toBeUndefined();
  });
});

describe('skipping tracks by name', () => {
  const track = (id: number, kind: 'audio' | 'sub', lang: string, title: string | null, selected = false): TrackInfo => ({
    id, kind, lang, title, selected, codec: null, channels: null, secondary: false, external: false, default: false, forced: false,
  });
  const words = parseAvoidWords(undefined);

  it('reads the words, with defaults', () => {
    expect(words).toEqual(['commentary', 'audio description', 'descriptive']);
    expect(parseAvoidWords(' Signs ,, SONGS ')).toEqual(['signs', 'songs']);
    expect(parseAvoidWords('')).toEqual([]);
  });

  it('matches whole words in any case', () => {
    expect(isAvoided(track(1, 'audio', 'en', 'Director’s Commentary'), words)).toBe(true);
    expect(isAvoided(track(1, 'audio', 'en', 'English (Audio Description)'), words)).toBe(true);
    expect(isAvoided(track(1, 'audio', 'en', 'Commentaryless'), words)).toBe(false);
    expect(isAvoided(track(1, 'audio', 'en', null), words)).toBe(false);
  });

  it('swaps an avoided pick for the same language first', () => {
    const tracks = [track(1, 'audio', 'en', 'Commentary', true), track(2, 'audio', 'fr', 'Français'), track(3, 'audio', 'en', '5.1 Surround')];
    expect(replacementTrack(tracks, 'audio', words)?.id).toBe(3);
    expect(replacementTrack([track(1, 'audio', 'en', 'Commentary', true), track(2, 'audio', 'fr', null)], 'audio', words)?.id).toBe(2);
    expect(replacementTrack([track(1, 'audio', 'en', 'Main', true), track(2, 'audio', 'en', 'Commentary')], 'audio', words)).toBeUndefined();
    expect(replacementTrack([track(1, 'audio', 'en', 'Commentary', true)], 'audio', words)).toBeUndefined();
  });
});

describe('subtitle details', () => {
  it('spots subtitles for the deaf and hard of hearing', () => {
    expect(isSdh('Movie.2019.WEB.eng.SDH.srt', 'en')).toBe(true);
    expect(isSdh('English (CC)', 'eng')).toBe(true);
    expect(isSdh('Movie.Hearing-Impaired.srt', 'en')).toBe(true);
    expect(isSdh('Movie.HI.srt', 'en')).toBe(true);
    expect(isSdh('English', 'eng', true)).toBe(true);
    expect(isSdh('Movie.Hindi.srt', 'en')).toBe(false);
    expect(isSdh('Shiny.Accent.srt', 'en')).toBe(false);
    expect(isSdh(null, 'en')).toBe(false);
  });

  it('doesn’t take Hindi’s code for hearing-impaired', () => {
    expect(isSdh('Movie.hi.srt', 'hin')).toBe(false);
    expect(isSdh('Movie.hi.sdh.srt', 'hin')).toBe(true);
  });

  it('names how well an offer fits, only when the score says something', () => {
    expect(matchLabel(10, true)).toBe('subs.best-match');
    expect(matchLabel(60, false)).toBe('pstream.subs.match-good');
    expect(matchLabel(30, false)).toBe('pstream.subs.match-fair');
    expect(matchLabel(5, false)).toBeNull();
    expect(matchLabel(-70, false)).toBe('pstream.subs.match-poor');
    expect(matchLabel(undefined, false)).toBeNull();
  });
});

describe('subtitleToShow', () => {
  const words = parseAvoidWords(undefined);
  const forced = track({ id: 2, lang: 'eng', title: 'Forced', forced: true });
  const commentary = track({ id: 3, lang: 'eng', title: 'Commentary' });
  const full = track({ id: 4, lang: 'eng', title: 'English' });
  const offers = titleOffers([{ url: 'https://a/1', lang: 'eng', addon: 'OS' }]);

  it('turns on the full subtitles, not a forced track (signs only) listed first, nor commentary', () => {
    expect(subtitleToShow([forced, commentary, full], [], ['en'], words)).toEqual({ track: full });
  });

  it('loads an addon’s full subtitles before showing a forced track alone', () => {
    expect(subtitleToShow([forced], offers, ['en'], words)).toEqual({ offer: offers[0] });
    expect(subtitleToShow([forced], [], ['en'], words)).toEqual({ track: forced });
  });

  it('goes down the languages, then to the file’s full subtitles in any language', () => {
    const spanish = track({ id: 5, lang: 'spa' });
    expect(subtitleToShow([spanish, full], [], ['fr', 'en'], words)).toEqual({ track: full });
    const french = track({ id: 6, lang: 'fre', forced: true });
    expect(subtitleToShow([french, spanish], [], ['en'], words)).toEqual({ track: spanish });
    expect(subtitleToShow([], [], ['en'], words)).toBeUndefined();
  });
});

describe('subtitleTrackOption', () => {
  it('carries the SDH mark a pick by id is remembered with, as the Subtitles view does', () => {
    const flagged = track({ id: 2, lang: 'eng', title: 'English', hearingImpaired: true });
    const offers = titleOffers([{ url: 'https://a/1', lang: 'eng', addon: 'OS', sdh: true }]);
    const added = track({ id: 3, lang: 'eng', title: offers[0]!.title, external: true });
    const remembered = (id: number) => {
      const option = subtitleTrackOption([flagged, added], offers, id);
      return option?.kind === 'track' ? subtitleChoice(option.track.lang, option.track.forced, option.track.title, option.sdh) : undefined;
    };
    expect(remembered(2)).toBe('en:sdh');
    expect(remembered(3)).toBe('en:sdh');
    expect(subtitleTrackOption([flagged], [], 9)).toBeUndefined();
  });
});
