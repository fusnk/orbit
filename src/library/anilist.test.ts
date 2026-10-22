import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Title } from '../catalog/titles';
import type { Progress } from './watch';
const mock = vi.hoisted(() => ({ invoke: vi.fn(), paused: false, saved: undefined as ((title: Title) => void) | undefined, pause: undefined as (() => void) | undefined, rows: [] as Progress[], titles: [] as { title: Title }[] }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke }));
vi.mock('./history-pause', () => ({ historyPaused: () => mock.paused, onHistoryPauseChange: (listener: () => void) => { mock.pause = listener; return () => {}; } }));
vi.mock('./watch', () => ({ onWatchSaved: (listener: (title: Title) => void) => { mock.saved = listener; return () => {}; }, watchRecord: () => ({ rows: mock.rows }), watchHistory: () => ({ titles: mock.titles, progress: mock.rows }) }));
const title: Title = { id: 'kitsu:42', type: 'series', name: 'Anime', genres: [], origins: [] };
const progress = (episode: number, season = 1): Progress => ({ videoId: `ep${season}:${episode}`, titleId: title.id, season, episode, position: 100, duration: 100, watched: true, updatedAt: 1 });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

// The first import transforms the whole module graph (i18n and its locales included), which
// takes seconds on a loaded machine; do it once here so no test's own timeout pays for it.
beforeAll(() => import('./anilist'));
beforeEach(() => {
  vi.resetModules();
  mock.invoke.mockReset();
  mock.paused = false; mock.rows = []; mock.titles = [];
  mock.invoke.mockImplementation(async (command: string) => command === 'anilist_status' ? { configured: true, enabled: true, account: { id: 7, name: 'User', avatar: null } } : undefined);
});

describe('AniList sync lifecycle', () => {
  it('does not upload preexisting watched episodes on unrelated watch saves', async () => {
    mock.rows = [progress(3)]; mock.titles = [{ title }];
    const { startAniListSync } = await import('./anilist');
    await startAniListSync();
    mock.saved!(title); await flush();
    expect(mock.invoke.mock.calls.filter(([c]) => c === 'anilist_scrobble')).toEqual([]);
    mock.rows.push(progress(4)); mock.saved!(title); await flush();
    expect(mock.invoke).toHaveBeenCalledWith('anilist_scrobble', { request: { id: title.id, season: 1, episode: 4 } });
  });
  it('blocks history-paused watch saves and queued sends after a pause/resume', async () => {
    const { startAniListSync } = await import('./anilist');
    await startAniListSync();
    mock.rows = [progress(2)]; mock.saved!(title);
    mock.paused = true; mock.pause!(); mock.paused = false; mock.pause!();
    await flush();
    expect(mock.invoke.mock.calls.filter(([c]) => c === 'anilist_scrobble')).toEqual([]);
    mock.paused = true; mock.rows.push(progress(3)); mock.saved!(title); await flush();
    expect(mock.invoke.mock.calls.filter(([c]) => c === 'anilist_scrobble')).toEqual([]);
  });
  it('deduplicates repeated saves and disabled sync sends nothing', async () => {
    const { startAniListSync, setAniListEnabled } = await import('./anilist');
    await startAniListSync();
    mock.rows = [progress(2)]; mock.saved!(title); mock.saved!(title); await flush();
    expect(mock.invoke.mock.calls.filter(([c]) => c === 'anilist_scrobble')).toHaveLength(1);
    mock.invoke.mockImplementation(async (command: string) => command === 'anilist_status' ? { configured: true, enabled: false, account: { id: 7, name: 'User', avatar: null } } : undefined);
    await setAniListEnabled(false); mock.rows.push(progress(3)); mock.saved!(title); await flush();
    expect(mock.invoke.mock.calls.filter(([c]) => c === 'anilist_scrobble')).toHaveLength(1);
  });
  it('retains credential recovery information when AniList rejects an expired token', async () => {
    const { startAniListSync, anilistState } = await import('./anilist');
    mock.invoke.mockResolvedValue({ configured: true, connected: true, enabled: true, account: null, error: 'denied' });
    await startAniListSync();
    expect(anilistState()).toMatchObject({ configured: true, connected: true, account: null, error: 'denied' });
    mock.rows = [progress(2)]; mock.saved!(title); await flush();
    expect(mock.invoke.mock.calls.filter(([c]) => c === 'anilist_scrobble')).toEqual([]);
  });
  it('picks the account up again once AniList is reachable after starting offline', async () => {
    const { startAniListSync, anilistState } = await import('./anilist');
    mock.rows = [progress(1)]; mock.titles = [{ title }];
    mock.invoke.mockResolvedValue({ configured: true, connected: true, enabled: true, account: null, error: 'network' });
    await startAniListSync();
    // Back online: the next finished episode rechecks the account and is sent; what was watched before isn't.
    mock.invoke.mockImplementation(async (command: string) => command === 'anilist_status' ? { configured: true, connected: true, enabled: true, account: { id: 7, name: 'User', avatar: null } } : undefined);
    mock.rows.push(progress(2)); mock.saved!(title); await flush();
    expect(anilistState().account?.id).toBe(7);
    expect(mock.invoke.mock.calls.filter(([c]) => c === 'anilist_scrobble')).toEqual([['anilist_scrobble', { request: { id: title.id, season: 1, episode: 2 } }]]);
  });
  it('asks again when the startup check itself failed, and sends the episode that asked', async () => {
    const { startAniListSync, anilistState } = await import('./anilist');
    mock.rows = [progress(1)]; mock.titles = [{ title }];
    // The keychain or the database wasn't ready yet: the check rejects outright.
    mock.invoke.mockRejectedValue('keychain');
    await startAniListSync();
    mock.invoke.mockImplementation(async (command: string) => command === 'anilist_status' ? { configured: true, connected: true, enabled: true, account: { id: 7, name: 'User', avatar: null } } : undefined);
    mock.rows.push(progress(2)); mock.saved!(title); await flush();
    expect(anilistState().account?.id).toBe(7);
    expect(mock.invoke.mock.calls.filter(([c]) => c === 'anilist_scrobble')).toEqual([['anilist_scrobble', { request: { id: title.id, season: 1, episode: 2 } }]]);
  });
  it('rejects imported untrusted identifiers and unsafe artwork', async () => {
    const { importAniListCandidates } = await import('./anilist');
    mock.invoke.mockResolvedValue([{ id: 'local:secret', type: 'series', name: 'A' }]);
    await expect(importAniListCandidates()).rejects.toThrow();
    mock.invoke.mockResolvedValue([{ id: 'kitsu:42', type: 'series', name: 'A', poster: 'file:///secret' }]);
    await expect(importAniListCandidates()).rejects.toThrow();
  });
});