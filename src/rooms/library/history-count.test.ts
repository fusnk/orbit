import { expect, it, vi } from 'vitest';

vi.mock('../../lib/dom', () => ({ h: () => ({}) }));
vi.mock('../../i18n', () => ({ t: (key: string) => key, tn: (key: string) => key, locale: () => 'en' }));
vi.mock('../../lib/clock', () => ({ clockFormat: () => ({ format: () => '' }) }));
vi.mock('../../catalog/service', () => ({ loadMeta: async () => null }));
vi.mock('../../components/cards', () => ({ artImage: () => ({}) }));
vi.mock('../../components/icons', () => ({ icon: () => '' }));
vi.mock('../../components/toast', () => ({ toast: () => {} }));
vi.mock('../../components/text-field', () => ({ createTextField: () => ({}) }));
vi.mock('../../components/menu', () => ({ withContextMenu: (el: unknown) => el }));
vi.mock('../detail/streams', () => ({ playTitle: async () => {} }));
// A content limit that blocks the even films and is still looking up film 1's rating.
vi.mock('../../catalog/parental', () => ({
  shownNow: <T>(entries: readonly T[]) => [...entries],
  verdictNow: (title: { id: string }) => (title.id === 'tt1' ? 'pending' : Number(title.id.slice(2)) % 2 ? 'allowed' : 'blocked'),
}));
const DAY = 24 * 60 * 60 * 1000;
vi.mock('../../library/watch', () => ({
  historyUndo: () => () => {},
  removeHistory: async () => {},
  historyRows: () =>
    Array.from({ length: 6 }, (_, i) => ({
      row: { videoId: `tt${i}`, titleId: `tt${i}`, season: null, episode: null, position: 0, duration: 0, watched: true, updatedAt: Date.now() - i * DAY },
      title: { id: `tt${i}`, type: 'movie', name: `Film ${i}`, genres: [], origins: [] },
    })),
}));

const { historyCount } = await import('./history');

// The tab's number matches what History lists: blocked titles aren't listed, so they aren't counted.
it('counts only the entries the content limit lets History list', () => {
  expect(historyCount()).toBe(3);
});
