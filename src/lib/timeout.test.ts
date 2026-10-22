import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleWithin, TimeoutError, withTimeout } from './timeout';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const never = () => new Promise<never>(() => {});

describe('withTimeout', () => {
  it('passes a prompt answer through', async () => {
    await expect(withTimeout(Promise.resolve(3), 100)).resolves.toBe(3);
  });

  it('passes a prompt failure through', async () => {
    await expect(withTimeout(Promise.reject(new Error('no')), 100)).rejects.toThrow('no');
  });

  it('rejects with a TimeoutError once the time is up', async () => {
    const result = withTimeout(never(), 100, 'Loading');
    const check = expect(result).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await check;
  });

  it('leaves no timer behind', async () => {
    await withTimeout(Promise.resolve(1), 100);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('settleWithin', () => {
  it('falls back on a timeout and says why', async () => {
    const seen: unknown[] = [];
    const result = settleWithin(never(), 50, 'default', (err) => seen.push(err));
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toBe('default');
    expect(seen[0]).toBeInstanceOf(TimeoutError);
  });

  it('falls back on a failure', async () => {
    await expect(settleWithin(Promise.reject(new Error('x')), 50, null)).resolves.toBeNull();
  });

  it('keeps a value that arrives in time', async () => {
    await expect(settleWithin(Promise.resolve('home'), 50, 'library')).resolves.toBe('home');
  });
});
