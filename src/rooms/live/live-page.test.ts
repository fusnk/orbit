import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TvChannel, TvGroups } from '../../live/iptv';

/** Just enough of an element for the page: children, `contains`, events. */
class FakeEl extends EventTarget {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  hidden = false;
  textContent = '';
  value = '';
  dataset: Record<string, string> = {};
  style = { setProperty() {} };
  classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  constructor(readonly className = '') {
    super();
  }
  replaceChildren(...kids: unknown[]): void {
    for (const kid of this.children) kid.parent = null;
    this.children = [];
    this.append(...kids);
  }
  append(...kids: unknown[]): void {
    for (const kid of kids) {
      if (!(kid instanceof FakeEl)) continue;
      kid.parent = this;
      this.children.push(kid);
    }
  }
  contains(other: unknown): boolean {
    for (let el = other instanceof FakeEl ? other : null; el; el = el.parent) if (el === this) return true;
    return false;
  }
  /** Every element under this one, this one first. */
  all(): FakeEl[] {
    return [this, ...this.children.flatMap((kid) => kid.all())];
  }
  querySelector(): null {
    return null;
  }
  querySelectorAll(): FakeEl[] {
    return [];
  }
  closest(): null {
    return null;
  }
  focus(): void {}
  get isConnected(): boolean {
    return true;
  }
}

const el = (className = '', ...kids: unknown[]) => {
  const made = new FakeEl(className);
  made.append(...kids);
  return made;
};

const answers = vi.hoisted(() => ({ channels: null as Promise<unknown> | null, groups: null as Promise<unknown> | null, view: null as unknown }));
const grid = vi.hoisted(() => ({ render: null as null | ((shown: readonly unknown[]) => Promise<void>) }));

vi.mock('../../lib/dom', () => ({ h: (_tag: string, attrs: Record<string, unknown> = {}, ...kids: unknown[]) => el(String(attrs.class ?? ''), ...kids) }));
vi.mock('../../i18n', () => ({ locale: () => 'en', t: (key: string) => key, tn: (key: string) => key }));
vi.mock('../profiles/parental', () => ({ gateLiveTv: (_ctx: unknown, build: () => unknown) => build() }));
vi.mock('../../app/router', () => ({ VIEW_SHOWN: 'orbit:view-shown', VIEW_DISCARDED: 'orbit:view-discarded' }));
vi.mock('../../components/icons', () => ({ icon: () => el() }));
vi.mock('../../components/menu', () => ({ withContextMenu: (button: unknown) => button }));
vi.mock('../../components/text-field', () => ({ createTextField: () => el('text-field') }));
vi.mock('../../components/toast', () => ({ toast: vi.fn() }));
vi.mock('../../components/state-message', () => ({ errorState: () => el('error-state'), errorText: () => '', stateMessage: () => el('state-message') }));
vi.mock('../../lib/ipc', () => ({ settings: { get: async (key: string) => (key === 'live.view' ? answers.view : null), set: async () => {} } }));
vi.mock('../../library/profiles', () => ({ activeProfileId: async () => 'main' }));
vi.mock('../../live/iptv', () => ({
  GROUP_ERRORS: { noPin: 'no-pin', pinNeeded: 'pin-needed' },
  TV_SOURCES_CHANGED: 'orbit:tv-sources',
  channelAddress: () => '',
  lockTvGroups: vi.fn(),
  onTvUpdated: () => new Promise(() => {}),
  refreshStaleTvSources: async () => {},
  replayAddress: () => '',
  setTvFavourite: vi.fn(),
  setTvFavouriteOrder: vi.fn(),
  setTvGroup: vi.fn(),
  setTvGroupOrder: vi.fn(),
  tvChannels: () => answers.channels,
  tvGroups: () => answers.groups,
  tvGuide: async () => [],
  unlockTvGroups: vi.fn(),
}));
vi.mock('../player', () => ({ openPlayer: vi.fn() }));
vi.mock('../settings', () => ({ openSettingsTo: vi.fn() }));
vi.mock('../search', () => ({ searchNextFor: vi.fn() }));
vi.mock('../settings/playback', () => ({ choices: () => el('choices') }));
vi.mock('./favourites-order', () => ({ enableDrag: () => {}, reorderControls: () => ({ grip: el(), buttons: el() }) }));
vi.mock('./guide-grid', () => ({ createGuideGrid: () => ({ element: el('guide'), render: (shown: readonly unknown[]) => grid.render?.(shown) ?? Promise.resolve(), tick: () => {}, scrollToNow: async () => {} }) }));
vi.mock('./groups', () => ({ groupEditor: () => [], lockPrompt: () => el('live-locked') }));
vi.mock('./live.css', () => ({}));

vi.stubGlobal('document', Object.assign(new EventTarget(), { activeElement: null, hidden: false }));
vi.stubGlobal('window', { setInterval: () => 0, clearInterval: () => {} });
vi.stubGlobal('HTMLElement', FakeEl);
vi.stubGlobal('CSS', { escape: (text: string) => text });

const { liveRoom } = await import('./index');

const channel = (key: string): TvChannel => ({ source: 's', key, name: key, logo: null, group: 'News', favourite: false, rank: null, listed: true, archive: 0 });
const groups: TvGroups = { groups: [{ name: 'News', count: 2, hidden: false, locked: false }], unlocked: false, pinSet: false };
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  grid.render = null;
});

describe('the Live TV page', () => {
  it('opening on the guide shows nothing about hidden groups while the channels are still loading', async () => {
    let loaded!: (channels: TvChannel[]) => void;
    answers.channels = new Promise((resolve) => (loaded = resolve));
    answers.groups = Promise.resolve(groups);
    answers.view = 'guide';
    const rendered: unknown[][] = [];
    grid.render = async (shown) => void rendered.push([...shown]);
    const page = liveRoom.render({ go: vi.fn(), back: vi.fn() } as never) as unknown as FakeEl;
    await settle();
    // The saved view (the guide) is known before the channels are: "No channels to show" isn't true yet.
    expect(page.all().some((e) => e.className === 'state-message')).toBe(false);
    loaded([channel('a'), channel('b')]);
    await settle();
    expect(page.all().some((e) => e.className === 'state-message')).toBe(false);
    expect(rendered.at(-1)).toHaveLength(2);
  });
});
