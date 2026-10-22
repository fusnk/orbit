import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/toast', () => ({ toast: vi.fn() }));

import { createSleepTimer } from './sleep-timer';

const setup = () => createSleepTimer({ paused: () => false, pause: vi.fn(), changed: vi.fn() });

describe('the sleep timer', () => {
  it('"end of this video" is for the video it was set on: another one started by hand clears it', () => {
    const sleep = setup();
    sleep.pick('end');
    sleep.newVideo();
    expect(sleep.choice()).toBe('off');
    expect(sleep.stopsAtEnd()).toBe(false);
  });

  it('keeps a timer in minutes when another video starts', () => {
    const sleep = setup();
    sleep.pick('30');
    sleep.newVideo();
    expect(sleep.choice()).toBe('30');
  });

  it('is used up when the video it was set on ends', () => {
    const sleep = setup();
    sleep.pick('end');
    sleep.ended();
    expect(sleep.choice()).toBe('off');
  });

  it('keeps the next video from starting after the end it stopped at, until another video starts', () => {
    const sleep = setup();
    sleep.pick('end');
    sleep.ended();
    // The status that follows the end asks Next Up again: it must still be held back.
    expect(sleep.stopsAtEnd()).toBe(true);
    sleep.newVideo();
    expect(sleep.stopsAtEnd()).toBe(false);
  });

  it('runs out quietly during a pause: playing again later is not paused at once', () => {
    vi.useFakeTimers();
    try {
      let paused = false;
      const pause = vi.fn();
      const sleep = createSleepTimer({ paused: () => paused, pause, changed: vi.fn() });
      sleep.pick('15');
      sleep.check();
      paused = true;
      sleep.check();
      // No status arrives while paused; the next one is the resume, long after the timer was due.
      vi.advanceTimersByTime(60 * 60_000);
      paused = false;
      sleep.check();
      expect(pause).not.toHaveBeenCalled();
      expect(sleep.choice()).toBe('off');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still pauses when the time runs out while playing', () => {
    vi.useFakeTimers();
    try {
      const pause = vi.fn();
      const sleep = createSleepTimer({ paused: () => false, pause, changed: vi.fn() });
      sleep.pick('15');
      sleep.check();
      vi.advanceTimersByTime(15 * 60_000);
      sleep.check();
      expect(pause).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
