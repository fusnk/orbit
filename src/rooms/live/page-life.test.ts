import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null }));

const { VIEW_DISCARDED } = await import('../../app/router');
const { pageLife } = await import('./page-life');

describe('the Live TV page', () => {
  it('uses only the newest load: an older answer arriving last is dropped', () => {
    const life = pageLife(new EventTarget());
    const first = life.begin();
    const second = life.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('lets go of its listeners and loads once discarded', async () => {
    const view = new EventTarget();
    const life = pageLife(view);
    const stopInterval = vi.fn();
    const unlisten = vi.fn();
    let ready!: (stop: () => void) => void;
    life.onDiscard(stopInterval);
    // Tauri's listen() hands back its unlisten later.
    life.track(new Promise<() => void>((resolve) => (ready = resolve)));
    const loading = life.begin();
    view.dispatchEvent(new Event(VIEW_DISCARDED));
    expect(stopInterval).toHaveBeenCalledTimes(1);
    expect(loading()).toBe(false);
    // Set up after the page went: stopped at once.
    ready(unlisten);
    await Promise.resolve();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    life.onDiscard(late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});
