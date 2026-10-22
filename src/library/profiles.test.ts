import { beforeEach, describe, expect, it, vi } from 'vitest';

const saved = new Map<string, unknown>();
let active: string | null = 'main';
vi.mock('../lib/ipc', () => ({
  settings: { get: async (key: string) => saved.get(key) ?? null, set: async (key: string, value: unknown) => void saved.set(key, value) },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => active }));

// The page remembers the active profile for the session: each test starts a fresh one.
let profiles: typeof import('./profiles');
const profileSetting = (prefix: string) => profiles.profileSetting(prefix);

describe('per-profile settings', () => {
  beforeEach(async () => {
    saved.clear();
    active = 'main';
    vi.resetModules();
    profiles = await import('./profiles');
  });

  it("reads the active profile's own value", async () => {
    saved.set('stremio.sync.main', false);
    saved.set('stremio.sync.kid', true);
    expect(await profileSetting('stremio.sync')).toEqual({ key: 'stremio.sync.main', value: false });
  });

  it('moves a value saved before it was per profile to the first profile that reads it', async () => {
    saved.set('search.recent', ['dune']);
    expect(await profileSetting('search.recent')).toEqual({ key: 'search.recent.main', value: ['dune'] });
    expect(saved.get('search.recent.main')).toEqual(['dune']);
    expect(saved.get('search.recent')).toBeNull();

    active = 'kid';
    await profiles.selectProfile('kid');
    expect(await profileSetting('search.recent')).toEqual({ key: 'search.recent.kid', value: null });
  });

  it('keeps a profile’s own value over the old one', async () => {
    saved.set('letterboxd.profile', { user: 'old', name: 'Old' });
    saved.set('letterboxd.profile.main', { user: 'new', name: 'New' });
    expect((await profileSetting('letterboxd.profile')).value).toEqual({ user: 'new', name: 'New' });
    expect(saved.get('letterboxd.profile')).toEqual({ user: 'old', name: 'Old' });
  });

  it('falls back to the plain key without a usable profile', async () => {
    active = null;
    saved.set('search.recent', ['dune']);
    expect(await profileSetting('search.recent')).toEqual({ key: 'search.recent', value: ['dune'] });
  });
});

describe('the name a greeting uses', () => {
  it('is the name the person gave, never the first profile’s placeholder', async () => {
    const { chosenName } = await import('./profiles');
    // A new install's only profile, as Rust makes it (db.rs): "Good evening, Me" in every language.
    expect(chosenName({ id: 'main', name: 'Me' })).toBeNull();
    expect(chosenName({ id: 'main', name: ' Sam ' })).toBe('Sam');
    // Another profile the person called "Me" is their choice.
    expect(chosenName({ id: '0123456789abcdef', name: 'Me' })).toBe('Me');
    expect(chosenName({ id: 'main', name: '  ' })).toBeNull();
  });
});