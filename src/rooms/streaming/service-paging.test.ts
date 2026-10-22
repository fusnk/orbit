import { expect, it, vi } from 'vitest';

class FakeEl {
  dataset: Record<string, string> = {};
  hidden = false;
  textContent = '';
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  replaceChildren() {}
  append() {}
  querySelector() { return null; }
}
const pager = vi.hoisted(() => ({ fire: () => {} }));
vi.stubGlobal(
  'IntersectionObserver',
  class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      pager.fire = () => callback([{ isIntersecting: true }]);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../app/router', () => ({ VIEW_DISCARDED: 'discarded' }));
vi.mock('../../catalog/streaming', () => ({ regionName: (code: string) => code }));
vi.mock('../../catalog/tmdb', () => ({
  // TMDB's list shifted between pages: page 2 starts with the last title of page 1.
  servicePage: async (_service: string, _region: string, kind: string, _genre: unknown, page: number) =>
    kind === 'movie' ? { titles: page === 1 ? [{ id: 'tt1' }, { id: 'tt2' }] : [{ id: 'tt2' }, { id: 'tt3' }], done: page === 2 } : { titles: [], done: true },
}));
vi.mock('../../components/cards', () => ({ asyncRail: () => new FakeEl(), gridSkeletons: () => [], rankedCard: () => new FakeEl() }));
vi.mock('../../lib/art-hue', () => ({ artHue: async () => null }));
vi.mock('../../lib/dom', () => ({ h: () => new FakeEl() }));
vi.mock('../../components/state-message', () => ({ errorState: () => new FakeEl(), stateMessage: () => new FakeEl() }));
vi.mock('../../theme/ambient', () => ({ setAmbientHue: () => {} }));
vi.mock('../detail/open', () => ({ titleHandlers: () => ({ openDetail() {}, withMenu: (card: unknown) => card }) }));
const cards = vi.hoisted(() => [] as string[]);
vi.mock('../title-card', () => ({
  titleCard: (title: { id: string }) => {
    cards.push(title.id);
    return new FakeEl();
  },
}));
vi.mock('./service.css', () => ({}));

const { createServicePage } = await import('./service');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it('shows a title once when the next page repeats it', async () => {
  createServicePage({ key: 'netflix', name: 'Netflix' } as never, 'US', {} as never, 'movie');
  await settle();
  pager.fire();
  await settle();
  expect(cards).toEqual(['tt1', 'tt2', 'tt3']);
});
