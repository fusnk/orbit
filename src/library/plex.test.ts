import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string, protocol: string) => `http://${protocol}.localhost/${encodeURIComponent(path)}` }));

import { createPlexReporter, isPlexAddress, isPlexId, plexItemTitle, plexMetaTitle, plexPosterFor, plexVersionStream, type PlexItem } from './plex';
import { REPORT_EVERY_MS } from './media-server';
import { streamLabels } from '../lib/stream-traits';

const art = (key: string) => `art:${key}`;

const movie: PlexItem = {
  titleId: 'tt0063350',
  type: 'movie',
  name: 'Night of the Living Dead',
  year: '1968',
  description: null,
  genres: ['Horror'],
  rating: '7.4',
  runtime: '96 min',
  poster: '0a1b2c3d_101_thumb_1700000000',
  background: '0a1b2c3d_101_art_1700000001',
  logo: null,
};

describe('Plex titles', () => {
  it('maps an item to a title from the server, merging with Cinemeta by IMDb id', () => {
    const title = plexItemTitle(movie, 'Attic', art);
    expect(title).toEqual({
      id: 'tt0063350',
      type: 'movie',
      name: 'Night of the Living Dead',
      poster: 'art:0a1b2c3d_101_thumb_1700000000',
      background: 'art:0a1b2c3d_101_art_1700000001',
      logo: undefined,
      description: undefined,
      year: '1968',
      runtime: '96 min',
      genres: ['Horror'],
      rating: '7.4',
      origins: [{ key: 'plex', name: 'Attic' }],
    });
  });

  it('groups a Plex-only show into seasons', () => {
    const show: PlexItem = { ...movie, titleId: 'plex:0a1b2c3d:500', type: 'series' };
    const ep = (season: number, episode: number) => ({ id: `plex:0a1b2c3d:${season * 100 + episode}`, season, episode, title: `E${episode}`, thumbnail: season === 1 ? 'thumb' : null });
    const title = plexMetaTitle({ item: show, episodes: [ep(2, 1), ep(1, 2), ep(1, 1)] }, 'Attic', art, new Date('2026-01-01'));
    expect(title.seasons?.map((s) => [s.number, s.episodes.map((e) => e.number)])).toEqual([
      [1, [1, 2]],
      [2, [1]],
    ]);
    expect(title.seasons?.[0]?.episodes[0]?.thumbnail).toBe('art:thumb');
  });

  it('recognises its own ids and addresses, and finds posters again', () => {
    expect(isPlexId('plex:0a1b2c3d:101')).toBe(true);
    for (const id of ['tt0063350', 'plex:0a1b2c3d:abc', 'plex:0A1B2C3D:101', 'plex:0a1b2c3d:101:2', `jellyfin:0a1b2c3d:${'f'.repeat(32)}`]) expect(isPlexId(id)).toBe(false);
    expect(isPlexAddress('orbit-plex://101/11')).toBe(true);
    expect(isPlexAddress('orbit-jellyfin://x')).toBe(false);
    expect(plexPosterFor('plex:0a1b2c3d:101', art)).toBe('art:0a1b2c3d_101_thumb');
    expect(plexPosterFor('tt1', art)).toBeUndefined();
    expect(plexPosterFor('plex:0a1b2c3d:101')).toBe('http://plex-art.localhost/0a1b2c3d_101_thumb');
  });

  it('turns a version into a stream the picker reads quality from', () => {
    const stream = plexVersionStream({ address: 'orbit-plex://101/11', label: '2160p HEVC HDR10 5.1', name: null, size: 4_000_000_000 });
    expect(stream.url).toBe('orbit-plex://101/11');
    expect(stream.name).toBe('Plex\n2160p HEVC HDR10 5.1');
    const labels = streamLabels(stream);
    expect(labels.traits.resolution).toBe('2160p');
    expect(labels.codec).toBe('HEVC');
  });
});

describe('Plex playback reports', () => {
  const address = 'orbit-plex://101/11';

  it('sends the duration Plex needs with each report, and stops', () => {
    const sent: [string, number, boolean, number | null][] = [];
    let clock = 0;
    const r = createPlexReporter(
      (event, _address, position, paused, duration) => sent.push([event, position, paused, duration]),
      () => clock,
    );
    r.status('orbit-jellyfin://x', 1, false, 100);
    r.status(address, 1, false, null);
    clock += REPORT_EVERY_MS;
    r.status(address, 21, false, 5760);
    r.status(address, 21, true, null);
    r.stop();
    expect(sent).toEqual([
      ['start', 1, false, null],
      ['progress', 21, false, 5760],
      ['progress', 21, true, 5760],
      ['stop', 21, true, 5760],
    ]);
  });
});

describe('Plex playback reports on the way to the server', () => {
  it('go one after another, and one that fails doesn’t hold up the rest', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const calls: string[] = [];
    const answers: ((ok: boolean) => void)[] = [];
    vi.mocked(invoke).mockImplementation((_cmd, args) => {
      calls.push((args as { event: string }).event);
      return new Promise((resolve, reject) => answers.push((ok) => (ok ? resolve(undefined) : reject(new Error('offline')))));
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = createPlexReporter();
    r.status('orbit-plex://101/11', 100, false);
    // The end: paused on the last frame, then stopped, one right after the other.
    r.status('orbit-plex://101/11', 5760, true, 5760);
    r.stop();
    await Promise.resolve();
    expect(calls).toEqual(['start']);
    answers[0]!(false);
    await vi.waitFor(() => expect(calls).toEqual(['start', 'progress']));
    answers[1]!(true);
    await vi.waitFor(() => expect(calls).toEqual(['start', 'progress', 'stop']));
    warn.mockRestore();
  });
});
