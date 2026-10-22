import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));

import { invoke } from '@tauri-apps/api/core';
import { createPresence, presenceChanged, type Shown } from './presence';
import { parseDiscordOptions } from '../../app/discord-options';

const playing: Shown = { key: 'tt1/ep1', paused: false, end: 1000 };

describe('presenceChanged', () => {
  it('tells Discord the first time and on a new title', () => {
    expect(presenceChanged(undefined, playing)).toBe(true);
    expect(presenceChanged(playing, { ...playing, key: 'tt1/ep2' })).toBe(true);
  });

  it('tells Discord on pause and play', () => {
    expect(presenceChanged(playing, { ...playing, paused: true, end: 0 })).toBe(true);
    expect(presenceChanged({ ...playing, paused: true, end: 0 }, playing)).toBe(true);
  });

  it('ignores normal playback, but not a jump', () => {
    expect(presenceChanged(playing, { ...playing, end: 1003 })).toBe(false);
    expect(presenceChanged(playing, { ...playing, end: 1300 })).toBe(true);
    expect(presenceChanged({ ...playing, paused: true, end: 0 }, { ...playing, paused: true, end: 0 })).toBe(false);
  });
});

describe('Discord options', () => {
  it('tells Discord again when an option changes', () => {
    expect(presenceChanged({ ...playing, options: 'a' }, { ...playing, options: 'b' })).toBe(true);
  });

  it('keeps today’s behaviour for anything not saved yet', () => {
    expect(parseDiscordOptions(null)).toEqual({ hideTitle: false, whilePaused: true, whileBrowsing: true, poster: true, time: 'progress', hideOnLimited: true });
    expect(parseDiscordOptions({ time: 'sometimes', poster: false })).toMatchObject({ time: 'progress', poster: false });
  });
});

describe('a file from this PC or a pasted link', () => {
  it('clears the browsing status Discord was last told, even though this player told it nothing yet', () => {
    vi.mocked(invoke).mockClear();
    const presence = createPresence();
    presence.configure(true);
    presence.hide();
    presence.hide();
    expect(vi.mocked(invoke).mock.calls).toEqual([['discord_clear']]);
  });

  it('sends nothing while Discord sharing is off', () => {
    vi.mocked(invoke).mockClear();
    const presence = createPresence();
    presence.hide();
    expect(invoke).not.toHaveBeenCalled();
  });
});
