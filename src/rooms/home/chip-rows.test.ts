import { describe, expect, it, vi } from 'vitest';

// Tests run without a DOM: elements keep their attributes and children, and that's all "Only on…" needs.
class FakeEl extends EventTarget {
  hidden = false;
  children: unknown[] = [];
  constructor(public attrs: Record<string, unknown> = {}) {
    super();
    this.hidden = attrs.hidden === true;
  }
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  replaceChildren(...children: unknown[]) {
    this.children = children;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
}
vi.stubGlobal('HTMLElement', FakeEl);
vi.stubGlobal('document', Object.assign(new EventTarget(), { activeElement: null }));
vi.mock('../../lib/dom', () => ({ h: (_tag: string, attrs?: Record<string, unknown>) => new FakeEl(attrs) }));
vi.mock('../../components/icons', () => ({ icon: () => null }));
/** A rail lists its tiles' service keys; the picked service's row is named after it. */
vi.mock('../../components/cards', () => ({ rail: ({ cards }: { cards: FakeEl[] }) => cards.map((card) => card.attrs['data-service']) }));
vi.mock('./row-render', () => ({ styledRail: ({ title }: { title: string }) => Object.assign(new FakeEl(), { title }) }));
vi.mock('../streaming/service', () => ({ createServicePage: () => null }));
vi.mock('../../theme/appearance', () => ({ appearance: () => ({ rowStyle: 'poster' }), ROW_STYLE_CHANGED: 'row-style' }));
vi.mock('../../i18n', () => ({ t: (key: string, vars?: { name?: string }) => `${key}:${vars?.name ?? ''}` }));

let region = 'US';
const SERVICES: Record<string, { key: string; name: string }[]> = {
  US: [{ key: 'hulu', name: 'Hulu' }],
  GB: [{ key: 'itvx', name: 'ITVX' }],
};
vi.mock('../../catalog/streaming', () => ({ streamingRegion: async () => region, regionName: () => '', regionShortName: () => '' }));
let offline = false;
vi.mock('../../catalog/tmdb', () => ({
  streamingServices: async (code: string) => {
    if (offline) throw new Error('TMDB could not be reached');
    return SERVICES[code];
  },
  streamingCatalog: async () => [],
  tmdbSourcePage: async () => null,
}));
vi.mock('./dashboard', () => ({ HOME_SHOWN: 'home-shown' }));
vi.stubGlobal('window', new EventTarget());

const { onlyOnRow } = await import('./chip-rows');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('"Only on…"', () => {
  it('follows a change of streaming region', async () => {
    const row = onlyOnRow({ openDetail: () => {}, withMenu: (card) => card }, {} as never);
    await settle();
    const section = row as unknown as FakeEl;
    expect(section.children[0]).toEqual(['hulu']);
    region = 'GB';
    row.refresh();
    await settle();
    expect(section.children[0]).toEqual(['itvx']);
    const results = section.children[1] as FakeEl;
    expect((results.children[0] as { title: string }).title).toBe('homerows.only-on.heading:ITVX');
  });

  it('comes once TMDB answers, after the first listing failed', async () => {
    region = 'US';
    offline = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = onlyOnRow({ openDetail: () => {}, withMenu: (card) => card }, {} as never);
    await settle();
    const section = row as unknown as FakeEl;
    expect(section.hidden).toBe(true);
    // Home shown again while still offline: it tries again, and keeps trying.
    document.dispatchEvent(new Event('home-shown'));
    await settle();
    expect(section.hidden).toBe(true);
    offline = false;
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(section.hidden).toBe(false);
    expect(section.children[0]).toEqual(['hulu']);
    warn.mockRestore();
  });
});
