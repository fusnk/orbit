import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../library/stremio-sync', () => ({ flushStremioSync: vi.fn(async () => {}) }));

import { invoke } from '@tauri-apps/api/core';
import type { Title } from '../catalog/titles';
import { flushStremioSync } from '../library/stremio-sync';
import { loadWatch, recordProgress } from '../library/watch';
import { LEAVING_PROFILE, switchProfile } from './profile-switch';

const mocked = vi.mocked(invoke);
const movie: Title = { id: 'tt1', type: 'movie', name: 'Film', year: '2020', genres: [], origins: [] };
/** Which profile Rust writes to: the active one when the command runs. */
let active = 'parent';
/** Each watch write, with the profile it landed in. */
let written: { profile: string; position: number }[] = [];
let selecting: (() => void) | null = null;

function rust(cmd: string, args: unknown): Promise<unknown> | undefined {
  const a = args as Record<string, unknown> | undefined;
  if (cmd === 'watch_list') return Promise.resolve({ titles: [], progress: [] });
  if (cmd === 'watch_put_progress') for (const row of a?.rows as { position: number }[]) written.push({ profile: active, position: row.position });
  return undefined;
}

beforeEach(async () => {
  active = 'parent';
  written = [];
  selecting = null;
  vi.stubGlobal('window', new EventTarget());
  mocked.mockReset();
  mocked.mockImplementation(async (cmd, args) => {
    if (cmd === 'profile_select') {
      await new Promise<void>((resolve) => (selecting = resolve));
      active = (args as { id: string }).id;
      return undefined;
    }
    return rust(cmd, args);
  });
  vi.mocked(flushStremioSync).mockClear();
  await loadWatch();
});
afterEach(() => vi.unstubAllGlobals());

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('switching profile while something plays', () => {
  it('saves where the player got to in the profile that was watching, before the switch', async () => {
    recordProgress(movie, undefined, 100, 1000);
    // The player's periodic save was a while ago: it saves the rest as the profile is left.
    const leaving = () => recordProgress(movie, undefined, 112, 1000);
    window.addEventListener(LEAVING_PROFILE, leaving);
    const switching = switchProfile('kid');
    await settle();
    selecting?.();
    await switching;
    await settle();
    window.removeEventListener(LEAVING_PROFILE, leaving);
    expect(written).toEqual([
      { profile: 'parent', position: 100 },
      { profile: 'parent', position: 112 },
    ]);
  });

  it('writes nothing into the new profile from a save made as the switch goes through', async () => {
    const switching = switchProfile('kid');
    await settle();
    recordProgress(movie, undefined, 300, 1000);
    selecting?.();
    await switching;
    // The player's throttled save comes due (or it stops) before the window starts over.
    recordProgress(movie, undefined, 315, 1000);
    await settle();
    expect(written.filter((w) => w.profile === 'kid')).toEqual([]);
  });

  it('keeps saving to the same profile when the switch is refused (a wrong PIN)', async () => {
    mocked.mockImplementation(async (cmd, args) => {
      if (cmd === 'profile_select') throw new Error('err.pin.wrong');
      return rust(cmd, args);
    });
    await expect(switchProfile('kid', '0000')).rejects.toThrow('err.pin.wrong');
    recordProgress(movie, undefined, 400, 1000);
    await settle();
    expect(written.at(-1)).toEqual({ profile: 'parent', position: 400 });
  });

  it("sends Stremio what's waiting before the switch", async () => {
    const switching = switchProfile('kid');
    await settle();
    expect(flushStremioSync).toHaveBeenCalled();
    selecting?.();
    await switching;
  });
});
