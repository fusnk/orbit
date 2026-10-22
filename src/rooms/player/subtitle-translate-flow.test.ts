import { describe, expect, it, vi } from 'vitest';

const pending: { resolve(value: unknown): void }[] = [];
const tickets: number[] = [];
const progress: ((e: { payload: { ticket: number; done: number; total: number } }) => void)[] = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string, args?: { key?: string; ticket?: number }) => {
    if (cmd === 'settings_get') return Promise.resolve(args?.key === 'subtitles.ai-translate' ? true : null);
    if (cmd === 'player_translate_subtitle') {
      tickets.push(args?.ticket ?? -1);
      return new Promise((resolve) => pending.push({ resolve }));
    }
    return Promise.resolve(null);
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, handler: (typeof progress)[number]) => {
    progress.push(handler);
    return () => {};
  }),
}));

import { createSubtitleTranslate } from './subtitle-translate';
import type { TrackInfo } from './tracks';

const sub = (id: number, external: boolean, selected: boolean): TrackInfo => ({ id, kind: 'sub', title: null, lang: 'en', codec: 'subrip', channels: null, selected, secondary: false, external, default: false, forced: false });

describe('AI subtitle translation while it runs', () => {
  it('keeps its Cancel row when the video’s own subtitle is picked meanwhile', async () => {
    const translation = createSubtitleTranslate({ changed: () => {}, say: () => {} });
    translation.tracks([sub(1, false, false), sub(5, true, true)]);
    await vi.waitFor(() => expect(translation.available()).toBe(true));
    translation.toggle();
    expect(translation.state().kind).toBe('running');
    translation.tracks([sub(1, false, true), sub(5, true, false)]);
    expect(translation.available()).toBe(true);
    // Its row still cancels.
    translation.toggle();
    expect(translation.state().kind).toBe('idle');
    expect(translation.available()).toBe(false);
  });

  it('says which track the finished translation added', async () => {
    const added: number[] = [];
    const translation = createSubtitleTranslate({ changed: () => {}, say: () => {}, added: (track) => added.push(track) });
    translation.tracks([sub(5, true, true)]);
    await vi.waitFor(() => expect(translation.available()).toBe(true));
    translation.toggle();
    pending.pop()!.resolve({ track: 6, lines: 10, kept: 0, cached: false });
    await vi.waitFor(() => expect(added).toEqual([6]));
  });

  it('shows only its own run’s progress, not a cancelled one’s', async () => {
    const translation = createSubtitleTranslate({ changed: () => {}, say: () => {} });
    translation.tracks([sub(5, true, true)]);
    await vi.waitFor(() => expect(translation.available()).toBe(true));
    translation.toggle();
    translation.toggle(); // cancelled
    translation.toggle(); // started again
    const [old, mine] = tickets.slice(-2) as [number, number];
    expect(old).not.toBe(mine);
    const emit = progress.at(-1)!;
    // The cancelled run had read its subtitle and says how many batches it has.
    emit({ payload: { ticket: old, done: 3, total: 9 } });
    expect(translation.state()).toEqual({ kind: 'running', done: 0, total: 0 });
    emit({ payload: { ticket: mine, done: 1, total: 4 } });
    expect(translation.state()).toEqual({ kind: 'running', done: 1, total: 4 });
  });
});
