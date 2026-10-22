/**
 * The chosen Look card carries a tick badge beside its pressed state, so in
 * first-run setup it isn't mistaken for the focused card (both have an
 * accent-coloured outline). The card is a button made with `h`, drawn here
 * with a stand-in element, as Quick settings' tests do.
 */
import { describe, expect, it, vi } from 'vitest';
import css from './settings.css?raw';

class FakeEl {
  attrs: Record<string, string> = {};
  children: (FakeEl | string)[] = [];
  listeners: string[] = [];
  constructor(readonly tag: string) {}
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  append(...nodes: (FakeEl | string)[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: (FakeEl | string)[]): void {
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(type: string): void {
    this.listeners.push(type);
  }
  /** Every element below this one, depth first. */
  all(): FakeEl[] {
    return this.children.flatMap((c) => (typeof c === 'string' ? [] : [c, ...c.all()]));
  }
}

vi.stubGlobal('HTMLElement', FakeEl);
vi.mock('../../components/icons', () => ({ icon: (name: string) => Object.assign(new FakeEl('svg'), { attrs: { 'data-icon': name } }) }));
vi.mock('../../components/toast', () => ({ toast: vi.fn() }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../lib/dom', () => ({
  h: (tag: string, attrs: Record<string, string | boolean> = {}, ...children: (FakeEl | string)[]) => {
    const el = new FakeEl(tag);
    for (const [name, value] of Object.entries(attrs)) if (value !== false) el.setAttribute(name, value === true ? '' : value);
    el.append(...children);
    return el;
  },
}));
vi.mock('../../lib/ipc', () => ({ SETTING_SAVED: 'setting-saved' }));
vi.mock('../player/layout', () => ({ loadPlayerLayout: async () => ({}), PLAYER_LAYOUT_KEY: 'player.layout' }));
vi.mock('./playback', () => ({ row: () => new FakeEl('div') }));
vi.mock('../../theme/looks', () => ({
  activeLook: () => LOOKS[1],
  applyLook: async () => {},
  lookBackup: async () => null,
  restoreLook: async () => true,
  LOOKS,
}));
vi.mock('../../theme/palette', () => ({ COLOR_KEYS: [], findPreset: () => undefined }));

const look = (id: string, name: string) => ({ id, name, theme: 'dark', appearance: { heroStyle: 'card', corners: 'soft' }, nav: { position: 'top', align: 'center' }, player: { preset: 'orbit' } });
const LOOKS = [look('orbit', 'Orbit'), look('crimson', 'Crimson')];

const { looksSection } = await import('./looks');

/** Waits for the section's first draw (it reads two settings first). */
const drawn = async (section: FakeEl) => {
  for (let i = 0; i < 10 && !section.children.length; i++) await new Promise((r) => setTimeout(r, 0));
  return section.all().filter((el) => el.attrs['class']?.includes('look-card') && el.tag === 'button');
};

describe('Look cards', () => {
  it('give the chosen card a tick badge beside its pressed state, and only that one', async () => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, activeElement: null });
    const section = looksSection('onboarding', () => {}) as unknown as FakeEl;
    const cards = await drawn(section);
    expect(cards.map((card) => card.attrs['aria-pressed'])).toEqual(['false', 'true']);
    const badges = cards.map((card) => card.all().filter((el) => el.attrs['class'] === 'look-card-check'));
    expect(badges.map((b) => b.length)).toEqual([0, 1]);
    const badge = badges[1]![0]!;
    expect(badge.attrs['aria-hidden']).toBe('true');
    expect(badge.all().map((el) => el.attrs['data-icon'])).toEqual(['check']);
  });

  it('draw the badge over the card, in the accent, on top of the miniature', () => {
    const rule = /\.look-card-check \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/position: absolute/);
    expect(rule).toMatch(/background: var\(--color-accent\)/);
    expect(/\.look-card \{[^}]*position: relative/.test(css)).toBe(true);
  });
});
