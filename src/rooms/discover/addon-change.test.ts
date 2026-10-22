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
  closest() { return null; }
}
vi.stubGlobal('document', { addEventListener() {} });
vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} });

vi.mock('../../lib/dom', () => ({ h: (_tag: string, attrs?: { class?: string }) => new FakeEl(attrs?.class) }));
vi.mock('../../i18n', () => ({ t: (key: string) => key, tn: (key: string) => key }));
const addons = vi.hoisted(() => ({ listeners: [] as (() => void)[] }));
vi.mock('../../addons/registry', () => ({ onAddonsChange: (listener: () => void) => addons.listeners.push(listener) }));
vi.mock('../../catalog/parental', () => ({ allowedTitles: async () => {}, shownNow: <T>(entries: T[]) => entries }));
const requests = vi.hoisted(() => [] as unknown[]);
vi.mock('../../catalog/service', () => ({
  usableAddons: async () => [],
  loadCatalog: async (ref: unknown) => {
    requests.push(ref);
    return [{ id: 'tt1', name: 'A' }];
  },
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
const page = vi.hoisted(() => ({ sources: [] as unknown[] }));
const cinemeta = { key: 'cinemeta', name: 'Cinemeta', addon: {}, catalogs: [{ type: 'movie', id: 'top', name: 'Popular', extra: [] }] };
vi.mock('./sources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sources')>()),
  sameGridView: () => false,
  animeRequest: () => undefined,
  pageSources: () => page.sources,
}));

const { createDiscoverRoom } = await import('./index');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const addonsChanged = () => addons.listeners.at(-1)!();

beforeEach(() => {
  messages.length = 0;
  requests.length = 0;
  cards.length = 0;
});

it('shows its catalogs once an addon that has some is installed or enabled', async () => {
  page.sources = [];
  createDiscoverRoom('movie').render({} as never);
  await settle();
  expect(messages).toEqual(['browse.discover.no-catalogs-movies']);
  // Cinemeta enabled again in Settings → Addons.
  page.sources = [cinemeta];
  addonsChanged();
  await settle();
  expect(cards).toEqual(['tt1']);
});

it('says there are no catalogs once the last addon that had some is removed or disabled', async () => {
  page.sources = [cinemeta];
  createDiscoverRoom('movie').render({} as never);
  await settle();
  expect(cards).toEqual(['tt1']);
  page.sources = [];
  addonsChanged();
  await settle();
  expect(messages).toEqual(['browse.discover.no-catalogs-movies']);
});
