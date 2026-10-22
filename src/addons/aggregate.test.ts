import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { aggregate } from './aggregate';
import { CatalogResponseSchema, ManifestSchema, parseWith } from './schema';
import type { AggregateEvent, InstalledAddon, MetaPreview } from './types';

function addon(key: string, name: string): InstalledAddon {
  return {
    key,
    manifest: parseWith(ManifestSchema, {
      id: key,
      version: '1.0.0',
      name,
      types: ['movie'],
      resources: ['catalog'],
      catalogs: [{ type: 'movie', id: 'top' }],
    }),
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

const metas = (...ids: string[]) => JSON.stringify({ metas: ids.map((id) => ({ id, type: 'movie', name: id.toUpperCase() })) });
const req = { resource: 'catalog', type: 'movie', id: 'top' } as const;
const parse = (json: unknown) => parseWith(CatalogResponseSchema, json).metas;
const keyOf = (m: MetaPreview) => `${m.type}:${m.id}`;

async function collect(addons: InstalledAddon[], signal = new AbortController().signal) {
  const events: AggregateEvent<MetaPreview>[] = [];
  for await (const event of aggregate(addons, req, parse, keyOf, signal)) events.push(event);
  return events;
}

/** Resolves each addon's response when `release(key)` is called. */
function controlledResponses(bodies: Record<string, string | Error>) {
  const releases = new Map<string, () => void>();
  invoke.mockImplementation((_cmd: string, args: { key: string }) => {
    return new Promise((resolve, reject) => {
      releases.set(args.key, () => {
        const body = bodies[args.key];
        if (body instanceof Error) reject(body);
        else resolve(body);
      });
    });
  });
  return (key: string) => releases.get(key)?.();
}

beforeEach(() => {
  invoke.mockReset();
});

describe('aggregate', () => {
  it('yields partial results as addons respond, deduped in addon order', async () => {
    const release = controlledResponses({ a: metas('x', 'y'), b: metas('y', 'z') });
    const addons = [addon('a', 'First'), addon('b', 'Second')];
    const events: AggregateEvent<MetaPreview>[] = [];
    const run = (async () => {
      for await (const e of aggregate(addons, req, parse, keyOf, new AbortController().signal)) events.push(e);
    })();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    release('b'); // the second addon answers first
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ type: 'partial', origin: { key: 'b' } });

    release('a');
    await run;
    const final = events[1];
    if (final?.type !== 'partial') throw new Error('expected a partial event');
    expect(final.items.map((s) => s.item.id)).toEqual(['x', 'y', 'z']);
    expect(final.items[1]?.origins.map((o) => o.name)).toEqual(['First', 'Second']);
    expect(events[2]).toEqual({ type: 'done', succeeded: 2, failed: 0 });
  });

  it('reports failures per addon without dropping other results', async () => {
    invoke.mockImplementation((_cmd: string, args: { key: string }) =>
      args.key === 'bad' ? Promise.reject({ kind: 'timeout' }) : Promise.resolve(metas('x')),
    );
    const events = await collect([addon('ok', 'Ok'), addon('bad', 'Bad')]);
    expect(events).toContainEqual({ type: 'error', origin: { key: 'bad', name: 'Bad' }, error: { kind: 'timeout' } });
    expect(events.at(-1)).toEqual({ type: 'done', succeeded: 1, failed: 1 });
  });

  it('treats a schema failure as that addon failing', async () => {
    invoke.mockResolvedValue(JSON.stringify({ nope: true }));
    const events = await collect([addon('a', 'A')]);
    expect(events[0]).toMatchObject({ type: 'error', error: { kind: 'invalid-response' } });
  });

  it('only queries eligible addons', async () => {
    invoke.mockResolvedValue(metas('x'));
    await collect([addon('a', 'A'), { ...addon('b', 'B'), enabled: false }]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('addon_request', { key: 'a', path: '/catalog/movie/top.json' });
  });

  it('stops yielding once aborted', async () => {
    invoke.mockResolvedValue(metas('x'));
    const controller = new AbortController();
    controller.abort();
    expect(await collect([addon('a', 'A')], controller.signal)).toEqual([]);
  });
});
