import { describe, expect, it } from 'vitest';
import type { Title } from '../catalog/titles';
import { decodeWatched, encodeWatched, videoOrder } from './watched-bitfield';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `tt1:1:${i + 1}`);

describe('watched bitfield', () => {
  it('reads and writes fields exactly as Stremio does', async () => {
    // stremio-core's own test data: episodes 1–5 of 9 watched.
    const videos = Array.from({ length: 9 }, (_, i) => `tt2934286:1:${i + 1}`);
    const field = 'tt2934286:1:5:5:eJyTZwAAAEAAIA==';
    const watched = await decodeWatched(field, videos);
    expect([...watched]).toEqual(videos.slice(0, 5));
    expect(await encodeWatched(watched, videos)).toBe(field);
    expect(await encodeWatched(new Set(), [])).toBe('undefined:1:eJwDAAAAAAE=');
  });

  it('round-trips across many episodes', async () => {
    const videos = ids(30);
    const watched = new Set([videos[0]!, videos[7]!, videos[8]!, videos[29]!]);
    expect(await decodeWatched(await encodeWatched(watched, videos), videos)).toEqual(watched);
  });

  it('lines up again when an episode is added before the anchor', async () => {
    const before = ids(5);
    const field = await encodeWatched(new Set([before[3]!, before[4]!]), before);
    // A special is now listed first: everything moves one along.
    const after = ['tt1:0:1', ...before];
    expect([...(await decodeWatched(field, after))]).toEqual([before[3], before[4]]);
  });

  it('ignores junk', async () => {
    for (const junk of ['', 'x', 'tt1:1:1:nope:!!!', 'missing:3:eJyTZwAAAEAAIA==']) expect((await decodeWatched(junk, ids(3))).size).toBe(0);
  });

  it('orders videos like Stremio: specials first', () => {
    const title = {
      id: 'tt1',
      type: 'series',
      name: 'Show',
      genres: [],
      origins: [],
      seasons: [
        { number: 2, episodes: [{ id: 'b', number: 1, title: '' }] },
        { number: 1, episodes: [{ id: 'a2', number: 2, title: '' }, { id: 'a1', number: 1, title: '' }] },
        { number: 0, episodes: [{ id: 's', number: 1, title: '' }] },
      ],
    } as Title;
    expect(videoOrder(title)).toEqual(['s', 'a1', 'a2', 'b']);
  });
});
