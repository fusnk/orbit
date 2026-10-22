import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));

import { invoke } from '@tauri-apps/api/core';
import type { Title } from '../catalog/titles';
import { historyPaused, loadHistoryPause, setHistoryPaused } from './history-pause';
import { createOwnServerReporter } from './own-servers';
import { continueWatching, loadWatch, onWatchSaved, recordProgress, resumePosition } from './watch';

const mocked = vi.mocked(invoke);
const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };
let saved: Record<string, unknown>;

beforeEach(async () => {
  saved = {};
  mocked.mockReset();
  mocked.mockImplementation(async (cmd, args) => {
    const a = args as { key: string; value: unknown } | undefined;
    if (cmd === 'watch_list') return { titles: [], progress: [] };
    if (cmd === 'profile_active') return 'p1';
    if (cmd === 'settings_get') return saved[a!.key] ?? null;
    if (cmd === 'settings_set') saved[a!.key] = a!.value;
    return undefined;
  });
  await loadWatch();
  await setHistoryPaused(false);
});

describe('pause watch history', () => {
  it('records nothing from playback while paused, and nothing is announced to sync', async () => {
    const announced = vi.fn();
    const stop = onWatchSaved(announced);
    await setHistoryPaused(true);
    recordProgress(movie, undefined, 1800, 6000);
    expect(resumePosition(movie)).toBe(0);
    expect(continueWatching()).toEqual([]);
    expect(announced).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocked).not.toHaveBeenCalledWith('watch_put_progress', expect.anything());

    await setHistoryPaused(false);
    recordProgress(movie, undefined, 1800, 6000);
    expect(resumePosition(movie)).toBe(1800);
    expect(announced).toHaveBeenCalledTimes(1);
    stop();
  });

  it('tells no media server about playback while paused', async () => {
    const server = { status: vi.fn(), stop: vi.fn(), newFile: vi.fn() };
    const reporter = createOwnServerReporter([server] as unknown as Parameters<typeof createOwnServerReporter>[0]);
    await setHistoryPaused(true);
    reporter.status('orbit-plex://1/2', 10, false, 100);
    reporter.stop();
    expect(server.status).not.toHaveBeenCalled();
    expect(server.stop).not.toHaveBeenCalled();
    await setHistoryPaused(false);
    reporter.status('orbit-plex://1/2', 10, false, 100);
    expect(server.status).toHaveBeenCalledTimes(1);
  });

  it('is kept per profile and read back at startup', async () => {
    await loadHistoryPause();
    await setHistoryPaused(true);
    expect(saved['history.paused.p1']).toBe(true);
    await loadHistoryPause();
    expect(historyPaused()).toBe(true);
  });

  it('goes back to how it was when saving fails', async () => {
    mocked.mockImplementation(async (cmd) => {
      if (cmd === 'settings_set') throw new Error('disk full');
      return null;
    });
    await expect(setHistoryPaused(true)).rejects.toThrow('disk full');
    expect(historyPaused()).toBe(false);
  });
});
