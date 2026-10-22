import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const answers: ('fail' | 'ok')[] = [];
const started = vi.fn();
const on = { value: true as unknown };
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === 'connect_start') {
      started();
      if (answers.shift() === 'fail') throw new Error('remote.no-network');
    }
    return { running: command === 'connect_start', name: 'PC', kind: 'pc', code: null, expiresIn: null, locked: false, devices: [], maxDevices: 8 };
  }),
}));
vi.mock('../components/state-message', () => ({ errorText: () => '' }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));
vi.mock('../i18n', () => ({ t: (key: string) => key }));
vi.mock('../lib/ipc', () => ({ settings: { get: async (key: string) => (key === 'connect.enabled' ? on.value : null), set: async () => {} } }));
vi.mock('../lib/platform', () => ({ isAndroid: false }));

import { connectState, resumeConnect, RETRY_DELAYS_MS } from './connect-state';

const win = new EventTarget();

describe('turning Connect back on at launch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('document', new EventTarget());
    vi.stubGlobal('window', Object.assign(win, { setTimeout: (run: () => void, ms: number) => setTimeout(run, ms), clearTimeout: (id: number) => clearTimeout(id) }));
    started.mockClear();
    on.value = true;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tries again, less and less often, until it starts', async () => {
    answers.push('fail', 'fail', 'ok');
    resumeConnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]!);
    expect(started).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]!);
    expect(started).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1]! - RETRY_DELAYS_MS[0]!);
    expect(started).toHaveBeenCalledTimes(3);
    expect(connectState().running).toBe(true);
    // On: no more tries.
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS.at(-1)! * 2);
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalledTimes(3);
  });

  it('tries again at once when the network comes back', async () => {
    answers.push('fail', 'ok');
    resumeConnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalledTimes(2);
  });

  it('keeps one round of tries when asked again meanwhile', async () => {
    answers.push('fail', 'ok');
    resumeConnect();
    await vi.advanceTimersByTimeAsync(0);
    // Connect stopped again after a network change it couldn't follow: the same tries go on.
    resumeConnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]!);
    expect(started).toHaveBeenCalledTimes(2);
    // Started: asked again later, it tries again.
    answers.push('ok');
    resumeConnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalledTimes(3);
  });

  it('stops trying once Connect is turned off meanwhile', async () => {
    answers.push('fail');
    resumeConnect();
    await vi.advanceTimersByTimeAsync(0);
    on.value = false;
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS.at(-1)! * 3);
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveBeenCalledTimes(1);
  });
});
