import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
  invoke: vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    switch (command) {
      case 'debrid_accounts':
        return [
          { provider: 'realdebrid', name: 'Real-Debrid', userName: 'sam', premiumUntil: null },
          { provider: 'torbox', name: 'TorBox', userName: 's@x', premiumUntil: null },
        ];
      case 'debrid_items':
        // Real-Debrid is rate-limited: Rust sends what it last saw, and says so.
        return {
          items: [
            { provider: 'realdebrid', id: 'ABC', name: 'Show.Name.S01.1080p', size: 9, state: 'ready', progress: 100, added: 2, deletable: true },
            { provider: 'torbox', id: 't7', name: 'Show Name S01 2160p', size: 9, state: 'ready', progress: 100, added: 1, deletable: true },
          ],
          problems: [{ provider: 'realdebrid', kind: 'rate-limited', retryIn: 30 }],
        };
      case 'debrid_files':
        if (args.provider === 'realdebrid') throw new Error('Real-Debrid asked Orbit to slow down. Try again in 30 seconds.');
        return {
          name: 'Show Name S01 2160p',
          ready: true,
          files: [
            { index: 0, name: 'Show Name S01/Show.Name.S01E01.mkv', size: 100, video: true, extra: false, season: 1, episode: 1, address: 'orbit-debrid://torbox/t7/0' },
            { index: 1, name: 'Show Name S01/Show.Name.S01E02.mkv', size: 100, video: true, extra: false, season: 1, episode: 2, address: 'orbit-debrid://torbox/t7/1' },
          ],
        };
      default:
        return null;
    }
  }),
}));

import { cloudId, cloudSources, nameOfFile, parseCloudFiles, parseListing } from './cloud';
import type { Title } from '../catalog/titles';

describe('cloud answers', () => {
  it('keeps only well-formed items and problems', () => {
    const listing = parseListing({
      items: [
        { provider: 'torbox', id: 't1', name: 'A', size: 5, state: 'ready', progress: 100, added: 1, deletable: true },
        { provider: 'alldebrid', id: 'x', name: 'B', size: 5, state: 'ready', progress: 100 },
        { provider: 'torbox', id: 't2', name: 'C', state: 'exploded' },
        { provider: 'realdebrid', id: 'D', name: 'D', size: -1, state: 'downloading', progress: 250, added: null },
        'nonsense',
      ],
      problems: [{ provider: 'torbox', kind: 'rate-limited', retryIn: 12 }, { provider: 'torbox', kind: 'odd' }],
    });
    expect(listing.items.map((i) => i.id)).toEqual(['t1', 'D']);
    expect(listing.items[1]).toMatchObject({ size: 0, progress: 100, added: null, deletable: false });
    expect(listing.problems).toEqual([{ provider: 'torbox', kind: 'rate-limited', retryIn: 12 }]);
    expect(parseListing(null)).toEqual({ items: [], problems: [] });
  });

  it('keeps a section the plan leaves out, and only a known one', () => {
    const listing = parseListing({
      items: [],
      problems: [
        { provider: 'torbox', kind: 'restricted', retryIn: null, section: 'usenet' },
        { provider: 'torbox', kind: 'restricted', retryIn: null, section: 'web' },
        { provider: 'torbox', kind: 'restricted', retryIn: null, section: '<b>' },
        { provider: 'torbox', kind: 'restricted', retryIn: null },
      ],
    });
    expect(listing.problems).toEqual([
      { provider: 'torbox', kind: 'restricted', retryIn: null, section: 'usenet' },
      { provider: 'torbox', kind: 'restricted', retryIn: null, section: 'web' },
    ]);
  });

  it('keeps file addresses only when they are cloud addresses', () => {
    const files = parseCloudFiles({
      name: 'N',
      ready: true,
      files: [
        { index: 1, name: 'a.mkv', size: 1, video: true, extra: false, address: 'orbit-debrid://torbox/t1/1' },
        { index: 2, name: 'b.mkv', size: 1, video: true, extra: false, address: 'https://cdn.example/b.mkv' },
        { index: 3, name: 'c.nfo', size: 1, video: false, extra: false },
      ],
    });
    expect(files.files.map((f) => f.address)).toEqual(['orbit-debrid://torbox/t1/1', undefined, undefined]);
    expect(files.ready).toBe(true);
  });
});

describe('cloud files', () => {
  it('names a file from itself and its item', () => {
    expect(nameOfFile({ name: 'Show.Name.S02.1080p' }, { name: 'Show.Name.S02/02 - Pilot.mkv', season: 2, episode: 2 })).toEqual({ name: 'Show Name', season: 2, episode: 2, pack: false });
    expect(nameOfFile({ name: 'Show.Name.S01E04.720p' }, { name: 'ep.mkv' })).toEqual({ name: 'Show Name', season: 1, episode: 4, pack: false });
    expect(nameOfFile({ name: 'The.Matrix.1999.1080p' }, { name: 'fgt-matrix.mkv' })).toEqual({ name: 'The Matrix', year: '1999', pack: false });
    expect(cloudId({ provider: 'torbox', id: 't7' } as never, { index: 3 } as never)).toBe('cloud:torbox:t7:3');
  });

  it('gives a source per provider that has the episode, and one failing doesn’t hide the other', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const title = { id: 'tt1', type: 'series', name: 'Show Name', genres: [], origins: [], seasons: [{ number: 1, episodes: [{ id: 'tt1:1:1', number: 1, title: 'One' }, { id: 'tt1:1:2', number: 2, title: 'Two' }] }] } as unknown as Title;
    const found = await cloudSources(title, { season: 1, number: 2 });
    expect(found).toEqual([{ provider: 'torbox', version: { address: 'orbit-debrid://torbox/t7/1', label: '', name: 'Show.Name.S01E02.mkv', size: 100 } }]);
    // A movie of the same name isn't the show.
    expect(await cloudSources({ ...title, type: 'movie' }, undefined)).toEqual([]);
  });
});
