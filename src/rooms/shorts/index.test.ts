import { beforeEach, expect, it, vi } from 'vitest';

// Tests run without a DOM: elements keep their attributes, children and listeners, and that's all the feed needs here.
class FakeEl extends EventTarget {
  hidden = false;
  dataset: Record<string, string> = {};
  textContent = '';
  children: FakeEl[] = [];
  constructor(public attrs: Record<string, unknown> = {}) {
    super();
  }
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  removeAttribute(name: string) {
    delete this.attrs[name];
  }
  append(...children: FakeEl[]) {
    this.children.push(...children);
  }
  replaceChildren(...children: FakeEl[]) {
    this.children = children;
  }
  contains() {
    return false;
  }
  querySelector() {
    return null;
  }
  remove() {}
  focus() {}
}
vi.stubGlobal('HTMLElement', FakeEl);
vi.stubGlobal('document', { activeElement: null });
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const invoke = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(async () => undefined));
const meta = vi.hoisted(() => ({ answer: (() => {}) as (value: unknown) => void }));
const starts = vi.hoisted(() => ({ count: 0 }));
const titles = vi.hoisted(() => [
  { id: 'tt0000001', type: 'movie', name: 'One' },
  { id: 'tt0000002', type: 'movie', name: 'Two' },
  { id: 'tt0000003', type: 'movie', name: 'Three' },
]);

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('../../app/router', () => ({ VIEW_DISCARDED: 'orbit:view-discarded' }));
vi.mock('../../app/spatial', () => ({ isEditing: () => false }));
vi.mock('../../catalog/taste', () => ({ favouriteGenres: () => [], taste: async () => ({ hidden: [], down: [] }) }));
vi.mock('../../catalog/explore', () => ({ genreOf: () => ({}) }));
vi.mock('../../catalog/parental', () => ({ allowedTitles: async (list: unknown[]) => list }));
vi.mock('../../catalog/service', () => ({
  loadCatalog: async () => [],
  usableAddons: async () => [],
  // The trailer lookup of a title without one in its catalog item: answered when the test says so.
  loadMeta: () => new Promise((resolve) => (meta.answer = resolve)),
}));
vi.mock('../../catalog/shorts', async (original) => ({ ...(await original<typeof import('../../catalog/shorts')>()), buildFeed: (lists: unknown[][]) => lists.flat() }));
vi.mock('../../catalog/tmdb', () => ({ tmdbList: async (key: string) => (key === 'movies-today' ? titles : []), tmdbRating: () => undefined, tmdbSourcePage: async () => null }));
vi.mock('../../catalog/titles', () => ({ browsableCatalogs: () => [], displayYear: () => '', fallbackHue: () => 0 }));
vi.mock('../../components/cards', () => ({ backdropImage: () => new FakeEl(), withHue: (el: FakeEl) => el }));
vi.mock('../../components/icons', () => ({ icon: () => new FakeEl() }));
vi.mock('../../components/rating-badge', () => ({ ratingBadge: () => new FakeEl() }));
vi.mock('../../i18n', () => ({ t: (key: string) => key, formatDecimal: String }));
vi.mock('../../lib/dom', () => ({ h: (_tag: string, attrs?: Record<string, unknown>) => new FakeEl(attrs) }));
vi.mock('../../library/library', () => ({ inLibrary: () => false, toggleLibrary: async () => {} }));
vi.mock('../../library/spoilers', () => ({ spoilers: () => ({ ratings: false }) }));
vi.mock('../../library/watch', () => ({ isWatched: () => false, lastWatchedAt: () => 0, tasteWatched: () => [] }));
vi.mock('../../theme/appearance', () => ({ reducedMotion: () => false }));
vi.mock('../detail/hero-trailer', () => ({
  trailersAllowed: () => true,
  createHeroTrailer: () => ({ button: new FakeEl(), media: [], start: () => void starts.count++, stop: () => {} }),
}));
vi.mock('../detail/open', () => ({ titleHandlers: () => ({ openDetail: () => {} }) }));
vi.mock('../home/genre-targets', () => ({ genreTargets: () => ({}) }));
vi.mock('../explore/state', () => ({ hideTitle: () => {} }));
vi.mock('./sound', () => ({ loadShortsSound: async () => false, saveShortsSound: async () => {} }));
vi.mock('./shorts.css', () => ({}));

const { createShortsPage } = await import('./index');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Shorts opened and its feed built: the first title plays, the second's trailer is being looked up. Then Back. */
async function openAndLeave(): Promise<void> {
  const page = createShortsPage({ back: () => {} } as never) as unknown as FakeEl;
  await settle();
  expect(starts.count).toBe(1);
  page.dispatchEvent(new Event('orbit:view-discarded'));
}

beforeEach(() => {
  invoke.mockClear();
  starts.count = 0;
});

it('looks no trailer up ahead once Shorts is left', async () => {
  await openAndLeave();
  meta.answer({ ...titles[1], trailers: ['abcdefghijk'] });
  await settle();
  expect(invoke).not.toHaveBeenCalledWith('trailer_preview', expect.anything());
});

it('starts no trailer again once Shorts is left, when the next title has none', async () => {
  await openAndLeave();
  meta.answer(null);
  await settle();
  expect(starts.count).toBe(1);
});
