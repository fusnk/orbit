import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/fun-settings', () => ({ funPrefs: () => ({ quips: true, hints: true }) }));
vi.mock('../i18n', () => ({ t: (key: string) => key }));

import { rotateSearchHints } from './fun-lines';

describe('rotateSearchHints', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rests while the window is minimised or in the tray', () => {
    vi.useFakeTimers();
    const page = { hidden: true, activeElement: null };
    vi.stubGlobal('document', page);
    vi.stubGlobal('window', globalThis);
    const input = { placeholder: 'Search', value: '', isConnected: true, offsetParent: {}, classList: { add: vi.fn(), remove: vi.fn() } };
    rotateSearchHints(input as unknown as HTMLInputElement);
    // The search page is kept on screen under a hidden window: nothing changes nobody can see.
    vi.advanceTimersByTime(60_000);
    expect(input.classList.add).not.toHaveBeenCalled();
    expect(input.placeholder).toBe('Search');
    page.hidden = false;
    vi.advanceTimersByTime(4000);
    expect(input.placeholder).not.toBe('Search');
  });
});
