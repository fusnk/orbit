import { expect, it, vi } from 'vitest';

class FakeEl {
  dataset: Record<string, string> = {};
  hidden = false;
  textContent = '';
  value = '';
  addEventListener() {}
  replaceChildren() {}
  append() {}
  contains() {
    return false;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
}
const seen = vi.hoisted(() => ({ more: undefined as undefined | ((entries: { isIntersecting: boolean }[]) => void), rows: 0 }));
vi.stubGlobal('document', { activeElement: null });
vi.stubGlobal('HTMLElement', FakeEl);
vi.stubGlobal(
  'IntersectionObserver',
  class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      seen.more = callback;
    }
    observe() {}
  },
);
vi.mock('../../lib/dom', () => ({ h: () => new FakeEl() }));
vi.mock('../../i18n', () => ({ t: (key: string) => key, tn: (key: string) => key, locale: () => 'en' }));
vi.mock('../../lib/clock', () => ({ clockFormat: () => ({ format: () => '' }) }));
vi.mock('../../catalog/service', () => ({ loadMeta: async () => null }));
// No content limit on this profile: every entry is listed.
vi.mock('../../catalog/parental', () => ({ shownNow: <T>(entries: readonly T[]) => [...entries] }));
vi.mock('../../components/cards', () => ({ artImage: () => new FakeEl() }));
vi.mock('../../components/icons', () => ({ icon: () => '' }));
vi.mock('../../components/toast', () => ({ toast: () => {} }));
vi.mock('../../components/text-field', () => ({ createTextField: () => new FakeEl() }));
vi.mock('../../components/menu', () => ({
  withContextMenu: (el: FakeEl) => {
    seen.rows++;
    return el;
  },
}));
vi.mock('../detail/streams', () => ({ playTitle: async () => {} }));
const DAY = 24 * 60 * 60 * 1000;
vi.mock('../../library/watch', () => ({
  historyUndo: () => () => {},
  removeHistory: async () => {},
  // 300 movies, one a day.
  historyRows: () =>
    Array.from({ length: 300 }, (_, i) => ({
      row: { videoId: `tt${i}`, titleId: `tt${i}`, season: null, episode: null, position: 0, duration: 0, watched: true, updatedAt: Date.now() - i * DAY },
      title: { id: `tt${i}`, type: 'movie', name: `Film ${i}`, genres: [], origins: [] },
    })),
}));

const { createHistoryView } = await import('./history');

// History redraws whenever watch history changes (an entry removed, coming back from the player):
// what was scrolled into view stays drawn, so the page doesn't shrink under the person and lose their place.
it('keeps the entries already drawn when history is read again', () => {
  const view = createHistoryView({} as never, { openDetail() {} });
  view.refresh();
  seen.more!([{ isIntersecting: true }]);
  seen.more!([{ isIntersecting: true }]);
  expect(seen.rows).toBe(180);
  seen.rows = 0;
  view.refresh();
  expect(seen.rows).toBe(180);
});
