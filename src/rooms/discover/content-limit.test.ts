import { beforeEach, expect, it, vi } from 'vitest';

class FakeEl {
  dataset: Record<string, string> = {};
  hidden = false;
  textContent = '';
  title = '';
  constructor(public className = '') {}
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  replaceChildren() {}
  append() {}
  querySelector() { return null; }
}
vi.stubGlobal('document', { addEventListener() {} });
// The grid's end is always in view: each page that lands asks for the next.
vi.stubGlobal(
  'IntersectionObserver',
  class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() {
      setTimeout(() => this.callback([{ isIntersecting: true }]));
    }
    unobserve() {}
  },
);

const made = vi.hoisted(() => [] as { className: string; textContent: string }[]);
vi.mock('../../lib/dom', () => ({
  h: (_tag: string, attrs?: { class?: string }) => {
    const el = new FakeEl(attrs?.class);
    made.push(el);
    return el;
  },
}));
vi.mock('../../i18n', () => ({ t: (key: string) => key, tn: (key: string, n: number) => `${key}:${n}` }));
vi.mock('../../addons/registry', () => ({ onAddonsChange: () => {} }));
// A content limit whose ratings are slow: "tt2" is blocked; the rest are allowed once `rated` is set.
const limit = vi.hoisted(() => ({ rated: false, blockAll: false, redraws: [] as (() => void)[] }));
vi.mock('../../catalog/parental', () => ({
  allowedTitles: async () => {},
  shownNow: <T extends { id: string }>(entries: T[], _titleOf: unknown, redraw: () => void) => {
    if (!limit.rated) {
      limit.redraws.push(redraw);
      return [];
    }
    return entries.filter((title) => !limit.blockAll && title.id !== 'tt2');
  },
}));
vi.mock('../../catalog/service', () => ({
  usableAddons: async () => [],
  loadCatalog: async () => [
    { id: 'tt1', name: 'First' },
    { id: 'tt2', name: 'Blocked' },
    { id: 'tt3', name: 'Third' },
  ],
}));
vi.mock('../../catalog/tmdb', () => ({ TMDB_CHANGED: 'tmdb', tmdbConnected: async () => false, tmdbSourcePage: async () => null }));
vi.mock('../../components/age-rating', () => ({ ageRatingSlot: () => '' }));
vi.mock('../../components/cards', () => ({ gridSkeletons: () => [], titleMeta: () => [] }));
vi.mock('../../components/icons', () => ({ icon: () => '' }));
vi.mock('../../components/menu', () => ({ openMenuFrom: () => {} }));
const messages = vi.hoisted(() => [] as string[]);
vi.mock('../../components/state-message', () => ({
  errorState: () => new FakeEl(),
  stateMessage: ({ title }: { title: string }) => {
    messages.push(title);
    return new FakeEl();
  },
}));
vi.mock('../detail/open', () => ({ titleHandlers: () => ({ openDetail() {}, play() {}, withMenu() {} }) }));
vi.mock('../detail/title-actions', () => ({ primaryLabel: () => 'Play' }));
vi.mock('../title-card', () => ({ titleCard: () => new FakeEl() }));
vi.mock('../settings', () => ({ openSettingsTo: () => {} }));
vi.mock('./surprise', () => ({ openSurprise: () => {} }));
vi.mock('./genre-picker', () => ({ createGenrePicker: () => ({ element: new FakeEl(), render() {} }) }));
vi.mock('./discover.css', () => ({}));
const featured = vi.hoisted(() => ({ shown: [] as (string | undefined)[] }));
vi.mock('./featured', () => ({
  fillFeatured: (el: { hidden: boolean }, _page: unknown, title?: { name: string }) => {
    el.hidden = !title;
    featured.shown.push(title?.name);
  },
}));
// One page only (no `skip`): the grid is done once it asks for a second.
vi.mock('./sources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sources')>()),
  sameGridView: () => false,
  animeRequest: () => undefined,
  pageSources: () => [{ key: 'addon', name: 'Addon', addon: {}, catalogs: [{ type: 'movie', id: 'top', name: 'Popular', extra: [] }] }],
}));

const { createDiscoverRoom } = await import('./index');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Every test starts with no ratings in yet and no banner drawn.
beforeEach(() => {
  limit.rated = false;
  limit.blockAll = false;
  limit.redraws.length = 0;
  featured.shown.length = 0;
});

it('draws the banner once ratings that were slow to come in allow a title', async () => {
  createDiscoverRoom('movie').render({} as never);
  await settle();
  await settle();
  // Nothing rated yet: no banner, rather than one the limit may not allow.
  expect(featured.shown).toEqual([undefined]);
  limit.rated = true;
  limit.redraws.splice(0).forEach((redraw) => redraw());
  expect(featured.shown.at(-1)).toBe('First');
});

it('counts only the titles the grid shows, once their ratings are in', async () => {
  createDiscoverRoom('movie').render({} as never);
  const count = made.filter((el) => el.className === 'count').at(-1)!;
  await settle();
  await settle();
  expect(count.textContent).toBe('');
  limit.rated = true;
  limit.redraws.splice(0).forEach((redraw) => redraw());
  // Three titles sent, one the limit hides.
  expect(count.textContent).toBe('browse.discover.titles:2');
});

it('says the catalog is empty when the content limit hides every title in it', async () => {
  limit.rated = true;
  limit.blockAll = true;
  messages.length = 0;
  createDiscoverRoom('movie').render({} as never);
  await settle();
  await settle();
  await settle();
  // A blank grid with nothing to say why would look broken.
  expect(messages).toEqual(['browse.service.empty']);
});
