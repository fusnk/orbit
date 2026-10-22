import fc from 'fast-check';
import * as v from 'valibot';
import { expect, it } from 'vitest';
import { AddonFailure } from './errors';
import { CatalogResponseSchema, ManifestSchema, MetaPreviewSchema, MetaResponseSchema, parseWith, StreamResponseSchema, SubtitlesResponseSchema } from './schema';

const options = { seed: 20261007, numRuns: 300 };

it('all addon schemas reject arbitrary JSON safely without unexpected exceptions', () => {
  fc.assert(fc.property(fc.jsonValue({ maxDepth: 5 }), (json) => {
    for (const schema of [ManifestSchema, MetaPreviewSchema, CatalogResponseSchema, MetaResponseSchema, StreamResponseSchema, SubtitlesResponseSchema] as v.GenericSchema[]) {
      const result = v.safeParse(schema, json);
      if (result.success) expect(parseWith(schema, json)).toEqual(result.output);
      else expect(() => parseWith(schema, json)).toThrow(AddonFailure);
    }
  }), options);
});

it('mixed response arrays keep good items while capping counts and sanitizing metadata', () => {
  fc.assert(fc.property(fc.array(fc.jsonValue({ maxDepth: 2 }), { maxLength: 50 }), fc.string({ maxLength: 1000 }), (garbage, text) => {
    const catalog = parseWith(CatalogResponseSchema, { metas: [...garbage, { id: 'tt123', type: 'movie', name: 'Safe', description: text }] });
    const good = catalog.metas.find((meta) => meta.id === 'tt123')!;
    expect(good.name).toBe('Safe');
    expect(good.description?.length).toBeLessThanOrEqual(4000);
    // eslint-disable-next-line no-control-regex
    expect(good.description).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
    const streams = parseWith(StreamResponseSchema, { streams: [...garbage, { url: 'https://example.test/video', name: text }] });
    expect(streams.streams.some((item) => item.url === 'https://example.test/video')).toBe(true);
    expect(streams.streams.every((item) => /^(?:https?:\/\/|magnet:)/i.test(item.url))).toBe(true);
    expect(streams.streams.length).toBeLessThanOrEqual(500);
    const subtitles = parseWith(SubtitlesResponseSchema, { subtitles: [...garbage, { url: 'https://example.test/subtitle', lang: 'en' }] });
    expect(subtitles.subtitles.some((item) => item.lang === 'en')).toBe(true);
  }), options);
});

it('large valid addon responses cannot exceed declared resource caps', () => {
  fc.assert(fc.property(fc.integer({ min: 500, max: 1200 }), (length) => {
    expect(parseWith(StreamResponseSchema, { streams: Array.from({ length }, () => ({ url: 'https://example.test/video' })) }).streams).toHaveLength(500);
    expect(parseWith(SubtitlesResponseSchema, { subtitles: Array.from({ length }, () => ({ url: 'https://example.test/subtitle', lang: 'en' })) }).subtitles).toHaveLength(500);
    expect(parseWith(CatalogResponseSchema, { metas: Array.from({ length }, (_, id) => ({ id: String(id), type: 'movie', name: 'Film' })) }).metas).toHaveLength(Math.min(length, 1000));
  }), { ...options, numRuns: 40 });
});
