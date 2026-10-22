import { expect, it, vi } from 'vitest';

class FakeEl {
  dataset: Record<string, string> = {};
  hidden = false;
  textContent = '';
  title = '';
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  replaceChildren() {}
  append() {}
  querySelector() { return null; }
}
vi.stubGlobal('document', { addEventListener() {} });
const pager = vi.hoisted(() => ({ fire: () => {} }));
vi.stubGlobal(
  'IntersectionObserver',
  class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      pager.fire = () => callback([{ isIntersecting: true }]);
    }
    observe() {}
    unobserve() {}
  },
);

vi.mock('../../lib/dom', () => ({ h: () => new FakeEl() }));
vi.mock('../../i18n', () => ({ t: (key: string) => key, tn: (key: string) => key }));
vi.mock('../../addons/registry', () => ({ onAddonsChange: () => {} }));
vi.mock('../../catalog/parental', () => ({ allowedTitles: async () => {}, shownNow: <T>(entries: T[]) => entries }));
const requests = vi.hoisted(() => [] as [string, string][][]);
vi.mock('../../catalog/service', () => ({
  usableAddons: async () => [],
  loadCatalog: async (_ref: unknown, extra: [string, string][]) => {
    requests.push(extra);
    // The addon's first page lists one title twice.
    // Its pages overlap (a list that shifted while paging), and the first lists one title twice.
    return requests.length === 1 ? [{ id: 'tt1', name: 'A' }, { id: 'tt1', name: 'A' }, { id: 'tt2', name: 'B' }] : [{ id: 'tt2', name: 'B' }, { id: `tt${requests.length + 2}`, name: 'C' }];
  },
}));
vi.mock('../../catalog/tmdb', () => ({ TMDB_CHANGED: 'tmdb', tmdbConnected: async () => false, tmdbSourcePage: async () => null }));
vi.mock('../../components/age-rating', () => ({ ageRatingSlot: () => '' }));
vi.mock('../../components/cards', () => ({ gridSkeletons: () => [], titleMeta: () => [] }));
vi.mock('../../components/icons', () => ({ icon: () => '' }));
vi.mock('../../components/menu', () => ({ openMenuFrom: () => {} }));
vi.mock('../../components/state-message', () => ({ errorState: () => new FakeEl(), stateMessage: () => new FakeEl() }));
vi.mock('../detail/open', () => ({ titleHandlers: () => ({ openDetail() {}, play() {}, withMenu() {} }) }));
vi.mock('../detail/title-actions', () => ({ primaryLabel: () => 'Play' }));
const cards = vi.hoisted(() => [] as string[]);
vi.mock('../title-card', () => ({
  titleCard: (title: { id: string }) => {
    cards.push(title.id);
    return new FakeEl();
  },
}));
vi.mock('../settings', () => ({ openSettingsTo: () => {} }));
vi.mock('./surprise', () => ({ openSurprise: () => {} }));
vi.mock('./genre-picker', () => ({ createGenrePicker: () => ({ element: new FakeEl(), render() {} }) }));
vi.mock('./discover.css', () => ({}));
vi.mock('./featured', () => ({ fillFeatured: () => {} }));
vi.mock('./sources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sources')>()),
  sameGridView: () => false,
  animeRequest: () => undefined,
  pageSources: () => [{ key: 'addon', name: 'Addon', addon: {}, catalogs: [{ type: 'movie', id: 'top', name: 'Popular', extra: [{ name: 'skip' }] }] }],
}));

const { createDiscoverRoom } = await import('./index');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it('asks for the next page past every title the addon sent, duplicates included', async () => {
  createDiscoverRoom('movie').render({} as never);
  await settle();
  await settle();
  pager.fire();
  await settle();
  expect(requests[1]).toEqual([['skip', '3']]);
  pager.fire();
  await settle();
  // Two more sent, one of them already shown: the addon has sent five.
  expect(requests[2]).toEqual([['skip', '5']]);
  // Each title once.
  expect(cards).toEqual(['tt1', 'tt2', 'tt4', 'tt5']);
});
