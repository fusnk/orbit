import { beforeEach, expect, it, vi } from 'vitest';

class FakeEl {
  dataset: Record<string, string> = {};
  hidden = false;
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  private listeners = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  dispatch(type: string) { for (const fn of this.listeners.get(type) ?? []) fn(); }
  setAttribute() {}
  focus() {}
  append(...nodes: unknown[]) { for (const n of nodes) if (n instanceof FakeEl) this.insertBefore(n, null); }
  replaceChildren(...nodes: unknown[]) {
    for (const c of [...this.children]) c.remove();
    this.append(...nodes);
  }
  insertBefore(node: FakeEl, ref: FakeEl | null) {
    node.remove();
    node.parent = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(node);
    else this.children.splice(at, 0, node);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  get lastElementChild(): FakeEl | null { return this.children.at(-1) ?? null; }
}
// Each render listens on the document, so each test gets its own: an earlier test's page would answer too.
let doc = new FakeEl();
vi.stubGlobal('document', doc);
const observed = new Set<FakeEl>();
vi.stubGlobal(
  'IntersectionObserver',
  class {
    constructor(private callback: (entries: { isIntersecting: boolean; target: FakeEl }[]) => void) {}
    observe(el: FakeEl) {
      observed.add(el);
      // Every section is in view.
      queueMicrotask(() => this.callback([{ isIntersecting: true, target: el }]));
    }
    unobserve(el: FakeEl) { observed.delete(el); }
  },
);

vi.mock('../../lib/dom', () => ({
  h: (_tag: string, attrs: Record<string, unknown>, ...children: unknown[]) => {
    const el = new FakeEl();
    if (typeof attrs['data-section'] === 'string') el.dataset.section = attrs['data-section'];
    el.append(...children);
    return el;
  },
}));
vi.mock('../../app/router', () => ({ VIEW_SHOWN: 'shown' }));
vi.mock('../../catalog/explore', () => ({ EXPLORE_CHANGED: 'explore-changed', exploreLayout: async () => ({ order: [], hidden: [] }), listSectionId: () => 'lb', SECTIONS: ['featured', 'queue', 'in-cinemas', 'services', 'genres'] }));
vi.mock('../../catalog/streaming', () => ({ pickedServices: async () => [], STREAMING_CHANGED: 'streaming-changed', streamingRegion: async () => 'US' }));
const taste = vi.hoisted(() => ({ up: [] as { id: string; type: 'movie'; name: string }[] }));
vi.mock('../../catalog/taste', () => ({
  favouriteGenres: () => [],
  interleave: (lists: unknown[][]) => lists.flat(),
  seedsFrom: (up: unknown[]) => up,
  taste: async () => ({ up: taste.up, down: [], hidden: [], lists: [], hintDone: true }),
  updateTaste: async () => {},
}));
vi.mock('../../catalog/tmdb', () => ({ recommendationsFor: async () => [], streamingServices: async () => [], tmdbConnected: async () => true }));
vi.mock('../../components/icons', () => ({ icon: () => '' }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../library/library', () => ({ inLibrary: () => false, libraryEntries: () => [] }));
vi.mock('../../library/watch', () => ({ lastWatchedAt: () => 0, recentlyWatched: () => [], tasteWatched: () => [] }));
vi.mock('../detail/open', () => ({ titleHandlers: () => ({ openDetail() {}, play() {}, withMenu() {} }) }));
vi.mock('../home/hero', () => ({ heroSkeleton: () => new FakeEl() }));
vi.mock('../home/rows', () => ({ arrange: (ids: string[]) => ids }));
vi.mock('../settings', () => ({ openSettingsTo: () => {} }));
vi.mock('./customize', () => ({ createCustomizePage: () => new FakeEl() }));
const featured = vi.hoisted(() => ({ drawn: 0 }));
vi.mock('./featured', () => ({ renderFeatured: async () => void featured.drawn++ }));
const built = vi.hoisted(() => new Map<string, number>());
vi.mock('./sections', () => {
  const builder = (id: string) => ({ tmdb: true, label: () => id, build: () => (built.set(id, (built.get(id) ?? 0) + 1), new FakeEl()) });
  return { letterboxdRow: () => new FakeEl(), SECTION_BUILDERS: { queue: builder('queue'), 'in-cinemas': builder('in-cinemas'), services: builder('services'), genres: builder('genres') } };
});
const state = vi.hoisted(() => ({ clears: 0 }));
vi.mock('./state', () => ({ exploreMenu: () => () => {}, loadHidden: async () => {}, notHidden: () => true, removeHiddenCards: () => () => {}, hiddenClears: () => state.clears }));

const { exploreRoom } = await import('./index');

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve));
};

beforeEach(() => {
  doc = new FakeEl();
  vi.stubGlobal('document', doc);
  built.clear();
  featured.drawn = 0;
  taste.up = [];
});

it('rebuilds the sections that depend on the streaming country when it changes', async () => {
  exploreRoom.render({} as never);
  await settle();
  expect(built.get('in-cinemas')).toBe(1);
  doc.dispatch('streaming-changed');
  await settle();
  expect(built.get('in-cinemas')).toBe(2);
  expect(built.get('services')).toBe(2);
  // The others keep what they show (and their scroll).
  expect(built.get('genres')).toBe(1);
});

it('rebuilds the sections that depend on the date when Discover is shown on a new day', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 15, 23, 0) });
  try {
    const page = exploreRoom.render({} as never) as unknown as FakeEl;
    await settle();
    page.dispatch('shown');
    await settle();
    expect(built.get('in-cinemas')).toBe(1);
    vi.setSystemTime(new Date(2026, 9, 16, 8, 0));
    page.dispatch('shown');
    await settle();
    expect(built.get('in-cinemas')).toBe(2);
    expect(built.get('genres')).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

it('a thumbs up given since refreshes the banner and the queue when Discover is shown again', async () => {
  const page = exploreRoom.render({} as never) as unknown as FakeEl;
  await settle();
  expect(featured.drawn).toBe(1);
  page.dispatch('shown');
  await settle();
  // Nothing changed: nothing redrawn.
  expect(featured.drawn).toBe(1);
  taste.up = [{ id: 'tt1', type: 'movie', name: 'Liked' }];
  page.dispatch('shown');
  await settle();
  expect(featured.drawn).toBe(2);
  expect(built.get('queue')).toBe(2);
  expect(built.get('genres')).toBe(1);
});

it('brings every section back after Customize shows hidden titles again', async () => {
  const page = exploreRoom.render({} as never) as unknown as FakeEl;
  await settle();
  state.clears++;
  page.dispatch('shown');
  await settle();
  expect(featured.drawn).toBe(2);
  expect(built.get('genres')).toBe(2);
});
