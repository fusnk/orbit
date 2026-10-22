import { describe, expect, it } from 'vitest';
import { parseWith, ManifestSchema, StreamResponseSchema, SubtitlesResponseSchema } from './schema';

const base = { id: 'org.example', version: '1.2.3', name: 'Example', types: ['movie'], resources: ['stream'] };

describe('manifest trust boundaries', () => {
  it('keeps an explicit empty type list, and reads an empty prefix list as any id, as stremio-core does', () => {
    // Not a widening an addon couldn't already ask for: leaving `idPrefixes` out means any id too.
    const manifest = parseWith(ManifestSchema, { ...base, idPrefixes: ['tt'], resources: [{ name: 'stream', types: [], idPrefixes: [] }] });
    expect(manifest.resources).toEqual([{ name: 'stream', types: [], idPrefixes: undefined }]);
  });

  it('uses modern extras even when legacy extras disagree', () => {
    const manifest = parseWith(ManifestSchema, { ...base, catalogs: [{ type: 'movie', id: 'top', extra: [], extraSupported: ['search'], extraRequired: ['search'] }] });
    expect(manifest.catalogs[0]?.extra).toEqual([]);
  });

  it('bounds provider-controlled manifest lists before routing', () => {
    const manifest = parseWith(ManifestSchema, {
      ...base,
      types: Array.from({ length: 55 }, (_, i) => `type${i}`),
      resources: Array.from({ length: 25 }, (_, i) => `resource${i}`),
      catalogs: Array.from({ length: 205 }, (_, i) => ({ type: 'movie', id: `catalog${i}` })),
    });
    expect(manifest.types).toHaveLength(50);
    expect(manifest.resources).toHaveLength(20);
    expect(manifest.catalogs).toHaveLength(200);
    expect(manifest.catalogs.at(-1)?.id).toBe('catalog199');
  });

  it('rejects control characters in identifiers rather than rewriting identity', () => {
    expect(() => parseWith(ManifestSchema, { ...base, id: 'org.\u0000example' })).toThrow();
    const manifest = parseWith(ManifestSchema, { ...base, types: ['movie', 'series\n'], resources: ['stream', { name: 'meta', types: ['series\u007f'] }] });
    expect(manifest.types).toEqual(['movie']);
    expect(manifest.resources[1]?.types).toEqual([]);
  });
});

describe('stream and subtitle response boundaries', () => {
  it('bounds streams and drops malformed hints without losing playback', () => {
    const streams = Array.from({ length: 505 }, (_, i) => ({ url: `https://cdn.example/${i}.mkv`, behaviorHints: { videoSize: -1, filename: 42, bingeGroup: 'group' } }));
    const parsed = parseWith(StreamResponseSchema, { streams }).streams;
    expect(parsed).toHaveLength(500);
    expect(parsed[0]).toMatchObject({ url: 'https://cdn.example/0.mkv', bingeGroup: 'group' });
    expect(parsed[0]?.videoSize).toBeUndefined();
    expect(parsed[0]?.filename).toBeUndefined();
  });

  it('drops a size too big to be a number (JSON reads 1e400 as Infinity), keeping the stream', () => {
    const json: unknown = JSON.parse('{"streams":[{"url":"https://cdn.example/a.mkv","name":"1080p","behaviorHints":{"videoSize":1e400}}]}');
    const [stream] = parseWith(StreamResponseSchema, json).streams;
    expect(stream?.url).toBe('https://cdn.example/a.mkv');
    expect(stream?.videoSize).toBeUndefined();
  });

  it('does not use untrusted torrent fields to inject extra magnet parameters', () => {
    const hash = 'A'.repeat(40);
    const parsed = parseWith(StreamResponseSchema, { streams: [{ infoHash: hash, fileIdx: -1, sources: ['tracker:https://tracker.example/announce?x=1&so=999', 'tracker:file:///secret', `tracker:https://tracker.example/${'x'.repeat(512)}`] }] }).streams;
    const magnet = new URL(parsed[0]!.url);
    expect(magnet.searchParams.get('xt')).toBe(`urn:btih:${hash.toLowerCase()}`);
    expect(magnet.searchParams.has('so')).toBe(false);
    expect(magnet.searchParams.getAll('tr')).toEqual(['https://tracker.example/announce?x=1&so=999']);
  });

  it.each([NaN, Infinity, -1, 240001])('drops invalid subtitle FPS %s while keeping its web file', (fpsMilli) => {
    const { subtitles } = parseWith(SubtitlesResponseSchema, { subtitles: [{ url: 'https://subs.example/a.srt', lang: 'en', fpsMilli }] });
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0]?.fpsMilli).toBeUndefined();
  });

  it('drops non-web subtitles and caps the accepted input list', () => {
    const subtitles = [{ url: 'file:///private/sub.srt', lang: 'en' }, ...Array.from({ length: 500 }, () => ({ url: 'https://subs.example/a.srt', lang: 'en', fpsMilli: 23976 }))];
    const parsed = parseWith(SubtitlesResponseSchema, { subtitles }).subtitles;
    expect(parsed).toHaveLength(499);
    expect(parsed[0]?.fpsMilli).toBe(23976);
  });
});
