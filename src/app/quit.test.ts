import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listeners = new Map<string, () => void>();
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: () => void) => {
    listeners.set(event, handler);
    return () => {};
  }),
}));
vi.mock('../library/watch', () => ({
  watchWritesSettled: vi.fn(async () => {}),
}));
vi.mock('../library/stremio-sync', () => ({
  flushStremioSync: vi.fn(async () => {}),
}));

import { invoke } from '@tauri-apps/api/core';
import { flushStremioSync } from '../library/stremio-sync';
import { watchWritesSettled } from '../library/watch';

const flush = vi.mocked(flushStremioSync);
const writes = vi.mocked(watchWritesSettled);

async function fresh() {
  vi.resetModules();
  return import('./quit');
}

beforeEach(() => {
  listeners.clear();
  vi.mocked(invoke).mockClear();
  flush.mockReset().mockResolvedValue();
  writes.mockReset().mockResolvedValue();
  vi.stubGlobal('window', new EventTarget());
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('quitting', () => {
  it('tells the player first, then waits for watch history and Stremio', async () => {
    const quit = await fresh();
    const order: string[] = [];
    window.addEventListener(quit.QUITTING, () => order.push('player'));
    writes.mockImplementation(async () => void order.push('history'));
    flush.mockImplementation(async () => void order.push('stremio'));
    await quit.beforeQuit();
    expect(order).toEqual(['player', 'history', 'stremio']);
  });

  it('answers Rust once everything is saved', async () => {
    const quit = await fresh();
    quit.installQuit();
    await Promise.resolve();
    let sent!: () => void;
    flush.mockImplementation(() => new Promise<void>((resolve) => (sent = resolve)));
    listeners.get('app://quitting')?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(invoke).not.toHaveBeenCalledWith('quit_ready');
    sent();
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledWith('quit_ready');
  });

  it('a Stremio that never answers holds Orbit up for a few seconds at most', async () => {
    const quit = await fresh();
    quit.installQuit();
    await Promise.resolve();
    flush.mockImplementation(() => new Promise<void>(() => {}));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    listeners.get('app://quitting')?.();
    await vi.advanceTimersByTimeAsync(2600);
    expect(invoke).toHaveBeenCalledWith('quit_ready');
  });

  it('saves once however often it’s asked, and again after an update that didn’t install', async () => {
    const quit = await fresh();
    const player = vi.fn();
    window.addEventListener(quit.QUITTING, player);
    await Promise.all([quit.beforeQuit(), quit.beforeQuit()]);
    expect(player).toHaveBeenCalledTimes(1);
    quit.quitCancelled();
    await quit.beforeQuit();
    expect(player).toHaveBeenCalledTimes(2);
  });
});
