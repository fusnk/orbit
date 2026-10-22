import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { settings } from '../lib/ipc';
import { streamLabels } from '../lib/stream-traits';
import { parseVodSources, prepareVod, VOD_SOURCES_KEY, vodOrigin, vodRequest, vodSources, vodStream } from './vod';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../lib/ipc', () => ({ settings: { get: vi.fn() } }));
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(settings.get).mockReset().mockResolvedValue(undefined);
});

describe('IPTV VOD matching request', () => {
  it('keeps title identifiers and first release year for matching', () => {
    expect(vodRequest({ id: 'tt1234567', type: 'movie', name: 'A Film', year: '2001–2003' })).toEqual({ id: 'tt1234567', name: 'A Film', year: 2001, season: null, episode: null });
  });
  it('uses the series id and exact episode coordinates', () => {
    expect(vodRequest({ id: 'tmdb:42', type: 'series', name: 'A Show' }, { season: 0, number: 3 })).toEqual({ id: 'tmdb:42', name: 'A Show', year: null, season: 0, episode: 3 });
  });
  it('does not guess a year from malformed release text', () => {
    expect(vodRequest({ id: 'custom', type: 'movie', name: 'A Film', year: 'unknown' }).year).toBeNull();
  });
  it('asks Rust with metadata only, using exact episode coordinates', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await vodSources({ id: 'tt1234567', type: 'series', name: 'A Show', year: '2005' }, { season: 2, number: 8 });
    expect(invoke).toHaveBeenCalledWith('iptv_vod_sources', { request: { id: 'tt1234567', name: 'A Show', year: 2005, season: 2, episode: 8 } });
  });
  it('does not request sources for live channels or a series without an episode', async () => {
    expect(await vodSources({ id: 'channel', type: 'tv', name: 'News' })).toEqual([]);
    expect(await vodSources({ id: 'show', type: 'series', name: 'A Show' })).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('a failed provider lookup leaves addon source discovery usable', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('provider unavailable'));
    expect(await vodSources({ id: 'tt1234567', type: 'movie', name: 'A Film' })).toEqual([]);
  });
});

describe('the setting', () => {
  it('is on unless turned off', () => {
    expect(parseVodSources(undefined)).toBe(true);
    expect(parseVodSources(null)).toBe(true);
    expect(parseVodSources(true)).toBe(true);
    expect(parseVodSources(false)).toBe(false);
  });
  it('turned off, Rust is never asked', async () => {
    vi.mocked(settings.get).mockResolvedValue(false);
    expect(await vodSources({ id: 'tt1234567', type: 'movie', name: 'A Film' })).toEqual([]);
    await prepareVod({ id: 'tt1234567', type: 'movie', name: 'A Film' });
    expect(settings.get).toHaveBeenCalledWith(VOD_SOURCES_KEY);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('an unreadable setting counts as on', async () => {
    vi.mocked(settings.get).mockRejectedValue(new Error('no database'));
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await vodSources({ id: 'tt1234567', type: 'movie', name: 'A Film' });
    expect(invoke).toHaveBeenCalledOnce();
  });
});

describe('preparing a title page', () => {
  it('asks Rust to get films and series ready, without the episode', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await prepareVod({ id: 'tt1', type: 'series', name: 'A Show', year: '2005–' });
    await prepareVod({ id: 'tt2', type: 'movie', name: 'A Film', year: '2001' });
    expect(invoke).toHaveBeenNthCalledWith(1, 'iptv_vod_prepare', { request: { id: 'tt1', name: 'A Show', year: 2005, season: null, episode: null }, series: true });
    expect(invoke).toHaveBeenNthCalledWith(2, 'iptv_vod_prepare', { request: { id: 'tt2', name: 'A Film', year: 2001, season: null, episode: null }, series: false });
  });
  it('skips live channels and never fails the page', async () => {
    await prepareVod({ id: 'channel', type: 'tv', name: 'News' });
    expect(invoke).not.toHaveBeenCalled();
    vi.mocked(invoke).mockRejectedValueOnce(new Error('no profile'));
    await expect(prepareVod({ id: 'tt2', type: 'movie', name: 'A Film' })).resolves.toBeUndefined();
  });
});

describe('IPTV copies as sources', () => {
  it('keeps playback opaque and is never a torrent', () => {
    const stream = vodStream({ provider: 'My TV', account: 'account', address: 'orbit-tv://account/vod/movie-1-mp4', label: 'Film 1080p', insecure: true });
    expect(stream).toMatchObject({ url: 'orbit-tv://account/vod/movie-1-mp4', description: 'Film 1080p', torrent: false, videoSize: undefined });
  });
  it('feeds the provider’s quality and size to the ranking', () => {
    const stream = vodStream({ provider: 'My TV', account: 'a', address: 'orbit-tv://a/vod/movie-1-mp4', label: 'A Film', insecure: false, detail: '2160p · HEVC · 5.1', size: 8e9 });
    const labels = streamLabels(stream);
    expect(labels.traits).toMatchObject({ resolution: '2160p', codec: 'HEVC', audio: '5.1' });
    expect(labels.traits.sizeGB).toBeGreaterThan(7);
  });
  it('is labeled with the provider, and says when it travels unencrypted', () => {
    expect(vodOrigin({ provider: 'My TV', insecure: false })).toBe('IPTV · My TV');
    expect(vodOrigin({ provider: 'My TV', insecure: true })).toMatch(/^IPTV · My TV · \S/);
  });
  it('the provider’s own name never passes for a quality', () => {
    const stream = vodStream({ provider: 'Best 4K HD TV', account: 'a', address: 'orbit-tv://a/vod/movie-1-mp4', label: 'A Film', insecure: false, detail: null, size: null });
    expect(streamLabels(stream).traits.resolution).toBeUndefined();
  });
});
