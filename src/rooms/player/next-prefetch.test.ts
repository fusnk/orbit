import { describe, expect, it, vi } from 'vitest';
import type { QueueItem } from '../../library/queue';
import type { UpNext } from './next-up';
import { createPrefetch, prefetchDue } from './next-prefetch';

const episode = (n: number): UpNext => ({ kind: 'episode', episode: { season: 1, episode: { id: `tt1:1:${n}`, number: n, title: `Ep ${n}` } } });
const queued: UpNext = { kind: 'queue', item: { id: 'q', title: { id: 'tt2', type: 'movie', name: 'Q', genres: [], origins: [] }, episode: null, addedAt: 0 } as QueueItem };

describe('prefetchDue', () => {
  it('is due 60% in', () => {
    expect(prefetchDue(1499, 2500)).toBe(false);
    expect(prefetchDue(1500, 2500)).toBe(true);
  });

  it('is due 3 minutes before the credits, when that comes first', () => {
    // Credits at 20:00 of a 45-minute episode: due from 17:00, well before 60% (27:00).
    expect(prefetchDue(1019, 2700, 1200)).toBe(false);
    expect(prefetchDue(1020, 2700, 1200)).toBe(true);
  });

  it('waits for a position and a length', () => {
    expect(prefetchDue(null, 2500)).toBe(false);
    expect(prefetchDue(2000, null)).toBe(false);
    expect(prefetchDue(2000, 0)).toBe(false);
  });
});

describe('createPrefetch', () => {
  const at = (timePos: number, more: Partial<Parameters<ReturnType<typeof createPrefetch>['check']>[0]> = {}) => ({ playing: 'tt1:1:1', next: episode(2), allowed: true, timePos, duration: 1000, ...more });

  it('looks the next episode up once it is due, and only once per episode', () => {
    const find = vi.fn<(next: UpNext, signal: AbortSignal) => Promise<string[]>>(async () => ['source']);
    const prefetch = createPrefetch(find);
    prefetch.check(at(500));
    expect(find).not.toHaveBeenCalled();
    prefetch.check(at(600));
    prefetch.check(at(700));
    prefetch.check(at(900));
    expect(find).toHaveBeenCalledOnce();
    expect(find.mock.calls[0]?.[0]).toEqual(episode(2));
  });

  it('hands what it found to Next Up, once', async () => {
    const prefetch = createPrefetch(async () => ['source']);
    prefetch.check(at(600));
    const taken = prefetch.take(episode(2));
    expect(await taken?.found).toEqual(['source']);
    expect(prefetch.take(episode(2))).toBeUndefined();
  });

  it('keeps the lookup when another source of the same episode starts, without asking again', () => {
    const find = vi.fn<(next: UpNext, signal: AbortSignal) => Promise<string[]>>(async () => ['source']);
    const prefetch = createPrefetch(find);
    prefetch.check(at(600));
    prefetch.newFile(true);
    prefetch.check(at(650));
    expect(find).toHaveBeenCalledOnce();
    expect(prefetch.take(episode(2))).toBeDefined();
  });

  it('cancels when another title or episode starts', () => {
    let signal: AbortSignal | undefined;
    const prefetch = createPrefetch(async (_next, s) => {
      signal = s;
      return [];
    });
    prefetch.check(at(600));
    prefetch.newFile(false);
    expect(signal?.aborted).toBe(true);
    expect(prefetch.take(episode(2))).toBeUndefined();
  });

  it('drops the lookup when what plays next changes', () => {
    let signal: AbortSignal | undefined;
    const prefetch = createPrefetch(async (_next, s) => {
      signal = s;
      return [];
    });
    prefetch.check(at(600));
    prefetch.check(at(610, { next: queued }));
    expect(signal?.aborted).toBe(true);
    expect(prefetch.take(episode(2))).toBeUndefined();
  });

  it('asks nobody for a queued item, or while nothing should play next', () => {
    const find = vi.fn<(next: UpNext, signal: AbortSignal) => Promise<string[]>>(async () => []);
    const prefetch = createPrefetch(find);
    prefetch.check(at(900, { next: queued }));
    prefetch.check(at(900, { allowed: false }));
    prefetch.check(at(900, { next: undefined }));
    expect(find).not.toHaveBeenCalled();
  });

  it('drops a lookup for something other than what is asked for', () => {
    let signal: AbortSignal | undefined;
    const prefetch = createPrefetch(async (_next, s) => {
      signal = s;
      return [];
    });
    prefetch.check(at(600));
    expect(prefetch.take(episode(3))).toBeUndefined();
    expect(signal?.aborted).toBe(true);
  });
});
