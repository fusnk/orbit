import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInfoPoller } from './playback-info';

afterEach(() => vi.useRealTimers());
describe('playback info polling', () => {
  it('discards a late reply after file change or disposal', async () => {
    vi.useFakeTimers();
    let complete!: (raw: Record<string, string>) => void;
    const drawn: Record<string, string>[] = [];
    const poll = createInfoPoller({ active: () => true, read: () => new Promise((resolve) => { complete = resolve; }), render: (raw) => drawn.push(raw) });
    poll.refresh();
    const old = complete;
    poll.reset();
    old({ width: 'old' });
    await Promise.resolve();
    expect(drawn).toEqual([]);
    poll.dispose();
    complete({ width: 'new' });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000);
    expect(drawn).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps one in-flight request and stops when no view or HUD needs it', async () => {
    vi.useFakeTimers();
    let active = true;
    let reads = 0;
    let finish!: (raw: Record<string, string>) => void;
    const drawn: Record<string, string>[] = [];
    const poll = createInfoPoller({ active: () => active, read: () => { reads++; return new Promise((resolve) => { finish = resolve; }); }, render: (raw) => drawn.push(raw) });
    poll.refresh(); poll.refresh();
    expect(reads).toBe(1);
    finish({ width: '1920' });
    await vi.advanceTimersByTimeAsync(0);
    expect(drawn).toEqual([{ width: '1920' }]);
    active = false;
    await vi.advanceTimersByTimeAsync(2500);
    expect(reads).toBe(1);
    poll.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('queues the latest generation behind one pending native request', async () => {
  vi.useFakeTimers();
  let reads = 0;
  const finishes: ((raw: Record<string, string>) => void)[] = [];
  const drawn: Record<string, string>[] = [];
  const poll = createInfoPoller({ active: () => true, read: () => { reads++; return new Promise((resolve) => finishes.push(resolve)); }, render: (raw) => drawn.push(raw) });
  poll.refresh(); poll.reset(); poll.reset();
  expect(reads).toBe(1);
  finishes[0]!({ width: 'obsolete' });
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toBe(2);
  expect(drawn).toEqual([]);
  finishes[1]!({ width: 'current' });
  await vi.advanceTimersByTimeAsync(0);
  expect(drawn).toEqual([{ width: 'current' }]);
  poll.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
