import { describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { letterboxdListPage, stars } from './letterboxd';

describe('Letterboxd stars', () => {
  it('shows ratings as Letterboxd does', () => {
    expect(stars(3.5)).toBe('★★★½');
    expect(stars(5)).toBe('★★★★★');
    expect(stars(0.5)).toBe('½');
    expect(stars(9)).toBe('★★★★★');
  });
});

describe('a Letterboxd list in a grid', () => {
  const film = (n: number) => ({ imdbId: `tt${n}`, name: `Film ${n}`, poster: null, background: null, year: null, overview: null, rating: null, liked: false });
  const list = { owner: 'someone', slug: 'a-list' };

  it('goes on past a page the content limit emptied', async () => {
    invoke.mockResolvedValueOnce([film(1), film(2)]);
    const page = await letterboxdListPage(list, 1, async () => []);
    expect(page).toEqual({ titles: [], done: false });
  });

  it('ends at a page Letterboxd couldn’t fill, or after the last page', async () => {
    invoke.mockResolvedValueOnce([]);
    expect((await letterboxdListPage(list, 2, async (titles) => titles)).done).toBe(true);
    invoke.mockResolvedValueOnce([film(3)]);
    const last = await letterboxdListPage(list, 5, async (titles) => titles);
    expect(last.done).toBe(true);
    expect(last.titles.map((t) => t.id)).toEqual(['tt3']);
  });
});
