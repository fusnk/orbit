import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const profiles = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('./profiles', () => ({ listProfiles: () => profiles() }));

import { en } from '../i18n/locales/en';
import { AVATAR_CATEGORIES, AVATAR_GRADIENTS, AVATARS, avatarGradient, avatarUrl, saveAvatarFromUrl, uploadedAvatarUrl } from './avatars';

describe('uploaded pictures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lets go of the pictures no profile uses once another is saved', async () => {
    // Each kept its blob: URL (and the image behind it) for the session, though Rust deleted its file.
    let made = 0;
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => `blob:${++made}`, revokeObjectURL: revoke });
    profiles.mockResolvedValue([{ avatar: 'upload-0000000000000001' }]);
    invoke.mockImplementation(async (cmd: string) => (cmd === 'avatar_get' ? new ArrayBuffer(4) : 'upload-00000000000000ff'));
    expect(await uploadedAvatarUrl('upload-0000000000000001')).toBe('blob:1');
    expect(await uploadedAvatarUrl('upload-0000000000000002')).toBe('blob:2');
    await saveAvatarFromUrl('https://image.tmdb.org/t/p/w185/a.jpg');
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:2'));
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(await uploadedAvatarUrl('upload-0000000000000001')).toBe('blob:1');
  });
});

describe('avatar gradients', () => {
  it('gives every bundled picture a background of its own choosing', () => {
    for (const name of AVATARS) expect(AVATAR_GRADIENTS).toContain(avatarGradient(name));
    // Picked by hand, not hashed: the yellow grin isn't put on the yellow background.
    expect(avatarGradient('grin')).toBe('sunset');
    expect(avatarGradient('star')).toBe('night');
  });

  it('picks the same background for the same id every time', () => {
    const id = 'upload-0123456789abcdef';
    expect(avatarGradient(id)).toBe(avatarGradient(id));
    expect(AVATAR_GRADIENTS).toContain(avatarGradient(id));
    expect(AVATAR_GRADIENTS).toContain(avatarGradient(''));
  });

  it('spreads other ids over the palette', () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => avatarGradient(`tmdb-${i}`)));
    expect(seen.size).toBe(AVATAR_GRADIENTS.length);
  });
});

describe('bundled avatars', () => {
  it('lists every picture once, each bundled and named', () => {
    expect(new Set(AVATARS).size).toBe(AVATARS.length);
    expect(AVATARS.length).toBeGreaterThanOrEqual(52);
    for (const name of AVATARS) {
      expect(avatarUrl(name)).toBeTruthy();
      expect(en).toHaveProperty(`avatars.name.${name}`);
    }
    for (const category of AVATAR_CATEGORIES) expect(en).toHaveProperty(`avatars.category.${category.id}`);
  });
});
