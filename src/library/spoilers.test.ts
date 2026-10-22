import { describe, expect, it } from 'vitest';
import { hiddenFor, parseSpoilers, type Spoilers } from './spoilers';

const OFF: Spoilers = { titles: false, descriptions: false, thumbnails: false, ratings: false, unaired: false, scope: 'unwatched' };

describe('spoiler settings', () => {
  it('takes the old switches’ meaning until something is saved', () => {
    expect(parseSpoilers(undefined, { spoilers: true, hideEpisodeDescriptions: false })).toEqual({ ...OFF, descriptions: true, thumbnails: true });
    expect(parseSpoilers(null, { spoilers: false, hideEpisodeDescriptions: false })).toEqual(OFF);
    expect(parseSpoilers(null, { spoilers: false, hideEpisodeDescriptions: true })).toEqual({ ...OFF, descriptions: true, scope: 'all' });
    expect(parseSpoilers(null, { spoilers: true, hideEpisodeDescriptions: true })).toEqual({ ...OFF, descriptions: true, thumbnails: true });
  });

  it('keeps only valid saved fields', () => {
    const legacy = { spoilers: true, hideEpisodeDescriptions: true };
    expect(parseSpoilers({}, legacy)).toEqual(OFF);
    expect(parseSpoilers({ titles: true, ratings: 'yes', scope: 'all' }, legacy)).toEqual({ ...OFF, titles: true, scope: 'all' });
    expect(parseSpoilers({ scope: 'everything' }, legacy)).toEqual(OFF);
    expect(parseSpoilers('junk', legacy)).toEqual(OFF);
  });

  it('leaves watched and started episodes clear unless every episode is covered', () => {
    const all: Spoilers = { titles: true, descriptions: true, thumbnails: true, ratings: true, unaired: true, scope: 'unwatched' };
    const hidden = { title: true, description: true, thumbnail: true, rating: true, airDate: true };
    const clear = { title: false, description: false, thumbnail: false, rating: false, airDate: false };
    expect(hiddenFor('watched', all)).toEqual(clear);
    expect(hiddenFor('in-progress', all)).toEqual(clear);
    for (const kind of ['unwatched', 'up-next', 'unaired'] as const) expect(hiddenFor(kind, all)).toEqual(hidden);
    expect(hiddenFor('watched', { ...all, scope: 'all' })).toEqual(hidden);
    expect(hiddenFor('unwatched', { ...all, titles: false })).toEqual({ ...hidden, title: false });
  });
});
