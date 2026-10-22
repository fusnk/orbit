import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string, protocol: string) => `http://${protocol}.localhost/${encodeURIComponent(path)}` }));

import { createJellyfinReporter, isJellyfinId, itemToTitle, metaToTitle, posterFor, REPORT_EVERY_MS, versionStream, type JellyfinItem } from './jellyfin';
import { streamLabels } from '../lib/stream-traits';

const ITEM = 'f27caa37e5142225cceded48f6553502';
const art = (key: string) => `art:${key}`;

const movie: JellyfinItem = {
  titleId: 'tt0063350',
  jellyfinId: ITEM,
  type: 'movie',
  name: 'Night of the Living Dead',
  year: '1968',
  description: null,
  genres: ['Horror'],
  rating: '7.4',
  runtime: '96 min',
  poster: `0a1b2c3d_${ITEM}_Primary_abc`,
  background: null,
  logo: null,
};

describe('Jellyfin titles', () => {
  it('maps an item to a title from the server', () => {
    const title = itemToTitle(movie, 'Den', art);
    expect(title).toEqual({
      id: 'tt0063350',
      type: 'movie',
      name: 'Night of the Living Dead',
      poster: `art:0a1b2c3d_${ITEM}_Primary_abc`,
      background: undefined,
      logo: undefined,
      description: undefined,
      year: '1968',
      runtime: '96 min',
      genres: ['Horror'],
      rating: '7.4',
      origins: [{ key: 'jellyfin', name: 'Den' }],
    });
  });

  it('groups a Jellyfin-only show into seasons', () => {
    const show: JellyfinItem = { ...movie, titleId: `jellyfin:0a1b2c3d:${ITEM}`, type: 'series' };
    const ep = (season: number, episode: number) => ({ id: `jellyfin:0a1b2c3d:${String(season * 100 + episode).padStart(32, '0')}`, season, episode, title: `E${episode}`, thumbnail: season === 1 ? 'thumb' : null });
    const title = metaToTitle({ item: show, episodes: [ep(2, 1), ep(1, 2), ep(1, 1), ep(0, 1)] }, 'Den', art, new Date('2026-01-01'));
    expect(title.seasons?.map((s) => [s.number, s.episodes.map((e) => e.number)])).toEqual([
      [1, [1, 2]],
      [2, [1]],
      [0, [1]],
    ]);
    expect(title.seasons?.[0]?.episodes[0]?.thumbnail).toBe('art:thumb');
    expect(metaToTitle({ item: movie, episodes: [] }, 'Den', art).seasons).toBeUndefined();
  });

  it('recognises its own ids and finds their posters again', () => {
    expect(isJellyfinId(`jellyfin:0a1b2c3d:${ITEM}`)).toBe(true);
    for (const id of ['tt0063350', 'jellyfin:0a1b2c3d:short', `jellyfin:0A1B2C3D:${ITEM}`, `jellyfin:0a1b2c3d:${ITEM}:1:2`]) expect(isJellyfinId(id)).toBe(false);
    expect(posterFor(`jellyfin:0a1b2c3d:${ITEM}`, art)).toBe(`art:0a1b2c3d_${ITEM}_Primary`);
    expect(posterFor('tt1', art)).toBeUndefined();
    // On Windows the protocol is served from its own localhost origin (which the CSP allows for images).
    expect(posterFor(`jellyfin:0a1b2c3d:${ITEM}`)).toBe(`http://jellyfin-art.localhost/0a1b2c3d_${ITEM}_Primary`);
  });

  it('turns a version into a stream the picker reads quality from', () => {
    const stream = versionStream({ address: `orbit-jellyfin://${ITEM}/${ITEM}`, label: '2160p HEVC DV 5.1', name: 'Director’s Cut', size: 4_000_000_000 });
    expect(stream.url).toBe(`orbit-jellyfin://${ITEM}/${ITEM}`);
    expect(stream.torrent).toBe(false);
    const labels = streamLabels(stream);
    expect(labels.traits.resolution).toBe('2160p');
    expect(labels.traits.hdr).toBe('Dolby Vision');
    expect(labels.codec).toBe('HEVC');
    expect(labels.size).toBe('3.7 GB');
  });
});

describe('Jellyfin playback reports', () => {
  const address = `orbit-jellyfin://${ITEM}/${ITEM}`;

  function reporter() {
    const sent: [string, number, boolean][] = [];
    let clock = 0;
    const r = createJellyfinReporter(
      (event, _address, position, paused) => sent.push([event, position, paused]),
      () => clock,
    );
    return { r, sent, tick: (ms: number) => (clock += ms) };
  }

  it('starts, reports on a timer and on pause, and stops', () => {
    const { r, sent, tick } = reporter();
    r.status(address, null, false);
    r.status(address, 1, false);
    tick(5000);
    r.status(address, 6, false);
    tick(REPORT_EVERY_MS);
    r.status(address, 26, false);
    r.status(address, 26.5, true);
    r.status(address, 26.5, true);
    r.stop();
    expect(sent).toEqual([
      ['start', 1, false],
      ['progress', 26, false],
      ['progress', 26.5, true],
      ['stop', 26.5, true],
    ]);
  });

  it('ignores other sources, and the last frame after the end', () => {
    const { r, sent } = reporter();
    r.status('https://cdn.example.com/a.mkv', 10, false);
    r.status(address, 100, false);
    r.stop();
    r.status(address, 100, true);
    expect(sent.map(([event]) => event)).toEqual(['start', 'stop']);
    // Opening it again starts afresh.
    r.newFile();
    r.status(address, 0, false);
    expect(sent.map(([event]) => event)).toEqual(['start', 'stop', 'start']);
  });

  it('stops the previous video when another starts', () => {
    const { r, sent } = reporter();
    r.status(address, 5, false);
    r.status(`orbit-jellyfin://${'a'.repeat(32)}`, 0, false);
    expect(sent.map(([event]) => event)).toEqual(['start', 'stop', 'start']);
  });
});

describe('Jellyfin playback reports on the way to the server', () => {
  it('go one after another, so the end’s last progress can’t land after its stop', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const calls: string[] = [];
    const answers: (() => void)[] = [];
    vi.mocked(invoke).mockImplementation((_cmd, args) => {
      calls.push((args as { event: string }).event);
      return new Promise((resolve) => answers.push(() => resolve(undefined)));
    });
    const address = `orbit-jellyfin://${ITEM}/${ITEM}`;
    const r = createJellyfinReporter();
    r.status(address, 100, false);
    // The end: paused on the last frame, then stopped, one right after the other.
    r.status(address, 5760, true);
    r.stop();
    await Promise.resolve();
    expect(calls).toEqual(['start']);
    answers[0]!();
    await vi.waitFor(() => expect(calls).toEqual(['start', 'progress']));
    answers[1]!();
    await vi.waitFor(() => expect(calls).toEqual(['start', 'progress', 'stop']));
  });
});
