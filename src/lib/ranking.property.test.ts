import fc from 'fast-check';
import { expect, it } from 'vitest';
import { breaksLimit, MAX_KEYWORDS, MAX_KEYWORD_LENGTH, parseKeywords, parseSourceRules, rankSources, type SourceTraits } from './ranking-fallback';
import { otherFilmYear, streamLabels } from './stream-traits';

const options = { seed: 20261007, numRuns: 300 };
const resolution = fc.constantFrom('2160p', '1080p', '720p', '480p');
const stream = fc.record({
  name: fc.string({ maxLength: 500 }), description: fc.string({ maxLength: 1000 }),
  filename: fc.string({ maxLength: 300 }), videoSize: fc.nat({ max: 1024 ** 4 }),
});
const traits: fc.Arbitrary<SourceTraits> = fc.record({
  resolution, hdr: fc.constantFrom('Dolby Vision', 'HDR10', 'HDR10+', 'HLG'),
  audio: fc.constantFrom('Atmos', '7.1', '5.1', 'Stereo'), codec: fc.constantFrom('HEVC', 'AV1', 'H.264'),
  sizeGB: fc.double({ min: 0, max: 1000, noNaN: true }), local: fc.boolean(), cached: fc.boolean(),
  cam: fc.boolean(), languages: fc.array(fc.constantFrom('en', 'es', 'fr'), { maxLength: 3 }),
});

it('ranking preserves every source and orders limits before score, without mutating input', () => {
  fc.assert(fc.property(fc.array(traits, { maxLength: 80 }), resolution, fc.jsonValue(), (values, quality, rawRules) => {
    const sources = values.map((value, index) => ({ index, traits: value }));
    const before = structuredClone(sources);
    const result = rankSources(sources, { preferredQuality: quality, language: 'en', rules: parseSourceRules(rawRules) });
    expect(result.map((item) => item.index).sort((a, b) => a - b)).toEqual(sources.map((item) => item.index));
    expect(sources).toEqual(before);
    for (let i = 1; i < result.length; i++) {
      const previous = result[i - 1]!;
      const current = result[i]!;
      expect(Number(breaksLimit(previous.signals))).toBeLessThanOrEqual(Number(breaksLimit(current.signals)));
      expect(Number.isFinite(current.score)).toBe(true);
      if (breaksLimit(previous.signals) === breaksLimit(current.signals)) {
        expect(previous.score).toBeGreaterThanOrEqual(current.score);
        if (previous.score === current.score) expect(previous.index).toBeLessThan(current.index);
      }
    }
  }), options);
});

it('keywords remain unique, normalized and capped after arbitrary input and reparsing', () => {
  fc.assert(fc.property(fc.string({ maxLength: 2000 }), (text) => {
    const result = parseKeywords(text);
    expect(new Set(result).size).toBe(result.length);
    expect(result.length).toBeLessThanOrEqual(MAX_KEYWORDS);
    expect(result.every((word) => word.length > 0 && word.length <= MAX_KEYWORD_LENGTH)).toBe(true);
    expect(parseKeywords(result.join(','))).toEqual(result);
  }), options);
});

it('stream labels survive arbitrary text with finite non-negative sizes and exclusive cache state', () => {
  fc.assert(fc.property(stream, (input) => {
    const result = streamLabels(input);
    expect(result).toEqual(streamLabels(input));
    expect(result.traits.cached && result.traits.uncached).not.toBe(true);
    // A 0-byte hint is an unknown size: with no size in the text there's none at all.
    if (input.videoSize > 0) {
      expect(result.largestGB).toBeGreaterThanOrEqual(input.videoSize / 1024 ** 3);
      expect(Number.isFinite(result.largestGB)).toBe(true);
    }
    expect(new Set(result.years).size).toBe(result.years?.length ?? 0);
    expect(result.years?.length ?? 0).toBeLessThanOrEqual(4);
  }), options);
});

it('generated release labels preserve resolution and hinted size bounds', () => {
  fc.assert(fc.property(resolution, fc.integer({ min: 1, max: 100 }), fc.nat({ max: 1024 ** 4 }), (quality, gb, bytes) => {
    const result = streamLabels({ filename: `Film.${quality}.WEB-DL.${gb}GB.mkv`, videoSize: bytes });
    expect(result.traits.resolution).toBe(quality);
    expect(result.largestGB).toBeGreaterThanOrEqual(gb);
    expect(result.largestGB).toBeGreaterThanOrEqual(bytes / 1024 ** 3);
  }), options);
});

it('a year within one year always prevents a false other-film warning regardless of extra years', () => {
  fc.assert(fc.property(fc.integer({ min: 1900, max: 2099 }), fc.integer({ min: -1, max: 1 }), fc.array(fc.integer({ min: 1900, max: 2099 }), { maxLength: 4 }), (year, delta, others) => {
    expect(otherFilmYear([...others, year + delta], year)).toBeUndefined();
  }), options);
});

it('oversized numeric labels never turn untrusted size text into Infinity', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 400 }), fc.constantFrom('GB', 'MB'), (digits, unit) => {
    const result = streamLabels({ description: `${'9'.repeat(digits)}${unit}` });
    for (const size of [result.traits.sizeGB, result.largestGB]) if (size !== undefined) expect(Number.isFinite(size)).toBe(true);
  }), options);
});
