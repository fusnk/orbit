import { expect, it, vi } from 'vitest';

class FakeEl {
  dataset: Record<string, string> = {};
  isConnected = false;
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  replaceChildren() {}
  append() {}
  querySelector() { return null; }
}
vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} });
vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });

vi.mock('../../lib/dom', () => ({ h: () => new FakeEl() }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../components/toast', () => ({ toast: () => {} }));
vi.mock('../../components/cards', () => ({ gridSkeletons: () => [] }));
vi.mock('../../components/state-message', () => ({ errorState: () => new FakeEl(), stateMessage: () => new FakeEl() }));
vi.mock('../../catalog/streaming', () => ({ streamingRegion: async () => 'US' }));
vi.mock('../../catalog/tmdb', () => ({ movieCertifications: async () => null, tmdbSourcePage: async () => null }));
vi.mock('../../library/watch', () => ({ isWatched: () => false }));
vi.mock('../detail/open', () => ({ titleHandlers: () => ({ openDetail() {}, withMenu() {} }) }));
vi.mock('./filter-bar', () => ({ createFilterBar: () => ({}) }));
// Not interested, saved for the profile: Discover hasn't been opened this session to read it.
vi.mock('../../catalog/taste', () => ({ taste: async () => ({ up: [], down: [], hidden: ['tt1'], lists: [], hintDone: false }), updateTaste: async () => {}, withHidden: () => ({}) }));
const cards = vi.hoisted(() => ({ shown: [] as string[] }));
vi.mock('../title-card', () => ({
  titleCard: (title: { id: string }) => {
    cards.shown.push(title.id);
    return new FakeEl();
  },
}));

const { createGridPage } = await import('./grid');

it('leaves out titles marked Not interested when opened from outside Discover', async () => {
  const titles = [{ id: 'tt1', name: 'Hidden' }, { id: 'tt2', name: 'Shown' }];
  createGridPage({ title: 'Genre', kinds: ['movie'], load: async () => ({ titles: titles as never, done: true }) }, {} as never);
  await vi.waitFor(() => expect(cards.shown.length).toBeGreaterThan(0));
  expect(cards.shown).toEqual(['tt2']);
});
