import { describe, expect, it, vi } from 'vitest';

const status = { serverName: 'Attic', userName: 'sam', host: '192.168.1.5:32400', insecure: true };
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string, protocol: string) => `http://${protocol}.localhost/${path}`,
  invoke: vi.fn(async (command: string) => {
    switch (command) {
      case 'jellyfin_status':
      case 'plex_status':
        return status;
      case 'jellyfin_find':
        throw new Error('Couldn’t reach the Jellyfin server.');
      case 'plex_find':
        return { serverName: 'Attic', versions: [{ address: 'orbit-plex://101/11', label: '1080p H.264', resume: 600 }] };
      case 'debrid_accounts':
        return [
          { provider: 'realdebrid', name: 'Real-Debrid', userName: 'sam', premiumUntil: null },
          { provider: 'torbox', name: 'TorBox', userName: 's@x', premiumUntil: null },
        ];
      case 'debrid_items':
        // Both accounts have the film; a third item is another film, a fourth not ready.
        return {
          items: [
            { provider: 'realdebrid', id: 'ABC', name: 'Night.of.the.Living.Dead.1968.1080p', size: 9, state: 'ready', progress: 100, added: 2, deletable: true },
            { provider: 'torbox', id: 't7', name: 'Night of the Living Dead (1968) 2160p', size: 9, state: 'ready', progress: 100, added: 1, deletable: true },
            { provider: 'torbox', id: 't8', name: 'Dawn.of.the.Dead.1978', size: 9, state: 'ready', progress: 100, added: 1, deletable: true },
            { provider: 'realdebrid', id: 'DEF', name: 'Night.of.the.Living.Dead.1968.720p', size: 9, state: 'downloading', progress: 5, added: 3, deletable: true },
          ],
          problems: [],
        };
      case 'debrid_files':
        return {
          name: 'x',
          ready: true,
          files: [
            { index: 1, name: 'Night.of.the.Living.Dead.1968.mkv', size: 5000, video: true, extra: false, address: 'orbit-debrid://x/1' },
            { index: 2, name: 'sample.mkv', size: 10, video: true, extra: true, address: 'orbit-debrid://x/2' },
          ],
        };
      default:
        return null;
    }
  }),
}));

import { ownServerVersions } from './own-servers';
import type { Title } from '../catalog/titles';

describe('own servers', () => {
  it('asks every connected server, and one failing doesn’t hide the others', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const title = { id: 'tt0063350', type: 'movie', name: 'Night of the Living Dead' } as Title;
    const found = await ownServerVersions(title);
    expect(found[0]).toMatchObject({ kind: 'plex', serverName: 'Attic', version: { resume: 600 }, stream: { url: 'orbit-plex://101/11', name: 'Plex\n1080p H.264' } });
    // The same film in two debrid accounts: one source for each (not the other film, nor the one still downloading).
    const cloud = found.filter((f) => f.kind === 'cloud');
    expect(cloud.map((f) => f.serverName).sort()).toEqual(['Real-Debrid', 'TorBox']);
    expect(cloud[0]).toMatchObject({ version: { address: 'orbit-debrid://x/1', name: 'Night.of.the.Living.Dead.1968.mkv', size: 5000 }, stream: { url: 'orbit-debrid://x/1', filename: 'Night.of.the.Living.Dead.1968.mkv' } });
    expect(found).toHaveLength(3);
  });
});
