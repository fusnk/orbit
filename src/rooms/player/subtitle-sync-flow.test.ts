import { beforeEach, describe, expect, it, vi } from 'vitest';

const tickets: number[] = [];
const replies: { resolve(value: unknown): void; reject(reason: unknown): void }[] = [];
const progress: ((e: { payload: { ticket: number; stage: 'reading' | 'listening' | 'aligning'; progress: number | null } }) => void)[] = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string, args?: { ticket?: number }) => {
    if (cmd !== 'player_sync_subtitle') return Promise.resolve(null);
    tickets.push(args?.ticket ?? -1);
    return new Promise((resolve, reject) => replies.push({ resolve, reject }));
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, handler: (typeof progress)[number]) => {
    progress.push(handler);
    return () => {};
  }),
}));

import { invoke } from '@tauri-apps/api/core';
import { createSubtitleSync } from './subtitle-sync';
import type { TrackInfo } from './tracks';

const sub = (id: number, external: boolean, selected: boolean): TrackInfo => ({ id, kind: 'sub', title: null, lang: 'en', codec: 'subrip', channels: null, selected, secondary: false, external, default: false, forced: false });
const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd).length;

describe('syncing by itself', () => {
  beforeEach(() => vi.mocked(invoke).mockClear());

  it('leaves a translation alone: it has its source’s timing', () => {
    const sync = createSubtitleSync({ changed: () => {}, applied: () => {}, say: () => {} });
    sync.setAuto(true);
    sync.skip(6);
    sync.tracks([sub(5, true, false), sub(6, true, true)]);
    expect(calls('player_sync_subtitle')).toBe(0);
    expect(sync.state().kind).toBe('idle');
  });

  it('stops a sync it started on a translation listed before its result arrived', () => {
    const sync = createSubtitleSync({ changed: () => {}, applied: () => {}, say: () => {} });
    sync.setAuto(true);
    sync.tracks([sub(5, true, false), sub(6, true, true)]);
    expect(sync.state().kind).toBe('running');
    sync.skip(6);
    expect(sync.state().kind).toBe('idle');
    expect(calls('player_sync_cancel')).toBe(1);
  });

  it('keeps a sync of another subtitle going', () => {
    const sync = createSubtitleSync({ changed: () => {}, applied: () => {}, say: () => {} });
    sync.setAuto(true);
    sync.tracks([sub(5, true, true)]);
    sync.skip(6);
    expect(sync.state().kind).toBe('running');
    expect(calls('player_sync_cancel')).toBe(0);
  });
});

describe('a subtitle picked while a sync runs', () => {
  beforeEach(() => vi.mocked(invoke).mockClear());

  it('is synced by itself once the sync before it ends', async () => {
    const sync = createSubtitleSync({ changed: () => {}, applied: () => {}, say: () => {} });
    sync.setAuto(true);
    sync.tracks([sub(5, true, true)]);
    // Another addon subtitle is picked: the sync running is for the one before.
    sync.tracks([sub(5, true, false), sub(7, true, true)]);
    expect(calls('player_sync_subtitle')).toBe(1);
    // Rust drops the old one's copy, as it no longer shows.
    replies.at(-1)!.reject('cancelled');
    await vi.waitFor(() => expect(calls('player_sync_subtitle')).toBe(2));
    expect(sync.state().kind).toBe('running');
  });

  it('is left alone when it was synced already, or is the video’s own', async () => {
    const sync = createSubtitleSync({ changed: () => {}, applied: () => {}, say: () => {} });
    sync.setAuto(true);
    sync.tracks([sub(5, true, true)]);
    sync.tracks([sub(5, true, false), sub(2, false, true)]);
    replies.at(-1)!.reject('cancelled');
    await Promise.resolve();
    await Promise.resolve();
    expect(calls('player_sync_subtitle')).toBe(1);
    expect(sync.state().kind).toBe('idle');
  });
});

describe('a sync’s progress', () => {
  it('shows only the running sync’s, not a cancelled one’s from the file before', () => {
    const sync = createSubtitleSync({ changed: () => {}, applied: () => {}, say: () => {} });
    sync.setAuto(true);
    sync.tracks([sub(5, true, true)]);
    const old = tickets.at(-1)!;
    // The next episode: the old run is cancelled and its subtitle synced anew.
    sync.newFile();
    sync.tracks([sub(3, true, true)]);
    const mine = tickets.at(-1)!;
    expect(old).not.toBe(mine);
    const emit = progress.at(-1)!;
    emit({ payload: { ticket: old, stage: 'listening', progress: 0.4 } });
    expect(sync.state()).toEqual({ kind: 'running', stage: 'reading', progress: null });
    emit({ payload: { ticket: mine, stage: 'aligning', progress: null } });
    expect(sync.state()).toEqual({ kind: 'running', stage: 'aligning', progress: null });
  });
});
