import { beforeEach, describe, expect, it, vi } from 'vitest';

const saved = new Map<string, unknown>();
let failSaves = false;
vi.mock('../lib/ipc', () => ({
  settings: {
    get: async (key: string) => saved.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      if (failSaves) throw new Error('disk full');
      saved.set(key, value);
    },
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => 'main' }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));

import type { Title } from '../catalog/titles';
import type * as Queue from './queue';

const KEY = 'library.queue.main';
const movie = (id: string, name = id): Title => ({ id, type: 'movie', name, poster: 'https://img.example/p.jpg', description: 'A long story', genres: ['Drama', 'Crime', 'Thriller', 'Mystery'], origins: [{ key: 'a', name: 'A' }] });
const show: Title = { id: 'tt9', type: 'series', name: 'Show', genres: [], origins: [] };
const ep = (number: number) => ({ season: 1, number, videoId: `tt9:1:${number}`, name: `Episode ${number}` });

let q: typeof Queue;

beforeEach(async () => {
  saved.clear();
  failSaves = false;
  // A fresh module each time: the queue is read once per window.
  vi.resetModules();
  q = await import('./queue');
});

const names = () => q.queueItems().map((i) => (i.episode ? `${i.title.name} ${i.episode.number}` : i.title.name));

describe('adding', () => {
  it('appends with Add to queue and puts Play next first', async () => {
    expect(await q.enqueue(movie('tt1', 'One'), null, 'end')).toBe('added');
    expect(await q.enqueue(movie('tt2', 'Two'), null, 'end')).toBe('added');
    expect(await q.enqueue(movie('tt3', 'Three'), null, 'next')).toBe('added');
    expect(names()).toEqual(['Three', 'One', 'Two']);
    expect(q.queueHead()?.title.name).toBe('Three');
  });

  it('keeps one of each movie or episode; Play next moves a queued one to the front', async () => {
    await q.enqueue(movie('tt1', 'One'), null, 'end');
    await q.enqueue(show, ep(1), 'end');
    await q.enqueue(show, ep(2), 'end');
    expect(await q.enqueue(movie('tt1', 'One'), null, 'end')).toBe('exists');
    expect(await q.enqueue(show, ep(2), 'next')).toBe('moved');
    expect(await q.enqueue(show, ep(2), 'next')).toBe('exists');
    expect(names()).toEqual(['Show 2', 'One', 'Show 1']);
    expect(q.titleQueued('tt9')).toBe(true);
    expect(q.episodeQueued('tt9', 'tt9:1:2')).toBe(true);
    expect(q.episodeQueued('tt9', 'tt9:1:3')).toBe(false);
  });

  it(`stops at ${100} items`, async () => {
    for (let i = 0; i < q.QUEUE_LIMIT; i++) await q.enqueue(movie(`tt${i}`), null, 'end');
    expect(await q.enqueue(movie('one-more'), null, 'next')).toBe('full');
    expect(q.queueItems()).toHaveLength(q.QUEUE_LIMIT);
    // Moving a queued one still works when full.
    expect(await q.enqueue(movie('tt50'), null, 'next')).toBe('moved');
  });

  it('saves a lean snapshot per profile, without sources', async () => {
    await q.enqueue(movie('tt1', 'One'), null, 'end');
    const stored = saved.get(KEY) as { title: { meta: Record<string, unknown> } }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.title.meta).toMatchObject({ id: 'tt1', name: 'One', genres: ['Drama', 'Crime', 'Thriller'] });
    expect(stored[0]!.title.meta.description).toBeUndefined();
    expect(JSON.stringify(stored)).not.toMatch(/url|stream|source/i);
  });
});

describe('changing', () => {
  beforeEach(async () => {
    for (const name of ['A', 'B', 'C']) await q.enqueue(movie(name, name), null, 'end');
  });
  const id = (name: string) => q.queueItems().find((i) => i.title.name === name)!.id;

  it('moves items earlier and later, and not past either end', async () => {
    await q.moveQueued(id('C'), -1);
    expect(names()).toEqual(['A', 'C', 'B']);
    await q.moveQueued(id('A'), -1);
    await q.moveQueued(id('B'), 1);
    expect(names()).toEqual(['A', 'C', 'B']);
    await q.moveQueued(id('A'), 1);
    expect(names()).toEqual(['C', 'A', 'B']);
  });

  it('removes one item, a whole title, or everything', async () => {
    await q.dequeue(id('B'));
    expect(names()).toEqual(['A', 'C']);
    await q.dequeueTitle('A');
    expect(names()).toEqual(['C']);
    await q.clearQueue();
    expect(q.queueItems()).toEqual([]);
    expect(saved.get(KEY)).toEqual([]);
  });

  it('tells listeners about changes', async () => {
    const listener = vi.fn();
    const stop = q.onQueueChange(listener);
    await q.dequeue(id('A'));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    await q.dequeue(id('B'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('undoes a change that fails to save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failSaves = true;
    await q.dequeue(id('A'));
    expect(names()).toEqual(['A', 'B', 'C']);
  });
});

describe('playing', () => {
  it('takes a movie or episode out once it starts, however it was started', async () => {
    await q.enqueue(movie('tt1', 'One'), null, 'end');
    await q.enqueue(show, ep(1), 'end');
    await q.enqueue(show, ep(2), 'end');
    await q.markStarted('tt9', 'tt9:1:2');
    expect(names()).toEqual(['One', 'Show 1']);
    // Another episode of a queued show, or the show without an episode, leaves the rest alone.
    await q.markStarted('tt9', 'tt9:1:5');
    await q.markStarted('tt9', undefined);
    expect(names()).toEqual(['One', 'Show 1']);
    await q.markStarted('tt1', undefined);
    expect(names()).toEqual(['Show 1']);
  });
});

describe('reading what was saved', () => {
  const item = (id: string, titleId: string, episode: unknown = null) => ({ id, title: { meta: { id: titleId, type: 'movie', name: titleId } }, episode, addedAt: 1 });

  it('keeps valid items in order, once each', async () => {
    saved.set(KEY, [item('a1', 'tt1'), item('a2', 'tt2'), item('a3', 'tt1'), item('a1', 'tt3')]);
    await q.loadQueue();
    expect(q.queueItems().map((i) => i.id)).toEqual(['a1', 'a2']);
  });

  it('drops anything that does not validate, and survives junk', async () => {
    saved.set(KEY, [
      item('ok', 'tt1'),
      item('Bad Id!', 'tt2'),
      { ...item('b2', 'tt3'), title: { meta: { id: 'tt3', type: 'movie', name: 'x', poster: 'http://insecure.example/p.jpg' } } },
      { ...item('b6', 'tt7'), title: { meta: { id: 'tt7', type: 'movie' } } },
      item('b3', 'tt4', { season: -1, number: 1, videoId: 'v', name: 'x' }),
      item('b4', 'tt5', { season: 1, number: 1, videoId: '', name: 'x' }),
      { ...item('b5', 'tt6'), addedAt: Number.NaN },
      'nope',
      null,
    ]);
    await q.loadQueue();
    // An insecure poster is dropped, as anywhere an addon's data is read; the item stays.
    expect(q.queueItems().map((i) => [i.id, i.title.poster])).toEqual([
      ['ok', undefined],
      ['b2', undefined],
    ]);
    for (const junk of [null, 'queue', 42, { items: [] }]) expect(q.parseQueue(junk)).toEqual([]);
  });

  it(`reads at most ${100} items`, () => {
    const many = Array.from({ length: 300 }, (_, i) => item(`i${i}`, `tt${i}`));
    expect(q.parseQueue(many)).toHaveLength(q.QUEUE_LIMIT);
  });

  it('reads back what it saved', async () => {
    await q.enqueue(show, ep(3), 'end');
    await q.enqueue(movie('tt1', 'One'), null, 'end');
    const back = q.parseQueue(saved.get(KEY));
    expect(back.map((i) => [i.title.id, i.episode?.videoId ?? null, i.episode?.name ?? null])).toEqual([
      ['tt9', 'tt9:1:3', 'Episode 3'],
      ['tt1', null, null],
    ]);
  });
});
