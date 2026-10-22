import { describe, expect, it, vi } from 'vitest';

let watched: string[] = [];
let saved: ((title: unknown) => void) | undefined;
const removeDownload = vi.fn(async () => undefined);
let releaseQueue: () => void = () => undefined;
const queueBest = vi.fn(() => new Promise((resolve) => (releaseQueue = () => resolve({ kind: 'queued' }))));

vi.stubGlobal('navigator', { onLine: true });
vi.mock('../../catalog/service', () => ({ loadMeta: vi.fn() }));
vi.mock('../../components/toast', () => ({ toast: vi.fn() }));
vi.mock('../../i18n', () => ({ t: (k: string) => k, tn: (k: string) => k, locale: () => 'en' }));
vi.mock('../../lib/ipc', () => ({ settings: { get: vi.fn(async () => 2), set: vi.fn(async () => undefined) } }));
vi.mock('../../library/profiles', () => ({ profileSetting: vi.fn(async () => ({ key: 'k', value: { tt1: { deleteWatched: true } } })) }));
vi.mock('../../library/downloads', () => ({
  allDownloads: () => [
    { id: 'd1', titleId: 'tt1', videoId: 'tt1:1:1', season: 1, state: 'done' },
    { id: 'd2', titleId: 'tt1', videoId: 'tt1:1:2', season: 1, state: 'done' },
  ],
  downloadOf: (v: string) => (v === 'tt1:1:1' || v === 'tt1:1:2' ? { state: 'done' } : undefined),
  failureText: () => '',
  removeDownload,
  storage: async () => ({ folder: 'D:/x' }),
}));
vi.mock('../../library/watch', () => ({
  onWatchSaved: (fn: (title: unknown) => void) => (saved = fn),
  watchRecord: () => ({ rows: watched.map((videoId) => ({ videoId, watched: true })) }),
}));
vi.mock('../player', () => ({ playerOpen: () => false }));
vi.mock('./actions', () => ({ queueBest }));

const { startAutoDownloads } = await import('./auto');

const show = {
  id: 'tt1',
  type: 'series',
  name: 'Show',
  genres: [],
  origins: [],
  seasons: [{ number: 1, episodes: [1, 2, 3, 4, 5].map((n) => ({ id: `tt1:1:${n}`, number: n, title: `E${n}` })) }],
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('keep next episodes downloaded', () => {
  it('an episode watched while the previous one is still being queued is never deleted', async () => {
    await startAutoDownloads();
    watched = ['tt1:1:1'];
    saved!(show);
    await flush();
    expect(removeDownload).toHaveBeenCalledWith('d1');
    expect(queueBest).toHaveBeenCalled(); // still finding a source for E3

    watched = ['tt1:1:1', 'tt1:1:2'];
    saved!(show); // E2 finished meanwhile
    await flush();
    releaseQueue();
    await flush();
    await flush();
    expect(removeDownload).toHaveBeenCalledWith('d2');
  });
});
