import { expect, it, vi } from 'vitest';

vi.mock('../../lib/dom', () => ({ h: () => ({}) }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../catalog/service', () => ({ loadMeta: async () => null }));
vi.mock('../../components/cards', () => ({ artImage: () => ({}) }));
vi.mock('../../components/favourite-heart', () => ({ favouriteHeart: () => ({}) }));
vi.mock('../../components/icons', () => ({ icon: () => '' }));
vi.mock('../../components/menu', () => ({ withContextMenu: (el: unknown) => el }));
vi.mock('../../library/spoilers', () => ({ episodeName: () => '', hiddenFor: () => ({}) }));
vi.mock('../../library/watch', () => ({ episodeState: () => ({ kind: 'unwatched' }) }));
vi.mock('../detail/streams', () => ({ playTitle: async () => {} }));
// A content limit that blocks show 2 and is still looking up show 3's rating.
vi.mock('../../catalog/parental', () => ({
  shownNow: <T>(entries: readonly T[]) => [...entries],
  verdictNow: (title: { id: string }) => (title.id === 'tt2' ? 'blocked' : title.id === 'tt3' ? 'pending' : 'allowed'),
}));
vi.mock('../../library/favourite-episodes', () => ({
  groupByShow: () => [],
  toggleFavouriteEpisode: async () => true,
  // Two episodes of each of three shows.
  favouriteEpisodes: () =>
    [1, 2, 3].flatMap((n) => [1, 2].map((e) => ({ show: { id: `tt${n}`, type: 'series', name: `Show ${n}`, genres: [], origins: [] }, season: 1, episode: e, videoId: `tt${n}:1:${e}`, name: '', addedAt: e }))),
}));

const { favouritesCount } = await import('./favourites');

// The tab's number matches what the tab lists: a blocked show's episodes aren't listed, so they aren't counted.
it('counts only the favourites the content limit lets the tab list', () => {
  expect(favouritesCount()).toBe(4);
});
