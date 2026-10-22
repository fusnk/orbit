import { afterEach, describe, expect, it, vi } from 'vitest';

const status = { devices: [] as unknown[], playing: null as unknown };
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) =>
    command === 'connect_remote_status'
      ? { playing: status.playing }
      : command === 'connect_control'
        ? undefined
        : { running: true, name: 'PC', kind: 'pc', code: null, expiresIn: null, locked: false, devices: status.devices, maxDevices: 8 },
  ),
}));
vi.mock('../components/drawer', () => ({ openDrawer: vi.fn() }));
vi.mock('../components/icons', () => ({ icon: () => ({}) }));
vi.mock('../components/menu', () => ({ openMenu: vi.fn(), openMenuFrom: vi.fn() }));
vi.mock('../components/state-message', () => ({ errorText: () => '' }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));
vi.mock('../i18n', () => ({ t: (key: string) => key }));
vi.mock('../lib/languages', () => ({ languageKey: () => 'und', languageName: () => '', UNKNOWN_LANGUAGE: 'und' }));
vi.mock('./router', () => ({ VIEW_DISCARDED: 'orbit:view-discarded' }));
/** Every element the panel makes, with its attributes. */
const made: { attrs: Record<string, string> }[] = [];
vi.mock('../lib/dom', () => ({
  h: (_tag: string, attrs: Record<string, unknown> = {}) => {
    const el = Object.assign(new EventTarget(), {
      attrs: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)])),
      dataset: {},
      setAttribute(name: string, value: string) {
        el.attrs[name] = value;
      },
      getAttribute: (name: string) => el.attrs[name] ?? null,
      replaceChildren() {},
    });
    made.push(el);
    return el;
  },
}));
vi.mock('../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));
vi.mock('../lib/platform', () => ({ isAndroid: false }));
vi.mock('./connect.css', () => ({}));

import { invoke } from '@tauri-apps/api/core';
import { attachPlayOn, openRemoteControl } from './connect-ui';
import { refreshConnect } from './connect-state';

const TV = { id: 'a'.repeat(32), name: 'TV', kind: 'tv', paired: true, online: true };

/** Just enough of an element: a parent, `contains`, and events. */
class FakeEl extends EventTarget {
  parentElement: FakeEl | null = null;
  hidden = false;
  constructor(private readonly classes: string[] = []) {
    super();
  }
  classList = { contains: (name: string) => this.classes.includes(name) };
  get isConnected(): boolean {
    return this.classes.includes('outlet') || (this.parentElement?.isConnected ?? false);
  }
  contains(other: FakeEl): boolean {
    for (let el: FakeEl | null = other; el; el = el.parentElement) if (el === this) return true;
    return false;
  }
  setAttribute(): void {}
}

const child = (parent: FakeEl | null) => Object.assign(new FakeEl(), { parentElement: parent });

async function devicesNow(devices: unknown[]): Promise<void> {
  status.devices = devices;
  await refreshConnect();
}

describe('Play on… buttons', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keep following the devices while their page is out of sight, and stop once it draws them again', async () => {
    vi.stubGlobal('document', new EventTarget());
    await devicesNow([TV]);
    const outlet = new FakeEl(['outlet']);
    const page = child(outlet);
    const hero = child(page);
    const button = child(hero);
    attachPlayOn(button as unknown as HTMLButtonElement, { message: () => null });
    expect(button.hidden).toBe(false);

    // Another page shown: this title page is kept, out of the outlet, and the TV goes away meanwhile.
    page.parentElement = null;
    await devicesNow([]);
    expect(button.hidden).toBe(true);
    // Back on the page, the TV is back.
    page.parentElement = outlet;
    await devicesNow([TV]);
    expect(button.hidden).toBe(false);

    // The page drew its hero again, with a button of its own: this one stops following.
    hero.parentElement = null;
    await devicesNow([]);
    expect(button.hidden).toBe(false);
  });
});

describe('the remote-control panel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does nothing for a control shown as unavailable (Next with nothing up next, seeking a live channel)', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0, clearTimeout: () => {} });
    status.playing = {
      title: 'News',
      detail: null,
      live: true,
      canNext: false,
      maxVolume: 100,
      playback: { position: null, duration: null, paused: false, buffering: false, volume: 80, muted: false },
      audio: [],
      subtitles: [],
    };
    made.length = 0;
    openRemoteControl(TV as Parameters<typeof openRemoteControl>[0]);
    const button = (label: string) => made.find((el) => el.attrs['aria-label'] === label) as unknown as EventTarget & { getAttribute(name: string): string | null };
    // Its answer is in: what's playing makes Pause available, and Next (nothing up next) and seeking (live) not.
    await vi.waitFor(() => expect(button('connect.remote.pause').getAttribute('aria-disabled')).toBe('false'));
    expect(button('connect.remote.next').getAttribute('aria-disabled')).toBe('true');
    vi.mocked(invoke).mockClear();
    for (const label of ['connect.remote.next', 'connect.remote.back', 'connect.remote.forward']) button(label).dispatchEvent(new Event('click'));
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'connect_control')).toEqual([]);
    // What is available still works.
    button('connect.remote.pause').dispatchEvent(new Event('click'));
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'connect_control')).toHaveLength(1);
  });
});
