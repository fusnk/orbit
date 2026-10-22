import { beforeEach, describe, expect, it, vi } from 'vitest';

interface P {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
}
let profiles: P[] = [];
const updateProfile = vi.fn(async (id: string, name: string) => {
  profiles = profiles.map((p) => (p.id === id ? { ...p, name } : p));
});
let language = 'Ich';
const session = new Map<string, string>();

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null }));
vi.mock('../../addons/registry', () => ({ list: async () => [] }));
vi.mock('../../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));
vi.mock('../../library/library', () => ({ libraryEntries: () => [] }));
vi.mock('../../library/watch', () => ({ watchHistory: () => ({ titles: [] }) }));
vi.mock('../../i18n', () => ({ t: (key: string) => (key === 'titles.profiles.default-name' ? language : key) }));
vi.mock('../../library/profiles', () => ({
  FIRST_PROFILE: { id: 'main', name: 'Me' },
  listProfiles: async () => profiles,
  updateProfile: (id: string, name: string) => updateProfile(id, name),
}));
const named = vi.fn();
vi.stubGlobal('document', { dispatchEvent: (event: CustomEvent<string>) => named(event.detail) });
vi.stubGlobal('sessionStorage', { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) });

const { nameFirstProfile } = await import('./state');

beforeEach(() => {
  profiles = [{ id: 'main', name: 'Me', color: '#e5484d', avatar: null }];
  language = 'Ich';
  session.clear();
  updateProfile.mockClear();
});

describe("a new install's first profile", () => {
  it('is named in the person’s language', async () => {
    await nameFirstProfile();
    expect(profiles[0]!.name).toBe('Ich');
    // The title bar is told.
    expect(named).toHaveBeenCalledWith('Ich');
  });

  it('follows a language changed during setup, while it keeps the name setup gave it', async () => {
    await nameFirstProfile();
    language = 'Moi';
    await nameFirstProfile();
    expect(profiles[0]!.name).toBe('Moi');
  });

  it('keeps a name the person chose', async () => {
    profiles = [{ id: 'main', name: 'Sam', color: '#e5484d', avatar: null }];
    await nameFirstProfile();
    await nameFirstProfile();
    expect(updateProfile).not.toHaveBeenCalled();
    // Named by setup, then renamed by the person: theirs stays.
    profiles = [{ id: 'main', name: 'Me', color: '#e5484d', avatar: null }];
    await nameFirstProfile();
    profiles[0]!.name = 'Sam';
    language = 'Moi';
    await nameFirstProfile();
    expect(profiles[0]!.name).toBe('Sam');
  });

  it('leaves any other profile alone', async () => {
    profiles = [{ id: '0123456789abcdef', name: 'Me', color: '#e5484d', avatar: null }];
    await nameFirstProfile();
    profiles = [
      { id: 'main', name: 'Me', color: '#e5484d', avatar: null },
      { id: '0123456789abcdef', name: 'Kid', color: '#46c28e', avatar: null },
    ];
    await nameFirstProfile();
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
