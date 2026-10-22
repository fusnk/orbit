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
  closest() { return null; }
}
vi.stubGlobal('document', { addEventListener() {} });
vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} });

vi.mock('../../lib/dom', () => ({ h: () => new FakeEl() }));
vi.mock('../../i18n', () => ({ t: (key: string) => key, tn: (key: string) => key }));
vi.mock('../../addons/registry', () => ({ onAddonsChange: () => {} }));
vi.mock('../../catalog/parental', () => ({ allowedTitles: async () => {}, shownNow: <T>(entries: T[]) => entries }));
const catalog = vi.hoisted(() => ({ fail: false }));
vi.mock('../../catalog/service', () => ({
  usableAddons: async () => [],
  loadCatalog: async () => {
    if (catalog.fail) throw new Error('offline');
    return [{ id: 'tt1', name: 'Old title' }];
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
vi.mock('../title-card', () => ({ titleCard: () => new FakeEl() }));
vi.mock('../settings', () => ({ openSettingsTo: () => {} }));
vi.mock('./surprise', () => ({ openSurprise: () => {} }));
vi.mock('./genre-picker', () => ({ createGenrePicker: () => ({ element: new FakeEl(), render() {} }) }));
vi.mock('./discover.css', () => ({}));
const featured = vi.hoisted(() => ({ shown: [] as (string | undefined)[] }));
vi.mock('./featured', () => ({ fillFeatured: (_el: unknown, _page: unknown, title?: { name: string }) => featured.shown.push(title?.name) }));
vi.mock('./sources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sources')>()),
  sameGridView: () => false,
  animeRequest: () => undefined,
  pageSources: () => [
    {
      key: 'addon',
      name: 'Addon',
      addon: {},
      catalogs: [
        { type: 'movie', id: 'top', name: 'Popular', extra: [] },
        { type: 'movie', id: 'new', name: 'New', extra: [] },
      ],
    },
  ],
}));

const { createDiscoverRoom, openDiscoverAt } = await import('./index');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it("hides the previous catalog's banner when the new catalog fails to load", async () => {
  const room = createDiscoverRoom('movie');
  room.render({} as never);
  await settle();
  expect(featured.shown.at(-1)).toBe('Old title');
  catalog.fail = true;
  openDiscoverAt('movie', { catalogId: 'new' });
  room.onShow?.();
  await settle();
  expect(featured.shown.at(-1)).toBeUndefined();
});
