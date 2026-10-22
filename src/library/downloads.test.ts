import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

vi.mock('../catalog/service', () => ({ usableAddons: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import * as registry from '../addons/registry';
import type { UsableAddon } from '../addons/types';
import { usableAddons } from '../catalog/service';
import { allDownloads, downloadBlock, downloadsLoadError, failureText, formatBytes, fraction, loadDownloads, parseMaxQuality, pickForDownload, refreshLink, resumeAfterReconnect, secondsLeft, streamIdentity, type DownloadItem } from './downloads';

const source = (url: string, resolution?: '2160p' | '1080p' | '720p' | '480p') => ({ stream: { url }, traits: { resolution } });

describe('downloads', () => {
  it('remembers a failed read, so Downloads can tell it apart from none, until a read works', async () => {
    vi.mocked(invoke).mockRejectedValueOnce({ kind: 'storage' });
    await expect(loadDownloads()).rejects.toEqual({ kind: 'storage' });
    expect(downloadsLoadError()).toEqual({ kind: 'storage' });
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await loadDownloads();
    expect(downloadsLoadError()).toBeNull();
  });

  it('blocks playlists and live streams, not files or torrents', () => {
    expect(downloadBlock({ url: 'https://debrid.example/dl/Film.2020.mkv' }, 'movie')).toBeNull();
    expect(downloadBlock({ url: 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10' }, 'series')).toBeNull();
    expect(downloadBlock({ url: 'https://cdn.example/hls/index.m3u8?token=x' }, 'movie')).toBe('playlist');
    expect(downloadBlock({ url: 'https://cdn.example/dash/manifest.MPD' }, 'movie')).toBe('playlist');
    expect(downloadBlock({ url: 'https://cdn.example/film.mkv' }, 'tv')).toBe('live');
    expect(downloadBlock({ url: 'not a url' }, 'movie')).toBe('playlist');
  });

  it('picks the best downloadable source within the quality cap', () => {
    const ranked = [source('https://x/a.m3u8', '1080p'), source('https://x/4k.mkv', '2160p'), source('https://x/hd.mkv', '1080p'), source('https://x/sd.mkv', '720p')];
    expect(pickForDownload(ranked, 'original', 'movie')?.stream.url).toBe('https://x/4k.mkv');
    expect(pickForDownload(ranked, '1080p', 'movie')?.stream.url).toBe('https://x/hd.mkv');
    expect(pickForDownload(ranked, '720p', 'movie')?.stream.url).toBe('https://x/sd.mkv');
    // Unknown quality isn't held back by the cap.
    expect(pickForDownload([source('https://x/unknown.mkv')], '720p', 'movie')?.stream.url).toBe('https://x/unknown.mkv');
    expect(pickForDownload([source('https://x/a.m3u8')], 'original', 'movie')).toBeUndefined();
    expect(parseMaxQuality('1080p')).toBe('1080p');
    expect(parseMaxQuality('8k')).toBe('original');
  });

  it('identifies streams without their address', async () => {
    const torrent = await streamIdentity({ url: 'magnet:?xt=urn:btih:08ADA5A7A6183AAE1E09D831DF6748D566095A10&so=3&tr=udp%3A%2F%2Fx', torrent: true });
    expect(torrent).toBe('bt:08ada5a7a6183aae1e09d831df6748d566095a10:3');

    const a = await streamIdentity({ url: 'https://debrid.example/SECRET-1/file.mkv', torrent: false, filename: 'Film.2020.1080p.mkv', videoSize: 123, description: 'Film\n👤 10' });
    const b = await streamIdentity({ url: 'https://debrid.example/SECRET-2/file.mkv', torrent: false, filename: 'Film.2020.1080p.mkv', videoSize: 123, description: 'Film\n👤 99' });
    // The same release behind a fresh link (and changed seeders) is the same stream…
    expect(a).toBe(b);
    expect(a).toMatch(/^h:[0-9a-f]{32}$/);
    expect(a).not.toContain('SECRET');
    // …a different file isn't.
    expect(await streamIdentity({ url: 'https://x/y', torrent: false, filename: 'Film.2020.720p.mkv', videoSize: 123 })).not.toBe(a);
    // Without a file name, the name and first description line.
    const c = await streamIdentity({ url: 'https://x/1', torrent: false, name: 'Addon\n1080p', description: 'Film.2020\n👤 1' });
    const d = await streamIdentity({ url: 'https://x/2', torrent: false, name: 'Addon\n1080p', description: 'Film.2020\n👤 7' });
    expect(c).toBe(d);
  });

  it('words failures from Rust', () => {
    expect(failureText({ kind: 'disk-full' })).toBe('The drive is full.');
    expect(failureText({ kind: 'missing' })).toBe('The file was moved or deleted. Retry to download it again.');
    expect(failureText({ kind: 'network-folder' })).toBe('Choose a network folder with Change… instead of typing it.');
    expect(failureText({ kind: 'http', status: 403 })).toBe('The server refused the download (error 403). Try again, or pick another source.');
    expect(failureText({ kind: 'something-new' })).toBe('The download stopped unexpectedly. Try again.');
    expect(failureText('raw text')).toBe('The download stopped unexpectedly. Try again.');
  });

  it('measures progress', () => {
    expect(fraction({ doneBytes: 50, totalBytes: 200 })).toBe(0.25);
    expect(fraction({ doneBytes: 50, totalBytes: null })).toBeNull();
    expect(secondsLeft({ doneBytes: 100, totalBytes: 1100, speed: 100 })).toBe(10);
    expect(secondsLeft({ doneBytes: 100, totalBytes: 1100, speed: 0 })).toBeNull();
    expect(formatBytes(1.5 * 1024 ** 3)).toMatch(/1\.5\s?GB/);
    expect(formatBytes(800 * 1024 ** 2)).toMatch(/800\s?MB/);
  });
});

describe('loading downloads', () => {
  const row = (id: string) => ({
    id,
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
    state: 'done',
    error: null,
    doneBytes: 1,
    totalBytes: 1,
    createdAt: 1,
    finishedAt: 1,
  });

  it('keeps the newest list when loads overlap', async () => {
    // The first answer is older (still has "a") but arrives last.
    vi.mocked(invoke)
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve([row('a')]), 20)))
      .mockImplementationOnce(async () => []);
    await Promise.all([loadDownloads(), loadDownloads()]);
    expect(allDownloads()).toEqual([]);
  });

  it('goes on with downloads the connection dropped once it is back, and only those', async () => {
    const stopped = (id: string, state: string, kind: string | null) => ({ ...row(id), state, error: kind ? { kind } : null });
    vi.mocked(invoke).mockResolvedValueOnce([
      stopped('dropped', 'failed', 'network'),
      stopped('full', 'failed', 'disk-full'),
      stopped('server', 'failed', 'http'),
      stopped('paused', 'paused', null),
      stopped('saved', 'done', null),
    ]);
    await loadDownloads();
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValue(undefined);
    resumeAfterReconnect();
    expect(vi.mocked(invoke).mock.calls).toEqual([['download_resume', { id: 'dropped' }]]);
  });
});

describe('refreshing a download link', () => {
  const file = { url: 'https://debrid.example/new/file.mkv', behaviorHints: { filename: 'Show.S01E05.mkv', videoSize: 5 } };
  const item = (videoId: string, streamId: string) =>
    ({ id: 'd1', titleId: 'kitsu:1234', videoId, season: 1, addonKey: 'a', streamType: 'series', streamId, torrent: false }) as unknown as DownloadItem;

  async function refresh(download: DownloadItem, answers: Record<string, unknown[]>): Promise<{ ok: boolean; asked: string[] }> {
    vi.mocked(usableAddons).mockResolvedValue([{ key: 'a' } as UsableAddon]);
    const asked: string[] = [];
    vi.spyOn(registry, 'request').mockImplementation(async (_addon, req) => {
      asked.push(req.id);
      return { streams: answers[req.id] ?? [] };
    });
    vi.mocked(invoke).mockResolvedValue(undefined);
    const identity = await streamIdentity({ url: file.url, torrent: false, ...file.behaviorHints });
    return { ok: await refreshLink({ ...download, identity }), asked };
  }

  it('asks again with the id stored when it was downloaded', async () => {
    expect(await refresh(item('tt1:1:2', 'tt1:1:2'), { 'tt1:1:2': [file] })).toEqual({ ok: true, asked: ['tt1:1:2'] });
  });

  it("tries the episode's own id when an older download's id finds nothing", async () => {
    expect(await refresh(item('kitsu:1234:5', 'kitsu:1234:1:5'), { 'kitsu:1234:5': [file] })).toEqual({ ok: true, asked: ['kitsu:1234:1:5', 'kitsu:1234:5'] });
  });
});
