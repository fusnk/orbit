import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Just enough of an element for Quick settings: a tree with attributes, text, focus and listeners. */
class FakeEl extends EventTarget {
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  hidden = false;
  textContent = '';
  isConnected = true;
  classes = new Set<string>();
  classList = { add: (name: string) => void this.classes.add(name) };
  constructor(readonly tag: string) {
    super();
  }
  setAttribute(name: string, value: string): void {
    if (name === 'hidden') this.hidden = true;
    else if (name === 'class') value.split(' ').forEach((c) => this.classes.add(c));
    else this.attrs[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  append(...nodes: (FakeEl | string)[]): void {
    for (const node of nodes) {
      if (typeof node === 'string') {
        this.textContent += node;
        continue;
      }
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: (FakeEl | string)[]): void {
    this.children = [];
    this.append(...nodes);
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
    this.isConnected = false;
  }
  contains(other: unknown): boolean {
    for (let el = other instanceof FakeEl ? other : null; el; el = el.parent) if (el === this) return true;
    return false;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  focus(): void {
    doc.activeElement = this;
  }
  click(): void {
    this.dispatchEvent(new Event('click'));
  }
  /** Every element below this one, depth first. */
  all(): FakeEl[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
}

const saved = new Map<string, unknown>();
const writes: [string, unknown][] = [];
const failWrites = { on: false };
const history = { paused: false, listeners: [] as (() => void)[] };
const backs: (() => void)[] = [];

vi.mock('./back', () => ({
  onBack: (close: () => void) => {
    backs.push(close);
    return () => void backs.splice(backs.indexOf(close), 1);
  },
}));
vi.mock('./errors', () => ({ reportError: () => {} }));
vi.mock('../components/icons', () => ({ icon: () => new FakeEl('svg') }));
vi.mock('../components/layers', () => ({ pushLayer: () => () => {} }));
vi.mock('../components/menu', () => ({ placeMenu: () => ({ left: 10, top: 20 }) }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));
vi.mock('../components/state-message', () => ({ errorText: () => 'error' }));
vi.mock('../i18n', () => ({ t: (key: string) => key, isRtl: () => false, locale: () => 'en' }));
vi.mock('../lib/dom', () => ({
  h: (tag: string, attrs: Record<string, string | boolean> = {}, ...children: (FakeEl | string)[]) => {
    const el = new FakeEl(tag);
    for (const [name, value] of Object.entries(attrs)) if (value !== false) el.setAttribute(name, value === true ? '' : value);
    el.append(...children);
    return el;
  },
}));
vi.mock('../lib/ipc', () => ({
  settings: {
    get: async (key: string) => saved.get(key),
    set: async (key: string, value: unknown) => {
      if (failWrites.on) throw new Error('disk full');
      writes.push([key, value]);
      saved.set(key, value);
    },
  },
}));
vi.mock('../library/history-pause', () => ({
  historyPaused: () => history.paused,
  setHistoryPaused: vi.fn(async (on: boolean) => {
    if (failWrites.on) throw new Error('disk full');
    history.paused = on;
    history.listeners.forEach((l) => l());
  }),
  onHistoryPauseChange: (listener: () => void) => {
    history.listeners.push(listener);
    return () => void history.listeners.splice(history.listeners.indexOf(listener), 1);
  },
}));
vi.mock('../library/profiles', () => ({ activeProfileId: async () => null, listProfiles: async () => [] }));
vi.mock('../library/jellyfin', () => ({ isJellyfinId: () => false }));
vi.mock('../library/plex', () => ({ isPlexId: () => false }));
vi.mock('../rooms/player/layout', () => ({ loadPlayerLayout: async () => ({}) }));
vi.mock('../rooms/profiles/picker', () => ({ avatar: () => new FakeEl('span'), openProfileSwitcher: async () => {} }));
vi.mock('../rooms/settings/looks', () => ({ lookMiniature: () => new FakeEl('span') }));
vi.mock('../rooms/settings/playback', () => ({ choices: () => new FakeEl('div'), pressChoice: () => {}, save: async () => {} }));
vi.mock('../theme/appearance', () => ({ appearance: () => ({ rowStyle: 'poster' }), effectsReduced: () => false, ROW_STYLE_CHANGED: 'row-style', setAppearance: async () => {} }));
vi.mock('../theme/looks', () => ({ activeLook: () => undefined, applyLook: async () => {}, LOOKS: [] }));
vi.mock('./connect-state', () => ({ connectState: () => ({ running: false }), startConnect: async () => {}, stopConnect: async () => {} }));
vi.mock('./remote-status', () => ({ remoteStatus: async () => ({ running: false }), startRemote: async () => {}, stopRemote: async () => {} }));

const { toast } = await import('../components/toast');
const { setHistoryPaused } = await import('../library/history-pause');
const { createHistoryChip, openQuickSettings, toggleHistoryPause } = await import('./quick-settings');
const { HERO_TRAILER_KEY, BANNER_TRAILER_KEY } = await import('../rooms/detail/trailer-settings');
const { SKIP_MODES_KEY } = await import('../rooms/player/skip');

let doc: EventTarget & { activeElement: unknown; body: FakeEl };

/** Opens Quick settings under a title-bar button, and waits for its rows to read their settings. */
async function open() {
  const anchor = new FakeEl('button');
  openQuickSettings(anchor as unknown as HTMLElement, () => {}, () => {}, () => {}, () => {}, () => {});
  // The scrim and the panel go at the end of the page.
  const panel = doc.body.children.at(-1)!;
  await new Promise((resolve) => setTimeout(resolve, 0));
  /** The on/off row labelled `label`. */
  const row = (label: string) => panel.all().find((el) => el.attrs.role === 'switch' && el.children[0]?.textContent === label)!;
  return { anchor, panel, row };
}

beforeEach(() => {
  doc = Object.assign(new EventTarget(), { activeElement: null as unknown, body: new FakeEl('body') });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLElement', FakeEl);
  vi.stubGlobal('Node', FakeEl);
  vi.stubGlobal('CSS', { escape: (s: string) => s });
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 720);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  saved.clear();
  writes.length = 0;
  failWrites.on = false;
  history.paused = false;
  history.listeners.length = 0;
  backs.length = 0;
  vi.mocked(toast).mockClear();
  vi.mocked(setHistoryPaused).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pausing watch history', () => {
  it('turns pausing on and says so, then off again', async () => {
    await toggleHistoryPause();
    expect(setHistoryPaused).toHaveBeenLastCalledWith(true);
    expect(toast).toHaveBeenLastCalledWith('quick.paused');
    await toggleHistoryPause();
    expect(setHistoryPaused).toHaveBeenLastCalledWith(false);
    expect(toast).toHaveBeenLastCalledWith('quick.resumed');
  });

  it('says a save failed rather than that it paused', async () => {
    failWrites.on = true;
    await toggleHistoryPause();
    expect(toast).toHaveBeenCalledWith('settings.common.save-failed');
    expect(toast).not.toHaveBeenCalledWith('quick.paused');
  });

  it('shows the title-bar chip only while paused, and opens Quick settings from it', async () => {
    const opened = vi.fn();
    const chip = createHistoryChip(opened) as unknown as FakeEl;
    expect(chip.hidden).toBe(true);
    await toggleHistoryPause();
    expect(chip.hidden).toBe(false);
    chip.click();
    expect(opened).toHaveBeenCalledWith(chip);
  });
});

describe('Quick settings’ switches', () => {
  it('opens with focus on the pause switch, which isn’t changed by it', async () => {
    const { anchor, row } = await open();
    expect(anchor.getAttribute('aria-expanded')).toBe('true');
    expect(doc.activeElement).toBe(row('quick.pause-history'));
    expect(setHistoryPaused).not.toHaveBeenCalled();
  });

  it('turns intros and recaps to skip automatically, leaving credits as they were', async () => {
    saved.set(SKIP_MODES_KEY, { intro: 'button', recap: 'off', credits: 'auto', preview: 'button' });
    const { row } = await open();
    const skip = row('quick.skip-intros');
    expect(skip.getAttribute('aria-checked')).toBe('false');
    skip.click();
    expect(skip.getAttribute('aria-checked')).toBe('true');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual([SKIP_MODES_KEY, { intro: 'auto', recap: 'auto', credits: 'auto', preview: 'button' }]);
  });

  it('reads the older single switch when no modes are saved', async () => {
    saved.set('playback.auto-skip', true);
    const { row } = await open();
    expect(row('quick.skip-intros').getAttribute('aria-checked')).toBe('true');
  });

  it('shows what’s true again after a failed save', async () => {
    const { row } = await open();
    const skip = row('quick.skip-intros');
    failWrites.on = true;
    skip.click();
    expect(skip.getAttribute('aria-checked')).toBe('true');
    await vi.waitFor(() => expect(skip.getAttribute('aria-checked')).toBe('false'));
    expect(toast).toHaveBeenCalledWith('settings.common.save-failed');
  });

  it('says when only one of the two trailer settings is on, and turns on both', async () => {
    saved.set(HERO_TRAILER_KEY, true);
    saved.set(BANNER_TRAILER_KEY, false);
    const { panel, row } = await open();
    const trailers = row('quick.trailers');
    const partly = panel.all().find((el) => el.textContent === 'quick.trailers-partly')!;
    expect(trailers.getAttribute('aria-checked')).toBe('false');
    expect(partly.hidden).toBe(false);
    trailers.click();
    await vi.waitFor(() => expect(partly.hidden).toBe(true));
    expect(writes).toEqual(expect.arrayContaining([[HERO_TRAILER_KEY, true], [BANNER_TRAILER_KEY, true]]));
    expect(trailers.getAttribute('aria-checked')).toBe('true');
  });

  it('follows a pause made elsewhere (Ctrl+K) while open', async () => {
    const { row } = await open();
    await toggleHistoryPause();
    expect(row('quick.pause-history').getAttribute('aria-checked')).toBe('true');
  });
});

describe('closing Quick settings', () => {
  it('closes with Back and gives focus back', async () => {
    const before = new FakeEl('button');
    doc.body.append(before);
    doc.activeElement = before;
    const { anchor } = await open();
    expect(backs).toHaveLength(1);
    backs[0]!();
    expect(anchor.getAttribute('aria-expanded')).toBe('false');
    expect(doc.body.children).toEqual([before]);
    expect(doc.activeElement).toBe(before);
    expect(backs).toHaveLength(0);
  });

  it('closes at a click outside, not inside', async () => {
    const { anchor, panel, row } = await open();
    const inside = new Event('pointerdown');
    Object.defineProperty(inside, 'target', { value: row('quick.trailers') });
    // The listener is on the capture phase; a fake document has one phase only.
    doc.dispatchEvent(inside);
    expect(panel.isConnected).toBe(true);
    doc.dispatchEvent(new Event('pointerdown'));
    expect(panel.isConnected).toBe(false);
    expect(anchor.getAttribute('aria-expanded')).toBe('false');
  });

  it('stops following the pause once closed', async () => {
    await open();
    expect(history.listeners).toHaveLength(1);
    backs[0]!();
    expect(history.listeners).toHaveLength(0);
  });
});
