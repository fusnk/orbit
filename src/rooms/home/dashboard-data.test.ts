import { describe, expect, it } from 'vitest';
import type { Title } from '../../catalog/titles';
import type { TvChannel, TvGuide } from '../../live/iptv';
import { airedText, onNow, qualityBadges, statusItems } from './dashboard-data';

const title = (id: string): Title => ({ id, type: 'series', name: id, genres: [], origins: [] });
const episode = { videoId: 'tt1:2:1', season: 2, episode: 1, title: 'Hello, Ms. Cobel' };

describe('status tiles', () => {
  it('shows a new episode, finished downloads and My Library, in that order', () => {
    const items = statusItems({ newEpisode: { title: title('tt1'), episode, airedAt: 5 }, downloads: [{ state: 'done' }, { state: 'running' }, { state: 'done' }], library: 27 });
    expect(items.map((item) => item.kind)).toEqual(['episode', 'downloads', 'library']);
    expect(items[1]).toEqual({ kind: 'downloads', count: 2 });
    expect(items[2]).toEqual({ kind: 'library', count: 27 });
  });

  it('leaves out tiles with nothing to say', () => {
    expect(statusItems({ newEpisode: null, downloads: [{ state: 'failed' }, { state: 'queued' }], library: 0 })).toEqual([]);
    expect(statusItems({ newEpisode: null, downloads: [], library: 3 }).map((item) => item.kind)).toEqual(['library']);
  });
});

describe('when an episode aired', () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

  it('says it by calendar day', () => {
    expect(airedText(at(2026, 10, 5, 0), at(2026, 10, 5, 23), 'en-US')).toBe('today');
    expect(airedText(at(2026, 10, 4, 23), at(2026, 10, 5, 1), 'en-US')).toBe('yesterday');
    expect(airedText(at(2026, 10, 2), at(2026, 10, 5), 'en-US')).toBe('3 days ago');
  });

  it('never says the future, even if the clock is behind the guide', () => {
    expect(airedText(at(2026, 10, 6), at(2026, 10, 5), 'en-US')).toBe('today');
  });
});

describe('Live TV on now', () => {
  const channel = (key: string): TvChannel => ({ source: 's', key, name: key.toUpperCase(), logo: null, group: null, favourite: true, rank: null, listed: true, archive: 0 });
  const guide = (key: string, on: boolean): TvGuide => ({ source: 's', key, now: on ? { title: `${key} show`, start: 0, stop: 60, description: null } : null, next: null });
  const favourites = ['a', 'b', 'c', 'd', 'e', 'f'].map(channel);

  it('takes the first favourites, in the person’s order, with what’s on', () => {
    const picked = onNow(favourites, favourites.map((c) => guide(c.key, true)));
    expect(picked.map((e) => e.channel.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(picked[0]!.now?.title).toBe('a show');
  });

  it('prefers channels with a programme on, keeping their order', () => {
    const guides = [guide('a', false), guide('b', true), guide('c', false), guide('d', true), guide('e', true), guide('f', true)];
    expect(onNow(favourites, guides).map((e) => e.channel.key)).toEqual(['b', 'd', 'e', 'f']);
  });

  it('fills up with channels the guide doesn’t list, and shows fewer when there are fewer', () => {
    expect(onNow(favourites, [guide('c', true)]).map((e) => [e.channel.key, !!e.now])).toEqual([
      ['a', false],
      ['b', false],
      ['c', true],
      ['d', false],
    ]);
    expect(onNow(favourites.slice(0, 2), [])).toHaveLength(2);
    expect(onNow([], [])).toEqual([]);
  });
});

describe('picture quality badges', () => {
  it('reads only what the label says', () => {
    expect(qualityBadges('Addon A 4k DV HDR')).toEqual(['4K', 'Dolby Vision']);
    expect(qualityBadges('2160p HDR10 HEVC')).toEqual(['4K', 'HDR']);
    expect(qualityBadges('1080p HDR10+')).toEqual(['HDR']);
    expect(qualityBadges('1080p WEB-DL')).toEqual([]);
    expect(qualityBadges('')).toEqual([]);
  });
});
