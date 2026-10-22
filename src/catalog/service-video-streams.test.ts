import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const registry = vi.hoisted(() => ({
  ensureBuiltins: vi.fn(() => Promise.resolve()),
  list: vi.fn(),
  request: vi.fn(),
  onAddonsChange: vi.fn(),
}));
vi.mock('../addons/registry', () => registry);
vi.mock('./parental', () => ({ withoutAdultAddons: (addons: unknown) => addons }));
vi.mock('../addons/aggregate', () => ({ aggregate: vi.fn() }));

import { aggregate } from '../addons/aggregate';
import { ManifestSchema, parseWith } from '../addons/schema';
import type { AggregateEvent, InstalledAddon, Stream } from '../addons/types';
import { finishedStreams, loadMeta, loadStreams, streamAddons, streamRequest } from './service';

function addon(key: string, resources: string[]): InstalledAddon {
  return {
    key,
    manifest: parseWith(ManifestSchema, { id: key, version: '1.0.0', name: key, types: ['movie', 'series'], resources, catalogs: [], idPrefixes: ['local:'] }),
    displayHost: `${key}.example`,
    enabled: true,
    installedAt: 0,
    urlReadable: true,
    builtIn: false,
    owned: true,
    shared: false,
    sharedBy: null,
  };
}

const metaAddon = addon('meta', ['meta']);
const streamAddon = addon('streams', ['stream']);

async function events(gen: AsyncGenerator<AggregateEvent<Stream>>): Promise<AggregateEvent<Stream>[]> {
  const all: AggregateEvent<Stream>[] = [];
  for await (const event of gen) all.push(event);
  return all;
}

beforeEach(() => {
  vi.mocked(aggregate).mockReset();
  registry.request.mockReset();
  registry.list.mockResolvedValue([metaAddon, streamAddon]);
});

describe("a video's own streams", () => {
  it('are played from the addon that listed them, without asking the stream addons', async () => {
    registry.request.mockResolvedValue({
      meta: {
        id: 'local:show',
        type: 'series',
        name: 'Show',
        videos: [
          { id: 'local:show:1', season: 1, episode: 1, streams: [{ url: 'https://cdn.example/1.mp4' }, { url: 'https://cdn.example/1.mp4' }, { url: 'https://cdn.example/1b.mp4' }] },
          { id: 'local:show:2', season: 1, episode: 2 },
        ],
      },
    });
    const title = (await loadMeta('series', 'local:show'))!;
    const req = streamRequest(title, { season: 1, number: 1, id: 'local:show:1' });

    const addons = await streamAddons(req);
    expect(addons.map((a) => a.key)).toEqual(['meta']);
    const found = await events(loadStreams(addons, req, new AbortController().signal));
    const origin = { key: 'meta', name: 'meta' };
    expect(found).toEqual([
      {
        type: 'partial',
        origin,
        items: [
          { item: expect.objectContaining({ url: 'https://cdn.example/1.mp4' }), origins: [origin] },
          { item: expect.objectContaining({ url: 'https://cdn.example/1b.mp4' }), origins: [origin] },
        ],
      },
      { type: 'done', succeeded: 1, failed: 0 },
    ]);
    expect(finishedStreams(req)?.map((s) => s.url)).toEqual(['https://cdn.example/1.mp4', 'https://cdn.example/1b.mp4']);
    expect(aggregate).not.toHaveBeenCalled();

    // An episode without its own streams goes to the stream addons as before.
    const other = streamRequest(title, { season: 1, number: 2, id: 'local:show:2' });
    expect((await streamAddons(other)).map((a) => a.key)).toEqual(['streams']);
    expect(finishedStreams(other)).toBeUndefined();
  });

  it("for a movie, are the video's under the movie's own id", async () => {
    registry.request.mockResolvedValue({
      meta: { id: 'local:film', type: 'movie', name: 'Film', videos: [{ id: 'local:film', streams: [{ url: 'https://cdn.example/film.mp4' }] }] },
    });
    const title = (await loadMeta('movie', 'local:film'))!;
    const req = streamRequest(title);
    expect((await streamAddons(req)).map((a) => a.key)).toEqual(['meta']);
    expect(finishedStreams(req)?.map((s) => s.url)).toEqual(['https://cdn.example/film.mp4']);
  });

  it("aren't offered once the addon that listed them is no longer among those in use", async () => {
    registry.request.mockResolvedValue({
      meta: { id: 'local:gone', type: 'movie', name: 'Gone', videos: [{ id: 'local:gone', streams: [{ url: 'https://cdn.example/gone.mp4' }] }] },
    });
    const title = (await loadMeta('movie', 'local:gone'))!;
    const req = streamRequest(title);
    expect(await events(loadStreams([], req, new AbortController().signal))).toEqual([{ type: 'done', succeeded: 0, failed: 0 }]);
    expect(aggregate).not.toHaveBeenCalled();
  });
});
