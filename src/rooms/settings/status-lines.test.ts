import { describe, expect, it } from 'vitest';
import { statusLines, type Connections } from './status-lines';

const now = Date.UTC(2026, 9, 4, 12, 0, 0);
const none: Connections = { stremio: { signedIn: null, lastSync: null }, jellyfin: null, plex: null, cloud: [], letterboxd: null };
const jellyfin = { serverName: 'Den', userName: 'sam', host: 'den.local', insecure: false };
const letterboxd = { user: 'sam', name: 'Sam' };

describe('statusLines', () => {
  it('says nothing about services it knows nothing of', () => {
    expect(statusLines(none, now, 'en-US')).toEqual([]);
    expect(statusLines({ ...none, stremio: { signedIn: false, lastSync: null } }, now, 'en-US')).toEqual([]);
  });

  it('tells how long ago Stremio last synced', () => {
    const at = (ms: number) => statusLines({ ...none, stremio: { signedIn: true, lastSync: now - ms } }, now, 'en-US');
    expect(at(10_000)).toEqual(['Stremio · synced just now']);
    expect(at(5 * 60_000)).toEqual(['Stremio · synced 5 minutes ago']);
    expect(at(3 * 3_600_000)).toEqual(['Stremio · synced 3 hours ago']);
    expect(statusLines({ ...none, stremio: { signedIn: true, lastSync: null } }, now, 'en-US')).toEqual(['Stremio · signed in']);
  });

  it('shows at most two lines, Stremio first', () => {
    expect(statusLines({ stremio: { signedIn: true, lastSync: null }, jellyfin, plex: null, cloud: [], letterboxd }, now, 'en-US')).toEqual(['Stremio · signed in', 'Jellyfin · Den']);
    expect(statusLines({ ...none, jellyfin, letterboxd }, now, 'en-US')).toEqual(['Jellyfin · Den', 'Letterboxd · Sam']);
    expect(statusLines({ ...none, plex: { ...jellyfin, serverName: 'Attic' }, letterboxd }, now, 'en-US')).toEqual(['Plex · Attic', 'Letterboxd · Sam']);
  });

  it('names the connected debrid accounts on one line', () => {
    expect(statusLines({ ...none, cloud: [{ name: 'Real-Debrid' }, { name: 'TorBox' }], letterboxd }, now, 'en-US')).toEqual(['My cloud · Real-Debrid, TorBox', 'Letterboxd · Sam']);
  });

  it('falls back to the Letterboxd username without a display name', () => {
    expect(statusLines({ ...none, letterboxd: { user: 'sam', name: '' } }, now, 'en-US')).toEqual(['Letterboxd · sam']);
  });
});
