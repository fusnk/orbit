import { expect, it, vi } from 'vitest';

const outlet = vi.hoisted(() => ({ scrolls: [] as unknown[], scrollTop: 0 }));
const picker = vi.hoisted(() => ({ pick: (value: string | undefined) => void value }));
class FakeEl {
  dataset: Record<string, string> = {};
  hidden = false;
  // Where the filter bar sits (below the title and banner).
  offsetTop = 420;
  textContent = '';
  title = '';
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  replaceChildren() {}
  append() {}
  querySelector() { return null; }
  // The page sits in the router's scrolled outlet.
  closest() {
    return { scrollTop: outlet.scrollTop, scrollTo: (options: unknown) => outlet.scrolls.push(options) };
  }
}
vi.stubGlobal('document', { addEventListener() {} });
vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} });

vi.mock('../../lib/dom', () => ({ h: () => new FakeEl() }));
vi.mock('../../i18n', () => ({ t: (key: string) => key, tn: (key: string) => key }));
vi.mock('../../addons/registry', () => ({ onAddonsChange: () => {} }));
vi.mock('../../catalog/parental', () => ({ allowedTitles: async () => {}, shownNow: <T>(entries: T[]) => entries }));
vi.mock('../../catalog/service', () => ({ usableAddons: async () => [], loadCatalog: async () => [{ id: 'tt1', name: 'A' }] }));
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
vi.mock('./genre-picker', () => ({ createGenrePicker: () => ({ element: new FakeEl(), render(options: { pick: typeof picker.pick }) { picker.pick = options.pick; } }) }));
vi.mock('./discover.css', () => ({}));
vi.mock('./featured', () => ({ fillFeatured: () => {} }));
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
        { type: 'movie', id: 'top', name: 'Popular', extra: [{ name: 'skip' }] },
        { type: 'movie', id: 'new', name: 'New', extra: [{ name: 'skip' }] },
      ],
    },
  ],
}));

const { createDiscoverRoom, openDiscoverAt } = await import('./index');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it('opens a "See all" or genre chip on the catalog from the page\'s start, not where the old grid was scrolled to', async () => {
  const room = createDiscoverRoom('movie');
  room.render({} as never);
  await settle();
  // The person scrolled far down Popular earlier (the router puts that back on return), then chose "See all" on New.
  openDiscoverAt('movie', { catalogId: 'new' });
  room.onShow?.();
  expect(outlet.scrolls).toEqual([{ top: 0 }]);
});

it('leaves the scroll alone when the page is only chosen from the nav', async () => {
  outlet.scrolls.length = 0;
  const room = createDiscoverRoom('series');
  room.render({} as never);
  await settle();
  room.onShow?.();
  expect(outlet.scrolls).toEqual([]);
});

it('scrolls back up to the filter bar when the genre changes deep down the grid', async () => {
  outlet.scrolls.length = 0;
  const room = createDiscoverRoom('movie');
  room.render({} as never);
  await settle();
  // Scrolled well past the sticky bar, then a genre picked from it.
  outlet.scrollTop = 3000;
  picker.pick('Comedy');
  expect(outlet.scrolls).toEqual([{ top: 420 }]);
  // Picked with the bar still in sight: nothing to put back.
  outlet.scrolls.length = 0;
  outlet.scrollTop = 100;
  picker.pick('Drama');
  expect(outlet.scrolls).toEqual([]);
});
