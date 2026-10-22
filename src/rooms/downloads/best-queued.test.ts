import { beforeEach, expect, it, vi } from 'vitest';

type Item = { state: string; doneBytes: number; error: { kind: string } | null };
let item: Item | undefined;
const changeListeners = new Set<() => void>();
const invoke = vi.fn(async () => {
  item = { state: 'queued', doneBytes: 0, error: null };
});
const change = (next: Partial<Item>) => {
  item = { ...item!, ...next };
  for (const listener of [...changeListeners]) listener();
};

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('../../catalog/service', () => ({ loadMeta: vi.fn(), loadSubtitles: vi.fn(), streamRequest: () => ({ id: 'tt1:1:3' }) }));
vi.mock('../../components/toast', () => ({ toast: vi.fn() }));
vi.mock('../../i18n', () => ({ t: (k: string) => k }));
vi.mock('../../lib/ipc', () => ({ settings: { get: vi.fn(async () => '') } }));
vi.mock('../../library/downloads', () => ({
  blockReason: () => '',
  downloadBlock: () => null,
  downloadCandidates: (ranked: unknown[]) => ranked,
  downloadedSource: vi.fn(),
  downloadOf: () => item,
  episodeOf: vi.fn(),
  failureText: () => '',
  isWrongContent: (error: { kind: string } | null) => error?.kind === 'too-small',
  loadDownloads: async () => undefined,
  onDownloadsChange: (listener: () => void) => {
    changeListeners.add(listener);
    return () => changeListeners.delete(listener);
  },
  onDownloadProgress: () => () => undefined,
  parseMaxQuality: () => null,
  QUALITY_KEY: 'q',
  streamIdentity: async () => null,
}));
vi.mock('../../library/snapshot', () => ({ snapshot: (title: unknown) => title }));
vi.mock('../detail/page-left', () => ({ pageLeft: () => () => false }));
vi.mock('../detail/ranking-prefs', () => ({ torrentMode: () => 'off' }));
const source = (n: number) => ({ stream: { url: `https://cdn.example/${n}` }, traits: {}, addon: 'a', addonKey: 'a' });
vi.mock('../detail/streams', () => ({ openStreams: vi.fn(), rankedSources: async () => [source(1), source(2)], subtitlesOf: () => [] }));
vi.mock('../player', () => ({ openPlayer: vi.fn() }));
vi.mock('../player/preferred-language', () => ({ LANGUAGE_SETTINGS: { subtitle: 's' }, mpvLanguages: () => '', parseLanguages: () => [] }));

const { downloadBest, queueBest } = await import('./actions');

const show = { id: 'tt1', type: 'series', name: 'Show', genres: [], origins: [] };
const episode = { season: 1, episode: { id: 'tt1:1:3', number: 3, title: 'E3' } };

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockClear();
  changeListeners.clear();
});

// "Download season": episode 3 waits its turn behind two others for minutes, then its source sends a placeholder.
it('tries the next source when a download that waited its turn turns out to be a placeholder', async () => {
  expect(await queueBest(show as never, episode as never)).toEqual({ kind: 'queued' });
  expect(invoke).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  change({ state: 'running' });
  change({ state: 'failed', error: { kind: 'too-small' } });
  await vi.advanceTimersByTimeAsync(0);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it('takes a download as real once it has run past the window', async () => {
  await queueBest(show as never, episode as never);
  change({ state: 'running' });
  await vi.advanceTimersByTimeAsync(91_000);
  change({ state: 'failed', error: { kind: 'too-small' } });
  await vi.advanceTimersByTimeAsync(0);
  expect(invoke).toHaveBeenCalledTimes(1);
});

// The first press's download waits its turn: a press on another title meanwhile still looks for a source.
it('lets "Best source" be pressed again while a download it started waits its turn', async () => {
  void downloadBest(show as never, episode as never);
  await vi.advanceTimersByTimeAsync(0);
  expect(invoke).toHaveBeenCalledTimes(1);
  void downloadBest({ ...show, id: 'tt2', type: 'movie' } as never);
  await vi.advanceTimersByTimeAsync(0);
  expect(invoke).toHaveBeenCalledTimes(2);
});
