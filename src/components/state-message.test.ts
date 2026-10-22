import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null }));
// Tests run without a DOM: the window is an EventTarget, and the connection starts lost.
const win = new EventTarget();
vi.stubGlobal('window', win);
vi.stubGlobal('navigator', { onLine: false, userAgent: '' });

const { classify, retryWhenOnline, rowErrorHidden } = await import('./state-message');
const { VIEW_DISCARDED, VIEW_SHOWN } = await import('../app/router');

/** A failed page's message (`owner`) inside a kept view, which the router takes off the page while another shows. */
function keptView() {
  const view = Object.assign(new EventTarget(), { parentNode: null });
  const owner = Object.assign(new EventTarget(), { parentNode: view, isConnected: true, closest: () => null });
  return { view, owner };
}

describe('retryWhenOnline', () => {
  it('retries at once when the connection comes back on the page', () => {
    const { owner } = keptView();
    const retry = vi.fn();
    retryWhenOnline(owner as unknown as Element, retry);
    win.dispatchEvent(new Event('online'));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('retries a view that was off the page then, once it shows again', () => {
    const { view, owner } = keptView();
    const retry = vi.fn();
    retryWhenOnline(owner as unknown as Element, retry);
    owner.isConnected = false;
    win.dispatchEvent(new Event('online'));
    expect(retry).not.toHaveBeenCalled();
    owner.isConnected = true;
    view.dispatchEvent(new Event(VIEW_SHOWN));
    view.dispatchEvent(new Event(VIEW_SHOWN));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('lets go of a view dropped before it showed again', () => {
    const { view, owner } = keptView();
    const retry = vi.fn();
    retryWhenOnline(owner as unknown as Element, retry);
    owner.isConnected = false;
    win.dispatchEvent(new Event('online'));
    view.dispatchEvent(new Event(VIEW_DISCARDED));
    owner.isConnected = true;
    view.dispatchEvent(new Event(VIEW_SHOWN));
    expect(retry).not.toHaveBeenCalled();
  });
});

describe('retryWhenOnline while the connection seems up', () => {
  // navigator.onLine says online when the router is up but the internet isn't: a timer retries too.
  let clock = Date.now();
  beforeEach(() => {
    vi.useFakeTimers();
    // Long after any earlier retry, so the backoff starts over.
    clock += 60 * 60_000;
    vi.setSystemTime(clock);
    (navigator as { onLine: boolean }).onLine = true;
  });
  afterEach(() => {
    vi.useRealTimers();
    (navigator as { onLine: boolean }).onLine = false;
  });

  it('retries on a timer, once', () => {
    const { owner } = keptView();
    const retry = vi.fn();
    retryWhenOnline(owner as unknown as Element, retry);
    vi.advanceTimersByTime(14_000);
    expect(retry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(retry).toHaveBeenCalledOnce();
    win.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(10 * 60_000);
    expect(retry).toHaveBeenCalledOnce();
  });

  it('waits longer each time it retries again', () => {
    const first = vi.fn();
    retryWhenOnline(keptView().owner as unknown as Element, first);
    vi.advanceTimersByTime(15_000);
    expect(first).toHaveBeenCalledOnce();
    const second = vi.fn();
    retryWhenOnline(keptView().owner as unknown as Element, second);
    vi.advanceTimersByTime(15_000);
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(second).toHaveBeenCalledOnce();
  });

  it('off the page, waits until its view shows again', () => {
    const { view, owner } = keptView();
    const retry = vi.fn();
    retryWhenOnline(owner as unknown as Element, retry);
    owner.isConnected = false;
    vi.advanceTimersByTime(10 * 60_000);
    expect(retry).not.toHaveBeenCalled();
    owner.isConnected = true;
    view.dispatchEvent(new Event(VIEW_SHOWN));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('a row that failed', () => {
  const unreachable = () => new TypeError('Failed to fetch');

  it('keeps its box to itself while the offline banner shows', () => {
    expect(rowErrorHidden(classify(unreachable()))).toBe(true);
  });

  it('shows it once the banner is gone, even for the same failure', () => {
    (navigator as { onLine: boolean }).onLine = true;
    try {
      expect(rowErrorHidden(classify(unreachable()))).toBe(false);
    } finally {
      (navigator as { onLine: boolean }).onLine = false;
    }
  });
});
