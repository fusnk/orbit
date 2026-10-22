import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));
vi.mock('../../components/toast', () => ({ toast: vi.fn() }));
vi.mock('./failed-sources', () => ({ failedRecently: () => () => false, loadFailures: async () => {}, markFailed: vi.fn(), markPlayed: vi.fn(), whereKey: (a: string, b = '') => `${a}/${b}` }));
vi.stubGlobal('window', globalThis);

import type { Title } from '../../catalog/titles';
import { createFailover, createPlace } from './failover';
import type { PlayRequest } from './index';
import type { PlayableSource } from './panels';

const source = (id: string, addon: string, url: string): PlayableSource => ({ id, addon, url, label: '1080p', meta: '' }) as PlayableSource;
const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };

/** The player as index.ts wires it: a switch asks for the next file from the place handed over. */
function player() {
  const a = source('n1', 'A', 'https://a/1');
  const b = source('n2', 'B', 'magnet:?xt=urn:btih:abc');
  const c = source('n3', 'C', 'https://c/1');
  const request = { title: movie, source: a, sources: [a, b, c] } as unknown as PlayRequest;
  const place = createPlace();
  const switchTo = vi.fn((next: PlayableSource, at: number | undefined) => {
    request.source = next;
    failover.opening();
    place.asked(at ?? 0);
  });
  const failover = createFailover({ enabled: () => true, request: () => request, position: () => place.at(), switchTo });
  return { failover, place, switchTo };
}

describe('where the next source picks up', () => {
  it('is where the failed one was asked to start, though it failed before reaching the player (a torrent with no peers)', () => {
    const { failover, place, switchTo } = player();
    failover.opening();
    place.asked(undefined);
    place.played(2400);
    // A stalls 40 minutes in: B, a torrent, is asked for from there.
    expect(failover.recover('stalled')).toBe(true);
    expect(switchTo).toHaveBeenLastCalledWith(expect.objectContaining({ addon: 'B' }), 2400);
    // B's torrent finds no peers: C carries on from 40:00, not from where A started.
    expect(failover.recover('failed')).toBe(true);
    expect(switchTo).toHaveBeenLastCalledWith(expect.objectContaining({ addon: 'C' }), 2400);
    failover.stop();
  });

  it('keeps the last position mpv reported when the file then reports none (it ended with an error)', () => {
    const { failover, place, switchTo } = player();
    failover.opening();
    place.asked(undefined);
    place.played(1800);
    place.played(null);
    expect(place.at()).toBe(1800);
    expect(failover.recover('failed')).toBe(true);
    expect(switchTo).toHaveBeenLastCalledWith(expect.objectContaining({ addon: 'B' }), 1800);
    failover.stop();
  });

  it('starts again from each file asked for', () => {
    const place = createPlace();
    place.played(600);
    place.asked(undefined);
    expect(place.at()).toBeUndefined();
    place.asked(90);
    expect(place.at()).toBe(90);
  });
});
