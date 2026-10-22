import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../addons/aggregate', () => ({ aggregate: vi.fn() }));
vi.mock('./parental', async (original) => ({ ...(await original<typeof import('./parental')>()), withoutAdultAddons: <T>(addons: T[]) => Promise.resolve(addons) }));

import { aggregate } from '../addons/aggregate';
import * as registry from '../addons/registry';
import type { AggregateEvent, ResourceRequest, Stream, Subtitle, UsableAddon } from '../addons/types';
import { finishedStreams, loadStreams, loadSubtitles, streamRequest, usableAddons, withStreamSubtitles } from './service';
import { fromDetail, seasonsFrom, type Title } from './titles';

const mocked = vi.mocked(aggregate);
const addon = { key: 'a1', manifest: { name: 'Addon' } } as unknown as UsableAddon;
const stream = { url: 'https://cdn.example/movie.mkv', name: '4K' } as Stream;
const origin = { key: 'a1', name: 'Addon' };
let n = 0;
const req = (): ResourceRequest => ({ resource: 'stream', type: 'movie', id: `tt${++n}` });

async function collect(events: AsyncGenerator<AggregateEvent<Stream>>): Promise<string[]> {
  const types: string[] = [];
  for await (const event of events) types.push(event.type);
  return types;
}

beforeEach(() => mocked.mockReset());

describe('loadStreams', () => {
  it('asks the addons once for two lookups of the same movie, in flight or finished', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mocked.mockImplementation(async function* () {
      await gate;
      yield { type: 'partial', origin, items: [{ item: stream, origins: [origin] }] };
      yield { type: 'done', succeeded: 1, failed: 0 };
    });
    const r = req();
    const first = collect(loadStreams([addon], r, new AbortController().signal));
    const second = collect(loadStreams([addon], r, new AbortController().signal));
    expect(finishedStreams(r)).toBeUndefined();
    release();
    expect(await first).toEqual(['partial', 'done']);
    expect(await second).toEqual(['partial', 'done']);
    expect(await collect(loadStreams([addon], r, new AbortController().signal))).toEqual(['partial', 'done']);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(finishedStreams(r)).toEqual([stream]);
  });

  it('asks again after a lookup where an addon failed', async () => {
    mocked.mockImplementation(async function* () {
      yield { type: 'error', origin, error: { kind: 'timeout' } } as AggregateEvent<Stream>;
      yield { type: 'done', succeeded: 0, failed: 1 };
    });
    const r = req();
    await collect(loadStreams([addon], r, new AbortController().signal));
    expect(finishedStreams(r)).toBeUndefined();
    await collect(loadStreams([addon], r, new AbortController().signal));
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('lets one asker stop without cutting the lookup short for another', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mocked.mockImplementation(async function* () {
      await gate;
      yield { type: 'partial', origin, items: [{ item: stream, origins: [origin] }] };
      yield { type: 'done', succeeded: 1, failed: 0 };
    });
    const r = req();
    const stop = new AbortController();
    const leaving = collect(loadStreams([addon], r, stop.signal));
    const staying = collect(loadStreams([addon], r, new AbortController().signal));
    stop.abort();
    expect(await leaving).toEqual([]);
    release();
    expect(await staying).toEqual(['partial', 'done']);
  });

  it('keeps results for hours, signed links briefly, and nothing found for a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const answer = (streams: Stream[]) =>
        mocked.mockImplementation(async function* () {
          yield { type: 'partial', origin, items: streams.map((item) => ({ item, origins: [origin] })) };
          yield { type: 'done', succeeded: 1, failed: 0 };
        });
      const plain = req();
      const signed = req();
      const empty = req();
      answer([stream]);
      await collect(loadStreams([addon], plain, new AbortController().signal));
      answer([{ ...stream, url: 'https://cdn.example/movie.mkv?token=abc' }]);
      await collect(loadStreams([addon], signed, new AbortController().signal));
      answer([]);
      await collect(loadStreams([addon], empty, new AbortController().signal));

      vi.advanceTimersByTime(2 * 60_000);
      expect(finishedStreams(plain)).toEqual([stream]);
      expect(finishedStreams(signed)).toHaveLength(1);
      expect(finishedStreams(empty)).toBeUndefined();
      vi.advanceTimersByTime(20 * 60_000);
      expect(finishedStreams(plain)).toEqual([stream]);
      expect(finishedStreams(signed)).toBeUndefined();
      vi.advanceTimersByTime(3 * 60 * 60_000);
      expect(finishedStreams(plain)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('streamRequest', () => {
  /** A series as its meta's `videos` give it. */
  const series = (id: string, videos: { id: string; season: number; episode: number }[]): Title => ({ id, type: 'series', name: 'Show', genres: [], origins: [], seasons: seasonsFrom(videos) });
  const firstEpisode = (title: Title) => {
    const season = title.seasons![0]!;
    const episode = season.episodes[0]!;
    return { season: season.number, number: episode.number, id: episode.id };
  };

  it("asks for an anime episode by the episode's own id, as Stremio does", () => {
    const anime = series('kitsu:1234', [{ id: 'kitsu:1234:5', season: 1, episode: 5 }]);
    expect(streamRequest(anime, firstEpisode(anime))).toEqual({ resource: 'stream', type: 'series', id: 'kitsu:1234:5' });
  });

  it('keeps Cinemeta episodes as tt…:season:episode', () => {
    const show = series('tt0944947', [{ id: 'tt0944947:2:3', season: 2, episode: 3 }]);
    expect(streamRequest(show, firstEpisode(show)).id).toBe('tt0944947:2:3');
  });

  it('falls back to id:season:episode when the episode has no id of its own', () => {
    const show = { id: 'tt1', type: 'series', name: 'Show', genres: [], origins: [] };
    expect(streamRequest(show, { season: 1, number: 2, id: undefined }).id).toBe('tt1:1:2');
    expect(streamRequest(show, { season: 1, number: 2, id: '' }).id).toBe('tt1:1:2');
    expect(streamRequest({ ...show, type: 'movie' }).id).toBe('tt1');
  });

  it("asks for a movie by the meta's default video id, but an episode by its own", () => {
    const movie = fromDetail({ id: 'tmdb:603', type: 'movie', name: 'The Matrix', posterShape: 'poster', behaviorHints: { defaultVideoId: 'tt0133093' } }, []);
    expect(streamRequest(movie).id).toBe('tt0133093');
    expect(streamRequest(movie, { season: 1, number: 2, id: 'tmdb:603:1:2' }).id).toBe('tmdb:603:1:2');
  });
});

describe('loadSubtitles', () => {
  it("asks for an episode's subtitles by its own id", async () => {
    const subsAddon = { key: 'a1', enabled: true, urlReadable: true, manifest: { name: 'Subs', resources: [{ name: 'subtitles', types: ['series'] }], behaviorHints: { adult: false } } };
    vi.spyOn(registry, 'ensureBuiltins').mockResolvedValue(undefined);
    vi.spyOn(registry, 'list').mockResolvedValue([subsAddon] as unknown as Awaited<ReturnType<typeof registry.list>>);
    const subs = vi.mocked(aggregate as unknown as (...args: unknown[]) => AsyncGenerator<AggregateEvent<Subtitle>>);
    subs.mockImplementation(async function* () {
      yield { type: 'done', succeeded: 1, failed: 0 };
    });
    const title = { id: 'kitsu:1234', type: 'series', name: 'Show', genres: [], origins: [] };
    await loadSubtitles(title, { season: 1, number: 5, id: 'kitsu:1234:5' }, { filename: 'a.mkv' }, new AbortController().signal);
    expect(subs.mock.calls[0]![1]).toEqual({ resource: 'subtitles', type: 'series', id: 'kitsu:1234:5', extra: [['filename', 'a.mkv']] });
  });

  it("sends the stream's hash, size and filename in stremio-core's order", async () => {
    const subsAddon = { key: 'a1', enabled: true, urlReadable: true, manifest: { name: 'Subs', resources: [{ name: 'subtitles', types: ['movie'] }], behaviorHints: { adult: false } } };
    vi.spyOn(registry, 'ensureBuiltins').mockResolvedValue(undefined);
    vi.spyOn(registry, 'list').mockResolvedValue([subsAddon] as unknown as Awaited<ReturnType<typeof registry.list>>);
    const subs = vi.mocked(aggregate as unknown as (...args: unknown[]) => AsyncGenerator<AggregateEvent<Subtitle>>);
    subs.mockImplementation(async function* () {
      yield { type: 'done', succeeded: 1, failed: 0 };
    });
    const title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };
    await loadSubtitles(title, undefined, { filename: 'Film.mkv', videoSize: 123, videoHash: '8e245d9679d31e12' }, new AbortController().signal);
    expect(subs.mock.calls[0]![1]).toMatchObject({ extra: [['videoHash', '8e245d9679d31e12'], ['videoSize', '123'], ['filename', 'Film.mkv']] });
  });

  it('keeps the last merged snapshot, so a subtitle is listed once, however many addons answered', async () => {
    const subsAddon = { key: 'a1', enabled: true, urlReadable: true, manifest: { name: 'Subs', resources: [{ name: 'subtitles', types: ['movie'] }], behaviorHints: { adult: false } } };
    vi.spyOn(registry, 'ensureBuiltins').mockResolvedValue(undefined);
    vi.spyOn(registry, 'list').mockResolvedValue([subsAddon] as unknown as Awaited<ReturnType<typeof registry.list>>);
    const first = { id: '1', url: 'https://subs.example/1.srt', lang: 'eng' } as Subtitle;
    const second = { id: '2', url: 'https://subs.example/2.srt', lang: 'eng' } as Subtitle;
    const other = { key: 'a2', name: 'Other' };
    const subs = vi.mocked(aggregate as unknown as (...args: unknown[]) => AsyncGenerator<AggregateEvent<Subtitle>>);
    subs.mockImplementation(async function* () {
      // Each partial event is everything found so far, merged.
      yield { type: 'partial', origin, items: [{ item: first, origins: [origin] }] };
      yield { type: 'partial', origin: other, items: [{ item: first, origins: [origin] }, { item: second, origins: [other] }] };
      yield { type: 'done', succeeded: 2, failed: 0 };
    });
    const title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };
    const { subtitles } = await loadSubtitles(title, undefined, {}, new AbortController().signal);
    expect(subtitles.map((s) => s.item.url)).toEqual([first.url, second.url]);
  });

  it("offers the stream's own subtitles first, from its addon, with the subtitle addons' after", async () => {
    const subsAddon = { key: 'a1', enabled: true, urlReadable: true, manifest: { name: 'Subs', resources: [{ name: 'subtitles', types: ['movie'] }], behaviorHints: { adult: false } } };
    vi.spyOn(registry, 'ensureBuiltins').mockResolvedValue(undefined);
    vi.spyOn(registry, 'list').mockResolvedValue([subsAddon] as unknown as Awaited<ReturnType<typeof registry.list>>);
    const shared = { url: 'https://subs.example/shared.srt', lang: 'eng' } as Subtitle;
    const fromAddon = { url: 'https://subs.example/addon.srt', lang: 'eng' } as Subtitle;
    const own = { url: 'https://cdn.example/own.srt', lang: 'fre' } as Subtitle;
    const subs = vi.mocked(aggregate as unknown as (...args: unknown[]) => AsyncGenerator<AggregateEvent<Subtitle>>);
    subs.mockImplementation(async function* () {
      yield { type: 'partial', origin, items: [{ item: fromAddon, origins: [origin] }, { item: shared, origins: [origin] }] };
      yield { type: 'done', succeeded: 1, failed: 0 };
    });
    const streams = { key: 's1', name: 'Streams' };
    const title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };
    const { subtitles } = await loadSubtitles(title, undefined, {}, new AbortController().signal, { subtitles: [own, shared], origin: streams });
    expect(subtitles).toEqual([
      { item: own, origins: [streams] },
      { item: shared, origins: [streams, origin] },
      { item: fromAddon, origins: [origin] },
    ]);
  });

  it("still offers the stream's own subtitles when no subtitle addon is installed", async () => {
    vi.spyOn(registry, 'ensureBuiltins').mockResolvedValue(undefined);
    vi.spyOn(registry, 'list').mockResolvedValue([]);
    const subs = vi.mocked(aggregate as unknown as (...args: unknown[]) => AsyncGenerator<AggregateEvent<Subtitle>>);
    subs.mockImplementation(async function* () {
      yield { type: 'done', succeeded: 0, failed: 0 };
    });
    const own = { url: 'https://cdn.example/own.srt', lang: 'eng' } as Subtitle;
    const title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };
    const { subtitles } = await loadSubtitles(title, undefined, {}, new AbortController().signal, { subtitles: [own], origin });
    expect(subtitles).toEqual([{ item: own, origins: [origin] }]);
  });
});

describe('withStreamSubtitles', () => {
  const a = { url: 'https://subs.example/a.srt', lang: 'eng' } as Subtitle;
  const b = { url: 'https://subs.example/b.srt', lang: 'eng' } as Subtitle;
  const streams = { key: 's1', name: 'Streams' };

  it('lists a subtitle the stream ships twice only once', () => {
    expect(withStreamSubtitles([], { subtitles: [a, a, b], origin: streams })).toEqual([
      { item: a, origins: [streams] },
      { item: b, origins: [streams] },
    ]);
  });

  it("names the stream's addon once when it also answered as a subtitle addon", () => {
    const merged = withStreamSubtitles([{ item: a, origins: [streams, origin] }], { subtitles: [a], origin: streams });
    expect(merged).toEqual([{ item: a, origins: [streams, origin] }]);
  });

  it("leaves the subtitle addons' list as it is when the stream has none", () => {
    const found = [{ item: a, origins: [origin] }];
    expect(withStreamSubtitles(found, undefined)).toEqual(found);
    expect(withStreamSubtitles(found, { subtitles: [], origin: streams })).toEqual(found);
  });

  it("doesn't change the subtitle addons' results it merges into", () => {
    const found = [{ item: a, origins: [origin] }];
    withStreamSubtitles(found, { subtitles: [a], origin: streams });
    expect(found).toEqual([{ item: a, origins: [origin] }]);
  });
});

describe('usableAddons', () => {
  const list = (addons: unknown[]) => vi.spyOn(registry, 'list').mockResolvedValue(addons as Awaited<ReturnType<typeof registry.list>>);
  const offline = { kind: 'network', message: 'dns error' };

  it("fails with the built-ins' install error while nothing is installed (a first launch offline)", async () => {
    vi.spyOn(registry, 'ensureBuiltins').mockRejectedValue(offline);
    list([]);
    await expect(usableAddons()).rejects.toBe(offline);
  });

  it('carries on with what is installed when the built-ins could not be added', async () => {
    const own = { key: 'a1', enabled: true, urlReadable: true, manifest: { name: 'Own', resources: [], behaviorHints: { adult: false } } };
    vi.spyOn(registry, 'ensureBuiltins').mockRejectedValue(offline);
    list([own]);
    expect((await usableAddons()).map((a) => a.key)).toEqual(['a1']);
  });

  it('answers an empty list once the built-ins are there but turned off', async () => {
    vi.spyOn(registry, 'ensureBuiltins').mockResolvedValue(undefined);
    list([{ key: 'cinemeta', enabled: false, urlReadable: true, manifest: { name: 'Cinemeta', resources: [] } }]);
    expect(await usableAddons()).toEqual([]);
  });
});
