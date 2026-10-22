import { describe, expect, it, vi } from 'vitest';

const listeners = new Map<string, (event: { payload: unknown }) => void>();
const invoked: [string, unknown][] = [];
vi.mock('@tauri-apps/api/core', () => ({ invoke: async (cmd: string, args: unknown) => void invoked.push([cmd, args]) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async (name: string, fn: (event: { payload: unknown }) => void) => void listeners.set(name, fn) }));
const pending = new Map<string, (titles: unknown[]) => void>();
vi.mock('../catalog/service', () => ({
  usableAddons: async () => [],
  loadCatalog: (_ref: unknown, extra: [string, string][]) => new Promise((resolve) => pending.set(extra[0]![1], resolve)),
}));
vi.mock('../catalog/search', () => ({ searchableCatalogs: () => ['one'], mergeResults: (lists: unknown[][]) => lists.flat(), rankResults: (titles: unknown[]) => titles }));
vi.mock('../catalog/parental', () => ({ allowedTitles: async (titles: unknown[]) => titles, verdictFor: async () => 'allowed' }));
const play = vi.fn();
const openDetail = vi.fn();
vi.mock('../rooms/detail/open', () => ({ titleHandlers: () => ({ play, openDetail }) }));
vi.mock('./remote-status', () => ({ remoteStatus: async () => ({ running: false }), startRemote: async () => {}, remoteChanged: () => {} }));
vi.mock('./remote-player', () => ({ remotePlayer: () => null, tellNowPlaying: () => {} }));
vi.mock('./remote-picker', () => ({ runPicker: async () => {} }));
vi.mock('../components/toast', () => ({ toast: () => {} }));
vi.mock('../i18n', () => ({ t: (k: string) => k }));
vi.mock('./gamepad', () => ({ pressKey: () => {} }));
vi.mock('./errors', () => ({ reportError: () => {} }));

const flush = () => new Promise((r) => setTimeout(r, 0));
// The bridge remembers the newest search it saw, so each test starts a fresh one: no test leans on another's ids.
async function bridge() {
  invoked.length = 0;
  pending.clear();
  play.mockClear();
  vi.resetModules();
  const { startRemoteBridge } = await import('./remote');
  startRemoteBridge({} as never);
  await flush();
  return listeners.get('remote://command')!;
}

describe('phone remote, two searches finishing out of order', () => {
  it('opening a result of the newer search works after the older one finishes last', async () => {
    const send = await bridge();
    send({ payload: { kind: 'search', id: 1, query: 'matrix' } });
    await flush();
    send({ payload: { kind: 'search', id: 2, query: 'dune' } });
    await flush();
    pending.get('dune')!([{ id: 'tt-dune', name: 'Dune', type: 'movie' }]);
    await flush();
    // The older, slower search answers last (Rust ignores its results: the phone shows Dune).
    pending.get('matrix')!([{ id: 'tt-matrix', name: 'The Matrix', type: 'movie' }]);
    await flush();
    // The phone taps Play on its first result (Dune), from search 2.
    send({ payload: { kind: 'open', search: 2, index: 0, play: true } });
    await flush();
    await flush();
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ id: 'tt-dune' }));
    // The stale results aren't sent on either.
    expect(invoked.filter(([cmd]) => cmd === 'remote_search_results').map(([, args]) => (args as { id: number }).id)).toEqual([2]);
  });
});

describe('phone remote, searches in order', () => {
  it('in order, the newer search opens', async () => {
    const send = await bridge();
    send({ payload: { kind: 'search', id: 3, query: 'alien' } });
    await flush();
    pending.get('alien')!([{ id: 'tt-alien', name: 'Alien', type: 'movie' }]);
    await flush();
    send({ payload: { kind: 'open', search: 3, index: 0, play: true } });
    await flush();
    await flush();
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ id: 'tt-alien' }));
  });
});
