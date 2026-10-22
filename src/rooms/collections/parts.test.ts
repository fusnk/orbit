import { describe, expect, it, vi } from 'vitest';
import type { Title } from '../../catalog/titles';
import type { QueueItem } from '../../library/queue';

let queue: readonly QueueItem[] = [];
const toasts: string[] = [];
vi.mock('../../library/queue', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../library/queue')>();
  return {
    ...real,
    loadQueue: async () => {},
    queueItems: () => queue,
    enqueue: async (title: Title, _episode: null, where: 'next' | 'end') => {
      const next = real.placed(queue, { id: title.id, title, episode: null, addedAt: 0 } as QueueItem, where);
      queue = next.items;
      return next.result;
    },
  };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../catalog/service', () => ({ usableAddons: async () => [] }));
vi.mock('../../catalog/tmdb', () => ({ tmdbConnected: async () => false }));
vi.mock('../../components/cards', () => ({ artImage: () => null }));
vi.mock('../../components/toast', () => ({ toast: (text: string) => void toasts.push(text) }));
vi.mock('../../library/watch', () => ({ isWatched: () => false }));
vi.mock('../detail/streams', () => ({ playTitle: vi.fn(async () => {}) }));
vi.mock('../settings', () => ({ openSettingsTo: () => {} }));

const { QUEUE_LIMIT } = await import('../../library/queue');
const { playInOrder } = await import('./parts');
const { playTitle } = await import('../detail/streams');

const film = (n: number): Title => ({ id: `tt${n}`, type: 'movie', name: `Part ${n}`, genres: [], origins: [] });

describe('Play in order with a nearly full queue', () => {
  it('queues the parts right after the first, never skipping one, and says the queue is full', async () => {
    queue = Array.from({ length: QUEUE_LIMIT - 2 }, (_, i) => ({ id: `q${i}`, title: film(1000 + i), episode: null, addedAt: 0 }) as QueueItem);
    await playInOrder([1, 2, 3, 4, 5].map(film), {} as never);
    expect(vi.mocked(playTitle).mock.calls[0]![0].id).toBe('tt1');
    expect(queue.slice(0, 2).map((item) => item.title.id)).toEqual(['tt2', 'tt3']);
    expect(toasts).toHaveLength(1);
  });
});
