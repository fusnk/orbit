import { describe, expect, it, vi } from 'vitest';
import { afterSetup, playAfterSetup, setSetupOpen, setupOpen } from './gate';

describe('the setup gate', () => {
  it('runs work at once without setup, and holds it until setup ends', () => {
    const run = vi.fn();
    afterSetup(run);
    expect(run).toHaveBeenCalledTimes(1);

    setSetupOpen(true);
    expect(setupOpen()).toBe(true);
    afterSetup(run);
    afterSetup(run);
    expect(run).toHaveBeenCalledTimes(1);
    setSetupOpen(false);
    expect(run).toHaveBeenCalledTimes(3);
    // Each held piece of work runs once.
    setSetupOpen(false);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('holds a play another device asks for until setup ends, and only the newest', () => {
    const first = vi.fn();
    const second = vi.fn();
    playAfterSetup(first);
    expect(first).toHaveBeenCalledTimes(1);

    setSetupOpen(true);
    playAfterSetup(first);
    playAfterSetup(second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    setSetupOpen(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    setSetupOpen(false);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
