import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import type { Title } from '../catalog/titles';
import { lookUpDetails, lookUpGenres, needingDetails, needingGenres } from './genre-fill';

const title = (id: string, extra: Partial<Title> = {}): Title => ({ id, type: 'movie', name: id, genres: [], origins: [], ...extra });

describe('needingGenres', () => {
  const entries = [
    { title: title('old'), updatedAt: 1 },
    { title: title('has', { genres: ['Drama'] }), updatedAt: 5 },
    { title: title('new'), updatedAt: 9 },
    { title: title('tv', { type: 'channel' }), updatedAt: 8 },
    { title: title('mid'), updatedAt: 4 },
  ];

  it('picks titles without genres, most recently watched first, up to the limit', () => {
    expect(needingGenres(entries, new Set(), 2).map((t) => t.id)).toEqual(['new', 'mid']);
  });

  it('skips titles already tried, and picks none past the limit', () => {
    expect(needingGenres(entries, new Set(['new']), 5).map((t) => t.id)).toEqual(['mid', 'old']);
    expect(needingGenres(entries, new Set(), 0)).toEqual([]);
  });
});

describe('lookUpGenres', () => {
  it('looks titles up a few at a time, once each, skipping failures', async () => {
    let active = 0;
    let peak = 0;
    const load = vi.fn(async (_type: string, id: string) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (id === 'fails') throw new Error('offline');
      if (id === 'none') return null;
      return title(id, { genres: id === 'blank' ? [' '] : ['Drama', ' Comedy '] });
    });
    const tried = new Set<string>();
    const titles = ['a', 'b', 'fails', 'none', 'blank', 'c'].map((id) => title(id));
    const found = await lookUpGenres(titles, { load, tried, concurrency: 2 });
    expect(peak).toBe(2);
    expect(load).toHaveBeenCalledTimes(6);
    expect([...found.keys()]).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(found.size).toBe(3);
    expect(found.get('a')).toEqual(['Drama', 'Comedy']);
    expect([...tried].sort()).toEqual(['a', 'b', 'blank', 'c', 'fails', 'none']);
  });
});

describe('needingDetails', () => {
  const full = { background: 'https://b', logo: 'https://l', year: '2000', runtime: '90 min', genres: ['Drama'] };
  it('picks titles missing artwork or details, in order, skipping tried ones, files and channels', () => {
    const titles = [title('bare'), title('done', full), title('noart', { ...full, background: undefined }), title('tv', { type: 'channel' }), title('tried'), title('local:file.mkv')];
    expect(needingDetails(titles, new Set(['tried']), 10).map((t) => t.id)).toEqual(['bare', 'noart']);
    expect(needingDetails(titles, new Set(), 1).map((t) => t.id)).toEqual(['bare']);
    expect(needingDetails(titles, new Set(), 0)).toEqual([]);
  });
});

describe('lookUpDetails', () => {
  it('returns what each title lacks, and skips titles with nothing new', async () => {
    const load = vi.fn(async (_type: string, id: string) =>
      id === 'none' ? null : title(id, { background: 'https://img/b.jpg', year: '2010', runtime: '100 min', genres: [' Drama '] }),
    );
    const tried = new Set<string>();
    const has = title('has', { background: 'https://mine/b.jpg', year: '1990', runtime: '80 min', genres: ['Comedy'] });
    const found = await lookUpDetails([title('bare'), has, title('none')], { load, tried, concurrency: 2 });
    expect([...found.keys()]).toEqual(['bare']);
    expect(found.get('bare')).toMatchObject({ background: 'https://img/b.jpg', year: '2010', runtime: '100 min', genres: ['Drama'] });
    expect([...tried].sort()).toEqual(['bare', 'has', 'none']);
  });
});
