import { beforeEach, describe, expect, it, vi } from 'vitest';

const privacy = vi.hoisted(() => ({ paused: false, limited: false }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));
vi.mock('../../library/history-pause', () => ({ historyPaused: () => privacy.paused }));
vi.mock('../../catalog/parental', () => ({ limited: () => privacy.limited }));

import { invoke } from '@tauri-apps/api/core';
import { BUTTON_KEYS, createMediaKeyGate, createMediaSession, isMediaButton, mediaGroup, mediaInfo, runMediaSeek, SAME_PRESS_MS, unnamed, type NowPlaying } from './media-session';

const playing: NowPlaying = { title: 'Secret Show', detail: 'S1 · E2 · Pilot', poster: 'https://img.example/p.jpg', local: false, canNext: true, canPrevious: false };
const sent = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'media_controls_set').map(([, args]) => (args as { playing: unknown }).playing);

beforeEach(() => {
  privacy.paused = false;
  privacy.limited = false;
  vi.mocked(invoke).mockClear();
});

describe('what the flyout shows', () => {
  it('names the title, episode and poster normally', () => {
    expect(mediaInfo(playing, false)).toEqual({ title: 'Secret Show', subtitle: 'S1 · E2 · Pilot', poster: 'https://img.example/p.jpg', canNext: true, canPrevious: false });
  });

  it('says only "Orbit" while watch history is paused, keeping the buttons', () => {
    privacy.paused = true;
    createMediaSession().update(playing);
    expect(sent()).toEqual([{ title: 'Orbit', subtitle: null, poster: null, canNext: true, canPrevious: false }]);
  });

  it('says only "Orbit" on a profile with a content limit', () => {
    privacy.limited = true;
    createMediaSession().update(playing);
    expect(JSON.stringify(sent())).not.toContain('Secret');
    expect(JSON.stringify(sent())).not.toContain('img.example');
  });

  it('never names a file from this PC', () => {
    expect(mediaInfo({ ...playing, local: true }, false)).toMatchObject({ title: 'Orbit', subtitle: null, poster: null });
  });

  it('never names a pasted link (its name comes from the address) or a file from this PC', () => {
    expect(unnamed({ link: true })).toBe(true);
    expect(unnamed({ local: true })).toBe(true);
    expect(unnamed({})).toBe(false);
  });

  it('hides the title as soon as history is paused mid-film, and tells Rust only about changes', () => {
    const session = createMediaSession();
    session.update(playing);
    session.update(playing);
    privacy.paused = true;
    session.update(playing);
    session.update(playing);
    expect(sent().map((s) => (s as { title: string }).title)).toEqual(['Secret Show', 'Orbit']);
  });

  it('clears once, and only after showing something', () => {
    const session = createMediaSession();
    session.clear();
    session.update(playing);
    session.clear();
    session.clear();
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'media_controls_clear')).toHaveLength(1);
  });
});

describe('media buttons', () => {
  it('run as the player’s own media keys', () => {
    expect(BUTTON_KEYS).toEqual({ play: 'MediaPlay', pause: 'MediaPause', next: 'MediaTrackNext', previous: 'MediaTrackPrevious' });
    expect(isMediaButton('next')).toBe(true);
    expect(isMediaButton('toString')).toBe(false);
    expect(isMediaButton(3)).toBe(false);
  });

  it('group play, pause and play/pause together', () => {
    expect(['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop'].map(mediaGroup)).toEqual(['playback', 'playback', 'playback', 'playback']);
    expect(mediaGroup('MediaTrackNext')).toBe('next');
    expect(mediaGroup('a')).toBeNull();
  });
});

describe('one press arriving twice', () => {
  it('lets the first delivery through and drops the other source’s copy', () => {
    let now = 1000;
    const gate = createMediaKeyGate(() => now);
    expect(gate.pass('playback', 'key')).toBe(true);
    now += 30;
    expect(gate.pass('playback', 'system')).toBe(false);
    // Either order.
    now += 1000;
    expect(gate.pass('next', 'system')).toBe(true);
    expect(gate.pass('next', 'key')).toBe(false);
  });

  it('never drops presses from one source, or a later press', () => {
    let now = 0;
    const gate = createMediaKeyGate(() => now);
    expect(gate.pass('playback', 'key')).toBe(true);
    now += 50;
    expect(gate.pass('playback', 'key')).toBe(true);
    now += SAME_PRESS_MS;
    expect(gate.pass('playback', 'system')).toBe(true);
    expect(gate.pass('next', 'key')).toBe(true);
  });
});

describe('seeks from the desktop’s media controls', () => {
  const player = (state: { locked?: boolean; live?: boolean } = {}) => ({ locked: false, live: false, ...state, seekBy: vi.fn(), seekTo: vi.fn() });

  it('run as the player’s own seeks', () => {
    const p = player();
    runMediaSeek({ seconds: -10, relative: true }, p);
    runMediaSeek({ seconds: 61.5, relative: false }, p);
    expect(p.seekBy).toHaveBeenCalledWith(-10);
    expect(p.seekTo).toHaveBeenCalledWith(61.5);
  });

  it('do nothing while the player is locked', () => {
    const p = player({ locked: true });
    runMediaSeek({ seconds: 10, relative: true }, p);
    runMediaSeek({ seconds: 10, relative: false }, p);
    expect(p.seekBy).not.toHaveBeenCalled();
    expect(p.seekTo).not.toHaveBeenCalled();
  });

  it('never jump to a time in Live TV, as the phone remote can’t', () => {
    const p = player({ live: true });
    runMediaSeek({ seconds: 600, relative: false }, p);
    runMediaSeek({ seconds: 10, relative: true }, p);
    expect(p.seekTo).not.toHaveBeenCalled();
    expect(p.seekBy).toHaveBeenCalledWith(10);
  });

  it('ignore anything that isn’t a seek', () => {
    const p = player();
    for (const junk of [null, 'seek', { seconds: Number.NaN, relative: true }, { seconds: -1, relative: false }, { seconds: 5 }, { seconds: Infinity, relative: true }]) runMediaSeek(junk, p);
    expect(p.seekBy).not.toHaveBeenCalled();
    expect(p.seekTo).not.toHaveBeenCalled();
  });
});
