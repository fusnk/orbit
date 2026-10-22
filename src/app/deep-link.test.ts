import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({ kind: 'addon', url: 'https://a.example/manifest.json' })) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));
vi.mock('../i18n', () => ({ t: (key: string) => key }));
vi.mock('../rooms/addons/install', () => ({ ADDON_LINK: 'orbit:addon-link' }));
vi.mock('./errors', () => ({ reportError: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { startDeepLinks } from './deep-link';
import { setSetupOpen } from './onboarding/gate';
import { setPlayerOpen } from './player-gate';
import { toast } from '../components/toast';

describe('install links', () => {
  it("open the Addons page at its root, where the review is, even if a title page was left open on it", async () => {
    const panel = new EventTarget();
    const received: unknown[] = [];
    panel.addEventListener('orbit:addon-link', (event) => received.push((event as CustomEvent).detail));
    vi.stubGlobal('document', { querySelector: () => panel });
    const go = vi.fn();

    startDeepLinks(go);
    await vi.waitFor(() => expect(received).toEqual(['https://a.example/manifest.json']));
    expect(go).toHaveBeenCalledWith('addons', { root: true });
    vi.unstubAllGlobals();
  });

  it('wait while first-run setup is open, and open once it ends', async () => {
    const panel = new EventTarget();
    const received: unknown[] = [];
    panel.addEventListener('orbit:addon-link', (event) => received.push((event as CustomEvent).detail));
    vi.stubGlobal('document', { querySelector: () => panel });
    vi.mocked(invoke).mockClear();
    const go = vi.fn();

    setSetupOpen(true);
    startDeepLinks(go);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Not even taken from Rust: it waits there (through setup's reload for a new language) until setup is done.
    expect(invoke).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();

    setSetupOpen(false);
    await vi.waitFor(() => expect(received).toEqual(['https://a.example/manifest.json']));
    expect(go).toHaveBeenCalledWith('addons', { root: true });
    vi.unstubAllGlobals();
  });

  it('wait while a video plays, say so, and open once the player closes', async () => {
    const panel = new EventTarget();
    const received: unknown[] = [];
    panel.addEventListener('orbit:addon-link', (event) => received.push((event as CustomEvent).detail));
    vi.stubGlobal('document', { querySelector: () => panel });
    vi.mocked(invoke).mockClear();
    vi.mocked(toast).mockClear();
    const go = vi.fn();

    setPlayerOpen(true);
    startDeepLinks(go);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The video plays on; the link stays in Rust until the player closes.
    expect(invoke).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('deeplink.after-video');

    setPlayerOpen(false);
    await vi.waitFor(() => expect(received).toEqual(['https://a.example/manifest.json']));
    expect(go).toHaveBeenCalledWith('addons', { root: true });
    vi.unstubAllGlobals();
  });
});
