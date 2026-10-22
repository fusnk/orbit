import { describe, expect, it } from 'vitest';
import { AddonFailure } from './errors';
import { CatalogResponseSchema, ManifestSchema, MetaResponseSchema, StreamResponseSchema, parseWith, streamKey } from './schema';

const base = {
  id: 'org.example',
  version: '1.2.3',
  name: 'Example',
  types: ['movie', 'series'],
  resources: ['catalog'],
};

describe('ManifestSchema', () => {
  it('decodes entities only in shown text, never in values sent back to the addon', () => {
    const m = parseWith(ManifestSchema, {
      ...base,
      name: 'Rock &amp; Co',
      resources: [{ name: 'catalog', idPrefixes: ['a&amp;b:'] }],
      catalogs: [{ type: 'movie', id: 'top', name: 'R&amp;B', extra: [{ name: 'genre', options: ['Rock &amp; Roll', 'Jazz'] }] }],
    });
    expect(m.name).toBe('Rock & Co');
    expect(m.catalogs[0]?.name).toBe('R&B');
    expect(m.catalogs[0]?.extra[0]?.options).toEqual(['Rock &amp; Roll', 'Jazz']);
    expect(m.resources[0]?.idPrefixes).toEqual(['a&amp;b:']);
  });

  it('accepts a minimal manifest and fills defaults', () => {
    const m = parseWith(ManifestSchema, base);
    expect(m.catalogs).toEqual([]);
    expect(m.behaviorHints).toEqual({ adult: false, p2p: false, configurable: false, configurationRequired: false });
  });

  it.each([
    ['missing id', { ...base, id: undefined }],
    ['empty name', { ...base, name: '   ' }],
    ['non-semver version', { ...base, version: 'latest' }],
    ['types not an array', { ...base, types: 'movie' }],
    ['not an object', 'manifest'],
  ])('rejects %s', (_, input) => {
    expect(() => parseWith(ManifestSchema, input)).toThrow(AddonFailure);
  });

  it('scopes short resources to manifest types/prefixes and full ones to their own', () => {
    const m = parseWith(ManifestSchema, {
      ...base,
      idPrefixes: ['tt'],
      resources: ['meta', { name: 'stream', types: ['movie'] }, { name: 'subtitles' }],
    });
    expect(m.resources).toEqual([
      { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt'] },
      { name: 'stream', types: ['movie'], idPrefixes: undefined },
      { name: 'subtitles', types: ['movie', 'series'], idPrefixes: undefined },
    ]);
  });

  it('converts legacy extraSupported/extraRequired', () => {
    const m = parseWith(ManifestSchema, {
      ...base,
      catalogs: [{ type: 'movie', id: 'top', extraSupported: ['search', 'skip'], extraRequired: ['search'] }],
    });
    expect(m.catalogs[0]?.extra).toEqual([
      { name: 'search', isRequired: true, options: undefined, optionsLimit: 1 },
      { name: 'skip', isRequired: false, options: undefined, optionsLimit: 1 },
    ]);
  });

  it('drops invalid catalogs and optional fields instead of failing', () => {
    const m = parseWith(ManifestSchema, {
      ...base,
      logo: 'http://insecure.example/logo.png',
      background: 'javascript:alert(1)',
      catalogs: [{ type: 'movie' }, { type: 'movie', id: 'ok' }],
    });
    expect(m.logo).toBeUndefined();
    expect(m.background).toBeUndefined();
    expect(m.catalogs.map((c) => c.id)).toEqual(['ok']);
  });

  it('keeps the first of catalogs that repeat a type and id', () => {
    // Both would be asked at the same address; repeated, they'd make duplicate rows with the same keys.
    const top = { type: 'movie', id: 'top', name: 'Top' };
    const m = parseWith(ManifestSchema, {
      ...base,
      catalogs: [top, { ...top, name: 'Again' }, { type: 'series', id: 'top' }, ...Array.from({ length: 150 }, () => top)],
      addonCatalogs: [top, top],
    });
    expect(m.catalogs.map((c) => `${c.type}/${c.id}/${c.name}`)).toEqual(['movie/top/Top', 'series/top/undefined']);
    expect(m.addonCatalogs).toHaveLength(1);
  });

  it('strips control characters, trims, caps length, and drops unknown keys', () => {
    const m = parseWith(ManifestSchema, {
      ...base,
      name: '  Ex\u0000am\u001bple  ',
      description: 'x'.repeat(5000),
      evil: true,
      ['__proto__']: { polluted: true },
    });
    expect(m.name).toBe('Example');
    expect(m.description).toHaveLength(2000);
    expect(m).not.toHaveProperty('evil');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('CatalogResponseSchema', () => {
  it("reads a preview's genres from links when it has no genres list", () => {
    const { metas } = parseWith(CatalogResponseSchema, { metas: [{ id: 'tt1', type: 'movie', name: 'X', links: [{ name: 'Horror', category: 'Genres', url: 'stremio:///discover' }] }] });
    expect(metas[0]?.genres).toEqual(['Horror']);
  });

  it('keeps valid metas, drops bad ones, normalizes fields', () => {
    const r = parseWith(CatalogResponseSchema, {
      metas: [
        { id: 'a', type: 'movie', name: 'A', releaseInfo: 1999, posterShape: 'weird' },
        { id: 'b', type: 'movie' },
        'nonsense',
        { id: 'c', type: 'movie', name: 'C', poster: 'https://img.example/c.jpg' },
      ],
    });
    expect(r.metas.map((m) => m.id)).toEqual(['a', 'c']);
    expect(r.metas[0]).toMatchObject({ releaseInfo: '1999', posterShape: 'poster' });
    expect(r.metas[1]?.poster).toBe('https://img.example/c.jpg');
  });

  it('drops pictures on this machine or the local network', () => {
    const lan = ['https://localhost/a.jpg', 'https://printer.localhost./a.jpg', 'https://127.0.0.1/a.jpg', 'https://2130706433/a.jpg', 'https://0x7f.1/a.jpg', 'https://192.168.1.1/a.jpg', 'https://10.0.0.8:8443/a.jpg', 'https://172.20.0.1/a.jpg', 'https://169.254.169.254/a.jpg', 'https://[::1]/a.jpg', 'https://[::ffff:127.0.0.1]/a.jpg', 'https://[fe80::1]/a.jpg', 'https://[fd00::1]/a.jpg', 'https://0.0.0.0/a.jpg'];
    // The rest of the ranges Rust refuses (addons/net.rs `is_private_ip`).
    lan.push('https://198.18.0.1/a.jpg', 'https://198.19.255.1/a.jpg', 'https://255.255.255.255/a.jpg', 'https://[::127.0.0.1]/a.jpg', 'https://[::c0a8:101]/a.jpg', 'https://[64:ff9b::c0a8:101]/a.jpg', 'https://[64:ff9b::127.0.0.1]/a.jpg', 'https://[2002:c0a8:101::1]/a.jpg', 'https://[2002:7f00:1:1::]/a.jpg');
    const metas = [...lan, 'https://8.8.8.8/a.jpg', 'https://[64:ff9b::808:808]/a.jpg', 'https://[2002:808:808::1]/a.jpg', 'https://[2606:4700::1111]/a.jpg', 'https://img.example/a.jpg'].map((poster, i) => ({ id: `m${i}`, type: 'movie', name: 'M', poster }));
    const posters = parseWith(CatalogResponseSchema, { metas }).metas.map((m) => m.poster);
    expect(posters).toEqual([...lan.map(() => undefined), 'https://8.8.8.8/a.jpg', 'https://[64:ff9b::808:808]/a.jpg', 'https://[2002:808:808::1]/a.jpg', 'https://[2606:4700::1111]/a.jpg', 'https://img.example/a.jpg']);
  });

  it('caps the number of metas', () => {
    const metas = Array.from({ length: 1500 }, (_, i) => ({ id: `m${i}`, type: 'movie', name: `M${i}` }));
    expect(parseWith(CatalogResponseSchema, { metas }).metas).toHaveLength(1000);
  });

  it('rejects a response without metas', () => {
    expect(() => parseWith(CatalogResponseSchema, { items: [] })).toThrow(AddonFailure);
  });
});

describe('MetaResponseSchema', () => {
  it('decodes HTML entities some addons send in text', () => {
    const { meta } = parseWith(MetaResponseSchema, {
      meta: { id: 'tt15047880', type: 'movie', name: 'Tom &amp; Jerry', cast: ['Josh O&apos;Connor', 'A &#233; &#xE9; &bogus; &amp;lt;b&amp;gt;'], description: '&quot;Hi&quot;&nbsp;&#0;' },
    });
    expect(meta?.name).toBe('Tom & Jerry');
    expect(meta?.cast).toEqual(["Josh O'Connor", 'A é é &bogus; &lt;b&gt;']);
    expect(meta?.description).toBe('"Hi" &#0;');
  });

  it('normalizes a Cinemeta-style series meta', () => {
    const { meta } = parseWith(MetaResponseSchema, {
      meta: {
        id: 'tt0944947',
        type: 'series',
        name: 'Game of Thrones',
        imdbRating: '9.2',
        runtime: '57 min',
        director: null,
        writer: ['David Benioff', 'D.B. Weiss'],
        cast: 'Emilia Clarke, Peter Dinklage',
        background: 'https://images.metahub.space/background/medium/tt0944947/img',
        videos: [
          { id: 'tt0944947:1:1', name: 'Winter Is Coming', season: 1, number: 1, description: 'Pilot.', thumbnail: 'https://episodes.metahub.space/tt0944947/1/1/w780.jpg' },
          { id: 'tt0944947:1:2', title: 'The Kingsroad', season: 1, episode: 2, overview: 'Second.' },
          { season: 1, episode: 3 },
        ],
      },
    });
    expect(meta?.director).toBeUndefined();
    expect(meta?.cast).toEqual(['Emilia Clarke', 'Peter Dinklage']);
    expect(meta?.videos).toEqual([
      expect.objectContaining({ title: 'Winter Is Coming', episode: 1, overview: 'Pilot.' }),
      expect.objectContaining({ title: 'The Kingsroad', episode: 2, overview: 'Second.' }),
    ]);
  });

  it('reads genres and people from links when the legacy lists are missing or empty', () => {
    const link = (name: string, category: string) => ({ name, category, url: `stremio:///search?search=${encodeURIComponent(name)}` });
    const { meta } = parseWith(MetaResponseSchema, {
      meta: {
        id: 'tmdb:1',
        type: 'movie',
        name: 'Film',
        genres: [],
        links: [link('Drama', 'Genres'), link('Drama', 'Genres'), link('Ann', 'Cast'), link('Bo', 'actor'), link('Cy', 'Directors'), link('Di', 'writer'), link('7.1', 'imdb'), { name: 'Bad' }],
      },
    });
    expect(meta).toMatchObject({ genres: ['Drama'], cast: ['Ann', 'Bo'], director: ['Cy'], writer: ['Di'] });
    expect(meta).not.toHaveProperty('links');
  });

  it('keeps the legacy lists over links', () => {
    const { meta } = parseWith(MetaResponseSchema, {
      meta: { id: 'tt1', type: 'movie', name: 'X', genres: ['Comedy'], cast: ['A'], links: [{ name: 'Drama', category: 'Genres', url: 'https://x.example' }, { name: 'B', category: 'Cast', url: 'https://x.example' }] },
    });
    expect(meta).toMatchObject({ genres: ['Comedy'], cast: ['A'] });
  });

  it('keeps a valid default video id and drops a malformed one', () => {
    const parse = (behaviorHints: unknown) => parseWith(MetaResponseSchema, { meta: { id: 'tmdb:1', type: 'movie', name: 'X', behaviorHints } }).meta?.behaviorHints?.defaultVideoId;
    expect(parse({ defaultVideoId: 'tt0133093', hasScheduledVideos: true })).toBe('tt0133093');
    expect(parse({ defaultVideoId: 'tt1\n' })).toBeUndefined();
    expect(parse({ defaultVideoId: 42 })).toBeUndefined();
    expect(parse(null)).toBeUndefined();
  });

  it("keeps a video's own streams, checked as stream responses are", () => {
    const hash = 'a'.repeat(40);
    const { meta } = parseWith(MetaResponseSchema, {
      meta: {
        id: 'local:show',
        type: 'series',
        name: 'Show',
        videos: [
          {
            id: 'local:show:1',
            season: 1,
            episode: 1,
            streams: [
              { url: 'https://cdn.example/1.mp4', title: 'Main' },
              { url: 'http://cdn.example/1-alt.mp4' },
              { infoHash: hash, fileIdx: 2 },
              { url: 'javascript:alert(1)' },
              { url: 'file:///etc/passwd' },
              { ytId: 'dQw4w9WgXcQ' },
              { externalUrl: 'https://example.com' },
            ],
          },
          // stremio-core's alias: `stream`, one or many.
          { id: 'local:show:2', season: 1, episode: 2, stream: { url: 'https://cdn.example/2.mp4' } },
          { id: 'local:show:3', season: 1, episode: 3, stream: [{ url: 'https://cdn.example/3.mp4' }] },
          // Nothing playable, or not a list: as if it listed none.
          { id: 'local:show:4', season: 1, episode: 4, streams: [{ ytId: 'dQw4w9WgXcQ' }] },
          { id: 'local:show:5', season: 1, episode: 5, streams: 'https://cdn.example/5.mp4' },
          { id: 'local:show:6', season: 1, episode: 6, streams: [] },
        ],
      },
    });
    const urls = meta?.videos?.map((video) => video.streams?.map((s) => s.url));
    expect(urls).toEqual([
      ['https://cdn.example/1.mp4', 'http://cdn.example/1-alt.mp4', `magnet:?xt=urn:btih:${hash}&so=2`],
      ['https://cdn.example/2.mp4'],
      ['https://cdn.example/3.mp4'],
      undefined,
      undefined,
      undefined,
    ]);
    expect(meta?.videos?.[0]?.streams?.[0]).toEqual(expect.objectContaining({ torrent: false, description: 'Main' }));
    expect(meta?.videos?.[0]?.streams?.[2]?.torrent).toBe(true);
  });

  it("caps a video's own streams", () => {
    const streams = Array.from({ length: 600 }, (_, i) => ({ url: `https://cdn.example/${i}.mp4` }));
    const { meta } = parseWith(MetaResponseSchema, { meta: { id: 'tt1', type: 'movie', name: 'X', videos: [{ id: 'tt1', streams }] } });
    expect(meta?.videos?.[0]?.streams).toHaveLength(500);
  });

  it('treats an empty rating as absent and accepts meta: null', () => {
    const { meta } = parseWith(MetaResponseSchema, { meta: { id: 'tt1', type: 'movie', name: 'X', imdbRating: '' } });
    expect(meta?.imdbRating).toBeUndefined();
    expect(parseWith(MetaResponseSchema, { meta: null }).meta).toBeNull();
  });
});

describe('StreamResponseSchema', () => {
  it('keeps http(s) streams and torrents, and drops YouTube and external ones', () => {
    const { streams } = parseWith(StreamResponseSchema, {
      streams: [
        { url: 'https://cdn.example/movie.mkv', name: 'Addon\n1080p', title: 'Movie.1080p.WEB-DL.mkv\n💾 2.1 GB', behaviorHints: { filename: 'Movie.1080p.WEB-DL.mkv', videoSize: 2254857830 } },
        { url: 'http://127.0.0.1:11470/stream', description: 'Local server' },
        { infoHash: 'abc', fileIdx: 0 },
        {
          infoHash: '08ADA5A7A6183AAE1E09D831DF6748D566095A10',
          fileIdx: 1,
          sources: ['tracker:udp://tracker.example:80/announce', 'dht:08ada5a7a6183aae1e09d831df6748d566095a10', 'tracker:javascript:alert(1)'],
          title: 'Sintel 1080p',
        },
        { ytId: 'dQw4w9WgXcQ' },
        { externalUrl: 'https://example.com' },
        { url: 'javascript:alert(1)' },
      ],
    });
    expect(streams).toHaveLength(3);
    expect(streams[2]).toMatchObject({
      torrent: true,
      description: 'Sintel 1080p',
      url: 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&so=1&tr=udp%3A%2F%2Ftracker.example%3A80%2Fannounce',
    });
    expect(streams[0]?.torrent).toBe(false);
    expect(streams[0]).toMatchObject({ name: 'Addon\n1080p', description: 'Movie.1080p.WEB-DL.mkv\n💾 2.1 GB', filename: 'Movie.1080p.WEB-DL.mkv', videoSize: 2254857830 });
    expect(streams[1]).toMatchObject({ description: 'Local server' });
  });

  it('keeps an OpenSubtitles hash hint and drops a malformed one, without losing the other hints', () => {
    const { streams } = parseWith(StreamResponseSchema, {
      streams: [
        { url: 'https://cdn.example/a.mkv', behaviorHints: { videoHash: '8E245D9679D31E12', videoSize: 5 } },
        { url: 'https://cdn.example/b.mkv', behaviorHints: { videoHash: 'not-a-hash', filename: 'b.mkv' } },
        { url: 'https://cdn.example/c.mkv', behaviorHints: null },
      ],
    });
    expect(streams.map((s) => s.videoHash)).toEqual(['8e245d9679d31e12', undefined, undefined]);
    expect(streams[0]?.videoSize).toBe(5);
    expect(streams[1]?.filename).toBe('b.mkv');
  });

  it('strips bidi overrides and isolates from text but keeps the LRM/RLM marks', () => {
    const { streams } = parseWith(StreamResponseSchema, {
      streams: [{ url: 'https://cdn.example/a.mkv', name: 'A\u202Egnp.exe\u202C \u2066x\u2069', description: 'فيلم\u200F 1080p\u200E' }],
    });
    expect(streams[0]).toMatchObject({ name: 'Agnp.exe x', description: 'فيلم\u200F 1080p\u200E' });
  });

  it("keeps a web stream's request proxy headers, checked, and ignores response ones", () => {
    const { streams } = parseWith(StreamResponseSchema, {
      streams: [
        { url: 'https://cdn.example/a.m3u8', behaviorHints: { proxyHeaders: { request: { Referer: 'https://site.example/', Host: 'evil.example', 'X-Bad': 'a\r\nb' }, response: { 'Access-Control-Allow-Origin': '*' } } } },
        { url: 'https://cdn.example/b.mkv', behaviorHints: { proxyHeaders: { request: { Cookie: 'session=1' } } } },
        { url: 'https://cdn.example/c.mkv', behaviorHints: { proxyHeaders: 'Referer: x', filename: 'c.mkv' } },
        { url: 'https://cdn.example/d.mkv', behaviorHints: { proxyHeaders: { request: ['Referer'] } } },
        { infoHash: 'a'.repeat(40), behaviorHints: { proxyHeaders: { request: { Referer: 'https://site.example/' } } } },
      ],
    });
    expect(streams).toHaveLength(5);
    expect(streams[0]?.headers).toEqual({ Referer: 'https://site.example/' });
    for (const stream of streams.slice(1)) expect(stream).not.toHaveProperty('headers');
    // A malformed proxyHeaders costs only itself, not the stream's other hints.
    expect(streams[2]?.filename).toBe('c.mkv');
    // Headers don't make another stream of the same address.
    expect(streamKey(streams[0]!)).toBe('https://cdn.example/a.m3u8');
  });

  it('keys one torrent alike whatever trackers each addon lists', () => {
    const { streams } = parseWith(StreamResponseSchema, {
      streams: [
        { infoHash: 'A'.repeat(40), fileIdx: 1, sources: ['tracker:udp://a.example:80'] },
        { infoHash: 'a'.repeat(40), fileIdx: 1 },
        { infoHash: 'a'.repeat(40), fileIdx: 2, sources: ['tracker:udp://a.example:80'] },
        { url: 'https://cdn.example/a.mkv?x=1&tr=keep' },
      ],
    });
    const keys = streams.map(streamKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    // Only a torrent's trackers are left out: a web URL is its own key.
    expect(keys[3]).toBe('https://cdn.example/a.mkv?x=1&tr=keep');
  });

  it("keeps a stream's own subtitles that are web addresses, and drops the rest", () => {
    const { streams } = parseWith(StreamResponseSchema, {
      streams: [
        {
          url: 'https://cdn.example/a.mkv',
          subtitles: [
            { id: '1', url: 'https://subs.example/a.en.srt', lang: 'eng' },
            { id: '2', url: 'http://subs.example/a.fr.srt', lang: 'fre' },
            { id: '3', url: 'file:///etc/passwd', lang: 'eng' },
            { id: '4', url: 'javascript:alert(1)', lang: 'eng' },
            { id: '5', lang: 'eng' },
            'https://subs.example/bare.srt',
            null,
            { url: 'https://subs.example/no-lang.srt' },
          ],
        },
        { infoHash: 'a'.repeat(40), subtitles: [{ url: 'https://subs.example/t.srt', lang: 'spa' }] },
      ],
    });
    expect(streams[0]?.subtitles).toEqual([
      { id: '1', url: 'https://subs.example/a.en.srt', lang: 'eng' },
      { id: '2', url: 'http://subs.example/a.fr.srt', lang: 'fre' },
      { url: 'https://subs.example/no-lang.srt', lang: '' },
    ]);
    expect(streams[1]?.subtitles).toEqual([{ url: 'https://subs.example/t.srt', lang: 'spa' }]);
  });

  it('reads missing, null or malformed stream subtitles as none, keeping the stream', () => {
    const { streams } = parseWith(StreamResponseSchema, {
      streams: [
        { url: 'https://cdn.example/a.mkv' },
        { url: 'https://cdn.example/b.mkv', subtitles: null },
        { url: 'https://cdn.example/c.mkv', subtitles: 'https://subs.example/c.srt' },
        { url: 'https://cdn.example/d.mkv', subtitles: { url: 'https://subs.example/d.srt' } },
      ],
    });
    expect(streams.map((s) => s.subtitles)).toEqual([[], [], [], []]);
  });

  it("caps a stream's subtitles", () => {
    const subtitles = Array.from({ length: 80 }, (_, i) => ({ url: `https://subs.example/${i}.srt`, lang: 'eng' }));
    const { streams } = parseWith(StreamResponseSchema, { streams: [{ url: 'https://cdn.example/a.mkv', subtitles }] });
    expect(streams[0]?.subtitles).toHaveLength(50);
  });

  it("leaves a stream's key alone whatever subtitles it carries", () => {
    const { streams } = parseWith(StreamResponseSchema, {
      streams: [{ url: 'https://cdn.example/a.mkv' }, { url: 'https://cdn.example/a.mkv', subtitles: [{ url: 'https://subs.example/a.srt', lang: 'eng' }] }],
    });
    expect(streamKey(streams[0]!)).toBe(streamKey(streams[1]!));
  });
});
