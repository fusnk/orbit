import { beforeEach, describe, expect, it } from 'vitest';
import { addonHealth, isNoAnswer, noteAnswer, onHealthChange, resetHealth } from './health';
import type { AddonError } from './types';

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('addon health', () => {
  beforeEach(resetHealth);

  it('counts timeouts, lost connections, server errors and broken replies as no answer', () => {
    for (const error of [{ kind: 'timeout' }, { kind: 'network', message: 'x' }, { kind: 'http', status: 503 }, { kind: 'too-large', limitBytes: 1 }, { kind: 'invalid-response', issues: [] }] satisfies AddonError[]) expect(isNoAnswer(error)).toBe(true);
    // A 404 or being busy is an answer; errors made here say nothing about the addon.
    for (const error of [{ kind: 'http', status: 404 }, { kind: 'rate-limited', retryAfterSecs: null }, { kind: 'reinstall-needed' }, { kind: 'not-found' }, { kind: 'linked', owner: 'Sam' }] satisfies AddonError[]) expect(isNoAnswer(error)).toBe(false);
  });

  it('keeps each addon’s latest outcome', () => {
    expect(addonHealth('a')).toBeNull();
    noteAnswer('a', { kind: 'timeout' }, 1);
    expect(addonHealth('a')).toEqual({ answered: false, error: { kind: 'timeout' }, at: 1 });
    noteAnswer('a', null, 2);
    expect(addonHealth('a')).toEqual({ answered: true, error: null, at: 2 });
    noteAnswer('a', { kind: 'http', status: 404 }, 3);
    expect(addonHealth('a')?.answered).toBe(true);
  });

  it('tells listeners only when an addon starts or stops answering, once per batch', async () => {
    let calls = 0;
    const stop = onHealthChange(() => calls++);
    // Answers from an addon never heard from before change nothing on the page.
    noteAnswer('a', null);
    noteAnswer('a', null);
    await flush();
    expect(calls).toBe(0);
    // Two addons failing at once: one notice.
    noteAnswer('a', { kind: 'timeout' });
    noteAnswer('b', { kind: 'network', message: 'x' });
    noteAnswer('b', { kind: 'timeout' });
    await flush();
    expect(calls).toBe(1);
    noteAnswer('a', null);
    await flush();
    expect(calls).toBe(2);
    stop();
    noteAnswer('a', { kind: 'timeout' });
    await flush();
    expect(calls).toBe(2);
  });
});
