import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, parseDeviceSupport, parseKeywords, parseSourceRules, rankSources, rankingSignals, scoreOf, type RankingPrefs, type SourceRules, type SourceTraits } from './ranking-fallback';

const prefs: RankingPrefs = { preferredQuality: '2160p', language: 'en' };
const withRules = (rules: Partial<SourceRules>, extra: Partial<RankingPrefs> = {}): RankingPrefs => ({ ...prefs, ...extra, rules: { ...DEFAULT_RULES, ...rules } });
const ids = (traits: SourceTraits, p: RankingPrefs = prefs) => rankingSignals(traits, p).map((s) => s.id);
const order = (sources: { id: string; traits: SourceTraits }[], p: RankingPrefs) => rankSources(sources, p).map((s) => s.id);

describe('rankingSignals', () => {
  it('matches the handoff spec example (score 74)', () => {
    const signals = rankingSignals({ resolution: '2160p', hdr: 'Dolby Vision', audio: 'Atmos', languages: ['en'], sizeGB: 18.4 }, prefs);
    expect(signals).toEqual([
      { id: 'resolution', points: 40, vars: { resolution: '2160p' } },
      { id: 'dolby-vision', points: 18 },
      { id: 'atmos', points: 12 },
      { id: 'language', points: 8, vars: { language: 'EN' } },
      { id: 'large', points: -4 },
    ]);
    expect(scoreOf(signals)).toBe(74);
  });

  it.each([
    ['2160p', 40],
    ['1080p', 28],
    ['720p', 14],
  ] as const)('scores %s resolution as +%i', (resolution, points) => {
    expect(rankingSignals({ resolution }, prefs)).toEqual([{ id: 'resolution', points, vars: { resolution } }]);
  });

  it('penalises sources above the preferred quality, more for each step above', () => {
    const signals = rankingSignals({ resolution: '2160p' }, { ...prefs, preferredQuality: '1080p' });
    expect(signals).toContainEqual({ id: 'above-preferred', points: -30, vars: { quality: '1080p' } });
    expect(rankingSignals({ resolution: '1080p' }, { ...prefs, preferredQuality: '1080p' })).toHaveLength(1);
    expect(rankingSignals({ resolution: '2160p' }, { ...prefs, preferredQuality: '720p' })).toContainEqual({ id: 'above-preferred', points: -60, vars: { quality: '720p' } });
    expect(rankingSignals({ resolution: '2160p' }, { ...prefs, preferredQuality: '480p' })).toContainEqual({ id: 'above-preferred', points: -90, vars: { quality: '480p' } });
  });

  it.each([
    ['480p', ['480p', '720p', '1080p', '2160p']],
    ['720p', ['720p', '1080p', '2160p']],
    ['1080p', ['1080p', '2160p']],
  ] as const)('with %s preferred, ranks it first and the nearer steps above it before the higher ones', (preferredQuality, above) => {
    const sources = (['2160p', '1080p', '720p', '480p'] as const).map((resolution) => ({ id: resolution, traits: { resolution } }));
    const ranked = order(sources, { ...prefs, preferredQuality });
    expect(ranked[0]).toBe(preferredQuality);
    expect(ranked.filter((id) => (above as readonly string[]).includes(id))).toEqual(above);
  });

  it('scores HDR, audio, local files and file size per the table', () => {
    const pts = (traits: SourceTraits) => rankingSignals(traits, prefs).map((s) => s.points);
    expect(pts({ hdr: 'HDR10' })).toEqual([10]);
    expect(pts({ audio: '5.1' })).toEqual([6]);
    expect(pts({ audio: '7.1' })).toEqual([6]);
    expect(pts({ audio: 'Stereo' })).toEqual([-2]);
    expect(pts({ local: true })).toEqual([10]);
    expect(pts({ sizeGB: 1.1 })).toEqual([-6]);
    expect(pts({ sizeGB: 4 })).toEqual([]);
  });

  it("judges an episode's size against an episode's runtime, not a movie's", () => {
    const episode = { ...prefs, episode: true };
    // A 1 GB episode is a normal 1080p episode, not a low-bitrate one.
    expect(ids({ sizeGB: 1 }, episode)).toEqual([]);
    expect(ids({ sizeGB: 0.3 }, episode)).toEqual(['low-bitrate']);
    expect(ids({ sizeGB: 8 }, episode)).toEqual(['large']);
    expect(ids({ sizeGB: 4 }, episode)).toEqual([]);
  });

  it('leaves out signals whose metadata is missing', () => {
    expect(rankingSignals({}, prefs)).toEqual([]);
    expect(rankingSignals({ languages: ['es'] }, prefs)).toEqual([]);
  });

  it('with the default rules, scores everything as before rules existed, except CAM copies', () => {
    const traits: SourceTraits = { resolution: '1080p', hdr: 'HDR10', codec: 'HEVC', audio: 'Atmos', lossless: true, multiAudio: true, cached: true, remux: true, threeD: true, sizeGB: 40, words: 'movie 2024 nova' };
    expect(scoreOf(rankingSignals(traits, prefs))).toBe(28 + 10 + 12 - 4);
    expect(rankingSignals(traits, withRules({}))).toEqual(rankingSignals(traits, prefs));
    expect(rankingSignals({ resolution: '1080p', cam: true }, prefs)).toContainEqual({ id: 'avoided-cam', points: -60 });
    expect(ids({ resolution: '1080p', cam: true }, withRules({ avoid: [] }))).toEqual(['resolution']);
  });
});

describe('size limit', () => {
  it('marks movies under the minimum, episodes under a third of it, and leaves unknown sizes alone', () => {
    const p = withRules({ minSizeGB: 1 });
    expect(rankingSignals({ sizeGB: 0.4 }, p)).toContainEqual({ id: 'under-size', points: -40, vars: { size: 1 }, limit: true });
    expect(ids({ sizeGB: 1 }, p)).not.toContain('under-size');
    expect(ids({ resolution: '1080p' }, p)).not.toContain('under-size');
    const episode = withRules({ minSizeGB: 1 }, { episode: true });
    expect(rankingSignals({ sizeGB: 0.3 }, episode)).toContainEqual({ id: 'under-size', points: -40, vars: { size: 0.3 }, limit: true });
    expect(ids({ sizeGB: 0.4 }, episode)).not.toContain('under-size');
  });

  it('ranks tiny files after all others, but keeps them', () => {
    const p = withRules({ minSizeGB: 2 });
    const sources = [
      { id: 'fake-4k', traits: { resolution: '2160p', hdr: 'HDR10', sizeGB: 0.3 } as SourceTraits },
      { id: 'real-1080', traits: { resolution: '1080p', sizeGB: 6 } as SourceTraits },
    ];
    expect(order(sources, p)).toEqual(['real-1080', 'fake-4k']);
  });

  it('marks movies over the limit, and leaves unknown sizes alone', () => {
    const p = withRules({ maxSizeGB: 8 });
    expect(rankingSignals({ sizeGB: 9 }, p)).toEqual([{ id: 'over-size', points: -40, vars: { size: 8 }, limit: true }]);
    expect(rankingSignals({ sizeGB: 8 }, p)).toEqual([]);
    expect(rankingSignals({ resolution: '1080p' }, p)).toHaveLength(1);
  });

  it('gives episodes a third of the movie limit', () => {
    const p = withRules({ maxSizeGB: 8 }, { episode: true });
    expect(rankingSignals({ sizeGB: 3 }, p)).toContainEqual({ id: 'over-size', points: -40, vars: { size: 2.7 }, limit: true });
    expect(ids({ sizeGB: 2.5 }, p)).toEqual([]);
  });

  it('ranks sources over the limit after all others, whatever their score', () => {
    const p = withRules({ maxSizeGB: 4 });
    const sources = [
      { id: 'big-4k', traits: { resolution: '2160p', hdr: 'Dolby Vision', audio: 'Atmos', sizeGB: 20 } as SourceTraits },
      { id: 'small-720', traits: { resolution: '720p', sizeGB: 2 } as SourceTraits },
      { id: 'unknown', traits: {} },
    ];
    expect(order(sources, p)).toEqual(['small-720', 'unknown', 'big-4k']);
  });
});

describe('quality limit', () => {
  it('ranks sources above "never above" last but keeps them', () => {
    const p = withRules({ maxQuality: '1080p' });
    expect(rankingSignals({ resolution: '2160p' }, p)).toContainEqual({ id: 'above-limit', points: -40, vars: { quality: '1080p' }, limit: true });
    expect(ids({ resolution: '1080p' }, p)).toEqual(['resolution']);
    expect(order([{ id: '4k', traits: { resolution: '2160p', hdr: 'HDR10' } }, { id: '480', traits: { resolution: '480p' } }, { id: '?', traits: {} }], p)).toEqual(['480', '?', '4k']);
  });

  it('still has a best source when every one breaks a limit', () => {
    const p = withRules({ maxQuality: '720p', maxSizeGB: 2 });
    const ranked = rankSources(
      [
        { id: 'a', traits: { resolution: '1080p', sizeGB: 3 } },
        { id: 'b', traits: { resolution: '2160p', sizeGB: 50 } },
        { id: 'c', traits: { resolution: '1080p' } },
      ],
      p,
    );
    expect(ranked).toHaveLength(3);
    // All break a limit, so they rank among themselves by score: c (28 − 40), b (40 − 40 − 4 − 40), a (28 − 40 − 40).
    expect(ranked.map((s) => s.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('avoid and prefer', () => {
  it('replaces the HDR bonus with a penalty when HDR is avoided', () => {
    expect(rankingSignals({ hdr: 'HDR10' }, withRules({ avoid: ['hdr'] }))).toEqual([{ id: 'avoided', points: -30, vars: { what: 'HDR10' } }]);
    expect(rankingSignals({ hdr: 'Dolby Vision' }, withRules({ avoid: ['hdr'] }))).toEqual([{ id: 'avoided', points: -30, vars: { what: 'Dolby Vision' } }]);
  });

  it('avoids only Dolby Vision when asked, keeping HDR10', () => {
    const p = withRules({ avoid: ['dv'], prefer: ['hdr'] });
    expect(rankingSignals({ hdr: 'Dolby Vision' }, p)).toEqual([{ id: 'avoided', points: -30, vars: { what: 'Dolby Vision' } }]);
    expect(ids({ hdr: 'HDR10+' }, p)).toEqual(['hdr', 'prefer-hdr']);
  });

  it('avoids codecs, 3D and remuxes', () => {
    const p = withRules({ avoid: ['hevc', 'av1', '3d', 'remux'] });
    const pts = (traits: SourceTraits) => scoreOf(rankingSignals(traits, p));
    expect(pts({ codec: 'HEVC' })).toBe(-30);
    expect(pts({ codec: 'AV1' })).toBe(-30);
    expect(pts({ codec: 'H.264' })).toBe(0);
    expect(pts({ threeD: true })).toBe(-30);
    expect(pts({ remux: true })).toBe(-30);
  });

  it('prefers cached, HDR, Atmos or lossless, and multi-audio', () => {
    const p = withRules({ prefer: ['cached', 'hdr', 'audio', 'multi-audio'] });
    expect(rankingSignals({ cached: true }, p)).toEqual([{ id: 'cached', points: 15 }]);
    expect(scoreOf(rankingSignals({ hdr: 'HLG' }, p))).toBe(20);
    expect(scoreOf(rankingSignals({ audio: 'Atmos' }, p))).toBe(22);
    expect(scoreOf(rankingSignals({ audio: '5.1', lossless: true }, p))).toBe(16);
    expect(rankingSignals({ multiAudio: true }, p)).toEqual([{ id: 'multi-audio', points: 10 }]);
    // Unknowns stay neutral.
    expect(rankingSignals({}, p)).toEqual([]);
  });

  it('lets a cached 1080p beat an uncached one', () => {
    const p = withRules({ prefer: ['cached'] });
    expect(order([{ id: 'plain', traits: { resolution: '1080p' } }, { id: 'cached', traits: { resolution: '1080p', cached: true } }], p)).toEqual(['cached', 'plain']);
  });
});

describe('keywords', () => {
  it('scores whole words, ignoring case and separators', () => {
    const p = withRules({ preferWords: ['nova', 'web dl'], avoidWords: ['blurx'] });
    expect(rankingSignals({ words: 'movie 2024 1080p web dl ddp5 1 nova' }, p)).toEqual([
      { id: 'keyword', points: 10, vars: { word: 'nova' } },
      { id: 'keyword', points: 10, vars: { word: 'web dl' } },
    ]);
    expect(rankingSignals({ words: 'movie 1080p blurx' }, p)).toEqual([{ id: 'avoided-keyword', points: -30, vars: { word: 'blurx' } }]);
    // Not inside other words.
    expect(rankingSignals({ words: 'novacapacitor blurxish' }, p)).toEqual([]);
    expect(rankingSignals({}, p)).toEqual([]);
  });
});

describe('rankSources', () => {
  it('sorts by score, keeping addon order for ties', () => {
    const ranked = rankSources(
      [
        { id: 'a', traits: { resolution: '720p' } },
        { id: 'b', traits: { resolution: '2160p' } },
        { id: 'c', traits: { resolution: '720p' } },
      ],
      prefs,
    );
    expect(ranked.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(ranked[0]?.score).toBe(40);
  });

  it('keeps addon order among sources that tie under a limit', () => {
    const p = withRules({ maxSizeGB: 2 });
    expect(order([{ id: 'x', traits: { sizeGB: 5 } }, { id: 'y', traits: { sizeGB: 5 } }, { id: 'z', traits: {} }], p)).toEqual(['z', 'x', 'y']);
  });

  it('puts a CAM copy below an unknown source by default', () => {
    expect(order([{ id: 'cam', traits: { resolution: '1080p', cam: true } }, { id: 'unknown', traits: {} }], prefs)).toEqual(['unknown', 'cam']);
  });
});

describe('parseKeywords', () => {
  it('splits on commas, lowercases, drops blanks and repeats, and caps the list', () => {
    expect(parseKeywords(' NOVA, ,nova , Web-DL,  ')).toEqual(['nova', 'web dl']);
    expect(parseKeywords(Array.from({ length: 30 }, (_, i) => `w${i}`).join(','))).toHaveLength(10);
    expect(parseKeywords('x'.repeat(100))[0]).toHaveLength(40);
    expect(parseKeywords('')).toEqual([]);
  });
});

describe('parseSourceRules', () => {
  it('defaults when nothing or junk is saved', () => {
    for (const junk of [undefined, null, 42, 'rules', [], [1, 2], true]) expect(parseSourceRules(junk)).toEqual(DEFAULT_RULES);
  });

  it('keeps valid fields and resets only the invalid ones', () => {
    const rules = parseSourceRules({ maxQuality: '8K', maxSizeGB: 8, avoid: ['hevc', 'nonsense', 3, 'hevc'], prefer: 'cached', preferWords: ['  Nova ', 7], avoidWords: null });
    expect(rules).toEqual({ maxQuality: null, maxSizeGB: 8, minSizeGB: 0, avoid: ['hevc'], prefer: [], preferWords: DEFAULT_RULES.preferWords, avoidWords: [] });
  });

  it('accepts a full valid save', () => {
    const saved: SourceRules = { maxQuality: '1080p', maxSizeGB: 15, minSizeGB: 1, avoid: ['cam', 'dv', 'remux'], prefer: ['cached', 'audio'], preferWords: ['nova'], avoidWords: ['blurx'] };
    expect(parseSourceRules(saved)).toEqual(saved);
  });

  it('rejects sizes that are not a choice', () => {
    expect(parseSourceRules({ maxSizeGB: 7 }).maxSizeGB).toBe(0);
    expect(parseSourceRules({ maxSizeGB: -1 }).maxSizeGB).toBe(0);
    expect(parseSourceRules({ maxSizeGB: '8' }).maxSizeGB).toBe(0);
    for (const minSizeGB of [0.7, -1, '1', 8, NaN]) expect(parseSourceRules({ minSizeGB }).minSizeGB).toBe(0);
    for (const minSizeGB of [0.5, 1, 2, 4]) expect(parseSourceRules({ minSizeGB }).minSizeGB).toBe(minSizeGB);
  });

  it('drops a minimum at or above the maximum', () => {
    expect(parseSourceRules({ minSizeGB: 2, maxSizeGB: 2 })).toMatchObject({ minSizeGB: 0, maxSizeGB: 2 });
    expect(parseSourceRules({ minSizeGB: 4, maxSizeGB: 2 })).toMatchObject({ minSizeGB: 0, maxSizeGB: 2 });
    expect(parseSourceRules({ minSizeGB: 1, maxSizeGB: 2 })).toMatchObject({ minSizeGB: 1, maxSizeGB: 2 });
    // No maximum: any minimum stands.
    expect(parseSourceRules({ minSizeGB: 4, maxSizeGB: 0 }).minSizeGB).toBe(4);
  });

  it('never keeps "prefer HDR" next to "avoid HDR"', () => {
    expect(parseSourceRules({ avoid: ['hdr'], prefer: ['hdr', 'cached'] })).toMatchObject({ avoid: ['hdr'], prefer: ['cached'] });
    expect(parseSourceRules({ avoid: ['dv'], prefer: ['hdr'] })).toMatchObject({ avoid: ['dv'], prefer: ['hdr'] });
  });

  it('caps and cleans saved keywords', () => {
    const rules = parseSourceRules({ preferWords: Array.from({ length: 50 }, (_, i) => `Word${i}`), avoidWords: ['A, B', 'a'] });
    expect(rules.preferWords).toHaveLength(10);
    expect(rules.preferWords[0]).toBe('word0');
    expect(rules.avoidWords).toEqual(['a', 'b']);
  });
});

describe('what the device can play (Android TV)', () => {
  const tv: RankingPrefs = { ...prefs, device: { codecs: ['H.264', 'HEVC'], hdr: ['HDR10'], maxResolution: '1080p' } };

  it('puts a codec the box can’t decode after every source it can', () => {
    expect(ids({ codec: 'AV1' }, tv)).toEqual(['unsupported']);
    expect(order([{ id: 'av1', traits: { resolution: '1080p', codec: 'AV1', audio: 'Atmos' } }, { id: 'h264', traits: { resolution: '720p', codec: 'H.264' } }], tv)).toEqual(['h264', 'av1']);
  });

  it('gives HDR the screen can’t show no bonus, and HDR10+ plays as HDR10', () => {
    expect(ids({ hdr: 'Dolby Vision' }, tv)).toEqual(['unsupported']);
    expect(ids({ hdr: 'HDR10+' }, tv)).toEqual(['hdr']);
    expect(ids({ hdr: 'HDR10' }, tv)).toEqual(['hdr']);
  });

  it('counts pixels the screen can’t show against a source', () => {
    expect(ids({ resolution: '2160p' }, tv)).toEqual(['resolution', 'above-screen']);
    expect(ids({ resolution: '1080p' }, tv)).toEqual(['resolution']);
  });

  it('changes nothing on a PC', () => {
    expect(ids({ codec: 'AV1', hdr: 'Dolby Vision', resolution: '2160p' })).toEqual(['resolution', 'dolby-vision']);
  });
});

describe('parseDeviceSupport', () => {
  it('keeps only names Orbit knows, and needs a resolution and codecs', () => {
    expect(parseDeviceSupport({ codecs: ['H.264', 'HEVC', 'VP9'], hdr: ['HDR10', 'Weird'], maxResolution: '2160p' })).toEqual({ codecs: ['HEVC', 'H.264'], hdr: ['HDR10'], maxResolution: '2160p' });
    expect(parseDeviceSupport({ codecs: ['H.264'], maxResolution: '8K' })).toBeUndefined();
    expect(parseDeviceSupport(null)).toBeUndefined();
  });
});
