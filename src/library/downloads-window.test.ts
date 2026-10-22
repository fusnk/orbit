import { describe, expect, it, vi } from 'vitest';

let emit: (payload: unknown) => void = () => undefined;
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: unknown }) => void) => {
    emit = (payload) => handler({ payload });
    return () => undefined;
  }),
}));
vi.mock('../catalog/service', () => ({ usableAddons: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { allDownloads, applyDownloadSchedule, downloadNow, loadDownloads, waitingForWindow } from './downloads';

const row = {
  id: 'd1',
  titleId: 'tt1',
  videoId: 'tt1',
  title: { meta: { id: 'tt1', type: 'movie', name: 'Film' } },
  season: null,
  episode: null,
  episodeTitle: null,
  label: '1080p',
  addonKey: 'a',
  streamType: 'movie',
  streamId: 'tt1',
  identity: 'x',
  torrent: false,
  state: 'queued',
  error: null,
  doneBytes: 0,
  totalBytes: null,
  createdAt: 1,
  finishedAt: null,
};

describe('downloads started outside the download window', () => {
  it('wait for the window again once Rust has stopped running them anyway', async () => {
    vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'download_list') return [row];
      // Settings → Downloads → "Only download between" 1:00 and 7:00, closed now.
      if (command === 'settings_get') return (args as { key: string }).key === 'downloads.window' ? { start: 1, end: 7 } : null;
      if (command === 'download_schedule_set') return false;
      return undefined;
    });
    await loadDownloads();
    await applyDownloadSchedule();
    const item = () => allDownloads()[0]!;
    expect(waitingForWindow(item())).toEqual({ start: 1, end: 7 });

    // "Download now anyway": it runs, then fails (Rust forgets it was started anyway, see `run`).
    await downloadNow('d1');
    emit({ kind: 'state', id: 'd1', state: 'running', error: null });
    expect(waitingForWindow(item())).toBeNull();
    emit({ kind: 'state', id: 'd1', state: 'failed', error: { kind: 'network' } });

    // Tried again while the window is closed: Rust waits for the window, and so does the page
    // (with its "Download now anyway" button), rather than showing it queued to start any moment.
    emit({ kind: 'state', id: 'd1', state: 'queued', error: null });
    expect(waitingForWindow(item())).toEqual({ start: 1, end: 7 });
  });
});
