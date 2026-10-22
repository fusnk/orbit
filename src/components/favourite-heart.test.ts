import { describe, expect, it, vi } from 'vitest';

const subscribed: (() => void)[] = [];
let favourite = false;

vi.mock('../library/favourite-episodes', () => ({
  isFavouriteEpisode: () => favourite,
  toggleFavouriteEpisode: vi.fn(),
  onFavouriteEpisodesChange: (listener: () => void) => {
    subscribed.push(listener);
    return () => subscribed.splice(subscribed.indexOf(listener), 1);
  },
}));
vi.mock('../i18n', () => ({ t: (key: string) => key }));
vi.mock('./icons', () => ({ icon: () => 'icon' }));
/** Just enough of a button for the heart. */
vi.mock('../lib/dom', () => ({
  h: () => {
    const attributes = new Map<string, string>();
    return { attributes, title: '', setAttribute: (name: string, value: string) => attributes.set(name, value), addEventListener: () => {}, replaceChildren: () => {} };
  },
}));

import type { Episode, Title } from '../catalog/titles';
import { favouriteHeart } from './favourite-heart';

const show: Title = { id: 'tt1', type: 'series', name: 'Show', genres: [], origins: [] };
const episode = (number: number): Episode => ({ id: `tt1:1:${number}`, number, title: `Episode ${number}` });

describe('favouriteHeart', () => {
  it('follows changes through one subscription, however many hearts a long session draws', () => {
    // Each heart used to subscribe on its own and leave only on the next change to the favourites,
    // so with none made every heart ever drawn (and its show) stayed in the list for the session.
    const hearts = Array.from({ length: 500 }, (_, i) => favouriteHeart(show, 1, episode(i + 1)));
    expect(subscribed).toHaveLength(1);
    favourite = true;
    subscribed[0]!();
    const pressed = (el: HTMLButtonElement) => (el as unknown as { attributes: Map<string, string> }).attributes.get('aria-pressed');
    expect(hearts.every((el) => pressed(el) === 'true')).toBe(true);
  });
});
