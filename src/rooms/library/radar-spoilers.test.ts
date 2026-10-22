import { expect, it, vi } from 'vitest';

vi.mock('../../lib/dom', () => ({ h: () => ({ addEventListener() {} }) }));
vi.mock('../../i18n', () => ({ locale: () => 'en', t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${Object.values(params).join(',')}` : key) }));
vi.mock('../../components/cards', () => ({
  artImage: () => ({}),
  backdropImage: () => ({}),
  posterCard: () => ({ title: '' }),
  rail: (opts: { cards: unknown[] }) => ({ cards: opts.cards, classList: { add() {} }, querySelector: () => null }),
}));
vi.mock('../../components/drawer', () => ({ openDrawer: () => () => {} }));
vi.mock('../../components/icons', () => ({ icon: () => '' }));
vi.mock('../../library/library', () => ({ inLibrary: () => false, toggleLibrary: async () => {} }));
vi.mock('../detail/my-rating', () => ({ createMyRating: () => ({}) }));
// Spoiler settings hide unwatched episodes' names.
vi.mock('../../library/spoilers', () => ({
  hiddenFor: () => ({ title: true }),
  episodeName: (number: number, title: string, hide: boolean) => (hide ? `Episode ${number}` : title),
}));

const { soonSection } = await import('./radar');

it('keeps an unwatched episode name out of Coming soon while spoiler settings hide it', () => {
  const today = new Date(2026, 0, 1);
  const day = new Date(2026, 0, 15);
  const title = { id: 'tt1', type: 'series', name: 'Show', genres: [], origins: [] };
  const episode = { id: 'tt1:3:5', number: 5, title: 'The Red Wedding' };
  const section = soonSection([{ title, day, rank: 0, release: { type: 'episode', season: 3, number: 5, episode } }] as never, today, () => {}, () => {}) as unknown as { cards: { title: string }[] };
  expect(section.cards[0]?.title).toContain('Episode 5');
  expect(section.cards[0]?.title).not.toContain('Red Wedding');
});
