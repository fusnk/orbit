import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { cmd: string; args?: Record<string, unknown> | undefined }[] = [];
let parentNeeded = false;
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === 'profile_check_parent' && parentNeeded && !args?.guardianPin) throw 'parent-pin-needed';
    return null;
  },
}));
const profile = { limited: false };
vi.mock('../catalog/parental', () => ({ limited: () => profile.limited }));
vi.mock('../library/history-pause', () => ({ historyPaused: () => false }));

const { discordOptions, setHideOnLimited } = await import('./discord-options');

const saved = () => calls.filter((c) => c.cmd === 'settings_set').map((c) => (c.args?.value as { hideOnLimited: boolean }).hideOnLimited);
const asked = () => calls.filter((c) => c.cmd === 'profile_check_parent').map((c) => c.args?.guardianPin);

beforeEach(() => {
  calls.length = 0;
  profile.limited = false;
  parentNeeded = false;
});

describe('Discord: hide on limited profiles', () => {
  it('turns off without asking on a profile without a content limit', async () => {
    await setHideOnLimited(false);
    expect(asked()).toEqual([]);
    expect(saved()).toEqual([false]);
  });

  it('turns on without asking, even on a limited profile', async () => {
    profile.limited = true;
    parentNeeded = true;
    await setHideOnLimited(true);
    expect(asked()).toEqual([]);
    expect(saved()).toEqual([true]);
  });

  it('needs a parent to turn off on a limited profile, and saves nothing until one is found', async () => {
    profile.limited = true;
    parentNeeded = true;
    // On to start with, whichever test ran before this one.
    await setHideOnLimited(true);
    calls.length = 0;
    await expect(setHideOnLimited(false)).rejects.toBe('parent-pin-needed');
    expect(saved()).toEqual([]);
    expect(discordOptions().hideOnLimited).toBe(true);
    await setHideOnLimited(false, '1234');
    expect(asked()).toEqual([null, '1234']);
    expect(saved()).toEqual([false]);
    expect(discordOptions().hideOnLimited).toBe(false);
  });
});
