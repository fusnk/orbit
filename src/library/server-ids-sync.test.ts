import { expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (key: string) => key }));

const { syncable } = await import('./stremio-sync');

it("titles only on the person's own Jellyfin or Plex server are never sent to Stremio", () => {
  // Their ids name an item on that server: nothing Stremio (or another device) can open, and not Stremio's to know.
  expect(syncable({ id: 'jellyfin:0a1b2c3d:f27caa37e5142225cceded48f6553502', type: 'movie' })).toBe(false);
  expect(syncable({ id: 'plex:0a1b2c3d:101', type: 'series' })).toBe(false);
  // The server's titles that have an IMDb id are Cinemeta's titles, and sync as usual.
  expect(syncable({ id: 'tt0063350', type: 'movie' })).toBe(true);
});
