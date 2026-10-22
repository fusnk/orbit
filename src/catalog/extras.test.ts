import { describe, expect, it, vi } from 'vitest';

const answers: Record<string, unknown> = {};
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string) => answers[cmd] ?? null) }));

import { titleExtras } from './extras';
import { letterboxdReviews } from './letterboxd';

const image = (name: string) => ({ thumb: `https://image.tmdb.org/t/p/w300/${name}`, full: `https://image.tmdb.org/t/p/w1280/${name}` });

describe('title extras', () => {
  it('keeps the facts and media that check out, and drops the rest', async () => {
    answers.tmdb_extras = {
      rating: 7.8,
      votes: 1234,
      logos: [],
      name: null,
      overview: null,
      status: 'ended',
      companies: ['HBO'],
      language: 'ko',
      genres: ['Drama'],
      budget: 0,
      revenue: 75_000_000,
      videos: [
        { key: 'abcdefghijk', name: 'Official Trailer', kind: 'trailer' },
        { key: 'bad key?', name: 'Injected', kind: 'trailer' },
        { key: 'ZYXWVUTSRQP', name: 'Something', kind: 'vlog' },
      ],
      images: { backdrops: [image('a.jpg'), { thumb: 'https://evil.example/a.jpg', full: 'https://evil.example/a.jpg' }], posters: [], logos: 'nope' },
    };
    const extras = await titleExtras({ id: 'tt0000001', type: 'series' });
    expect(extras?.facts).toEqual({ status: 'ended', companies: ['HBO'], language: 'ko', genres: ['Drama'], budget: null, revenue: 75_000_000, rating: 7.8, votes: 1234 });
    expect(extras?.media?.videos.map((v) => v.key)).toEqual(['abcdefghijk']);
    expect(extras?.media?.backdrops).toEqual([image('a.jpg')]);
    expect(extras?.media?.logos).toEqual([]);
  });

  it("only takes network and studio logos from TMDB's own image host over https", async () => {
    const answer = { rating: 7, votes: 10, name: null, overview: null };
    const logo = { name: 'HBO', logo: 'https://image.tmdb.org/t/p/w92/hbo.png' };
    answers.tmdb_extras = { ...answer, logos: [logo] };
    expect((await titleExtras({ id: 'tt0000001', type: 'series' }))?.logos).toEqual([logo]);
    // Never plain http, another host, or an address on this machine or the LAN.
    for (const bad of ['http://image.tmdb.org/t/p/w92/hbo.png', 'https://evil.example/hbo.png', 'https://192.168.1.2/hbo.png', 'https://image.tmdb.org.evil.example/hbo.png']) {
      answers.tmdb_extras = { ...answer, logos: [{ name: 'HBO', logo: bad }] };
      expect((await titleExtras({ id: 'tt0000001', type: 'series' }))?.logos, bad).toEqual([]);
    }
  });

  it('has no facts or media without a TMDB token', async () => {
    answers.tmdb_extras = null;
    const extras = await titleExtras({ id: 'tt0000001', type: 'movie' });
    expect([extras?.facts, extras?.media]).toEqual([null, null]);
  });
});

describe('Letterboxd reviews', () => {
  it('only accepts Letterboxd links and avatars', async () => {
    const review = { author: 'Phil', avatar: 'https://a.ltrbxd.com/x.jpg', rating: 3.5, liked: true, spoilers: false, text: 'Good.', url: 'https://letterboxd.com/phil/film/x/' };
    answers.letterboxd_reviews = { url: 'https://letterboxd.com/film/x/reviews/by/activity/', reviews: [review] };
    expect((await letterboxdReviews({ id: 'tt0000001', type: 'movie' }))?.reviews).toEqual([review]);
    answers.letterboxd_reviews = { url: 'https://letterboxd.com/film/x/', reviews: [{ ...review, avatar: 'https://evil.example/x.jpg' }] };
    await expect(letterboxdReviews({ id: 'tt0000001', type: 'movie' })).rejects.toThrow();
    // Shows aren't on Letterboxd.
    expect(await letterboxdReviews({ id: 'tt0000001', type: 'series' })).toBeNull();
  });
});
