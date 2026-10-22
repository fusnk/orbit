import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, parseSourceRules, rankSources, rankingSignals, type SourceTraits } from './ranking-fallback';
import { streamLabels, otherFilmYear } from './stream-traits';

const prefs = { preferredQuality: '2160p' as const, language: 'en' };

describe('ranking boundaries', () => {
  it('applies the unrounded episode cap while showing a rounded explanation', () => {
    const options = { ...prefs, episode: true, rules: { ...DEFAULT_RULES, maxSizeGB: 8 } };
    expect(rankingSignals({ sizeGB: 8 / 3 }, options).some((s) => s.limit)).toBe(false);
    expect(rankingSignals({ sizeGB: 2.69 }, options)).toContainEqual({ id: 'over-size', points: -40, vars: { size: 2.7 }, limit: true });
  });

  it('keeps ranking inputs unchanged and retains opaque source metadata', () => {
    const sources = Object.freeze([
      Object.freeze({ id: 'low', provider: 'first', traits: Object.freeze({ resolution: '720p' as const }) }),
      Object.freeze({ id: 'high', provider: 'second', traits: Object.freeze({ resolution: '2160p' as const }) }),
    ]);
    expect(rankSources(sources, prefs).map(({ id, provider }) => [id, provider])).toEqual([['high', 'second'], ['low', 'first']]);
    expect(sources.map((s) => s.id)).toEqual(['low', 'high']);
    expect(sources[0]).not.toHaveProperty('signals');
  });

  it('prioritizes permitted sources even when all their bonuses lose to a limited source', () => {
    const traits: SourceTraits = { resolution: '2160p', hdr: 'Dolby Vision', audio: 'Atmos', cached: true, local: true, languages: ['en'], words: 'preferred' };
    const ranked = rankSources([{ id: 'limited', traits }, { id: 'permitted', traits: { audio: 'Stereo' as const } }], { ...prefs, rules: { ...DEFAULT_RULES, maxQuality: '1080p', prefer: ['cached', 'hdr', 'audio'], preferWords: ['preferred'] } });
    expect(ranked[1]!.score).toBeGreaterThan(ranked[0]!.score);
    expect(ranked.map((s) => s.id)).toEqual(['permitted', 'limited']);
  });

  it.each([NaN, Infinity, -Infinity])('resets nonfinite saved size limits (%s) without discarding valid rules', (maxSizeGB) => {
    expect(parseSourceRules({ maxSizeGB, maxQuality: '720p', prefer: ['cached'] })).toMatchObject({ maxSizeGB: 0, maxQuality: '720p', prefer: ['cached'] });
  });
});

describe('release size and year parsing', () => {
  it.each([['1,5 GiB', 1.5], ['768MiB', 0.75], ['1536 MB', 1.5]] as const)('reads provider size %s in binary gigabytes', (description, sizeGB) => {
    expect(streamLabels({ description }).traits.sizeGB).toBe(sizeGB);
  });

  it('reads a zero-byte hint as an unknown size, so the shown size is used', () => {
    const labels = streamLabels({ videoSize: 0, description: '2 GB' });
    expect(labels.size).toBe(streamLabels({ description: '2 GB' }).size);
    expect(labels.traits.sizeGB).toBe(2);
    expect(labels.largestGB).toBe(2);
    expect(streamLabels({ videoSize: 0 })).toMatchObject({ size: undefined, largestGB: undefined, traits: { sizeGB: undefined } });
  });

  it('deduplicates year hints and ignores years glued inside names', () => {
    expect(streamLabels({ filename: 'Movie.2020.2020.2019.mkv', name: 'a2021b' }).years).toEqual([2020, 2019]);
    expect(otherFilmYear([1990, 2021], 2020)).toBeUndefined();
    expect(otherFilmYear([], 2020)).toBeUndefined();
  });

  it('does not leak regex state between consecutive source parses', () => {
    for (let i = 0; i < 3; i++) expect(streamLabels({ name: 'Movie 2020 HDR10+ 4K' })).toMatchObject({ years: [2020], traits: { resolution: '2160p', hdr: 'HDR10+' } });
  });
});
