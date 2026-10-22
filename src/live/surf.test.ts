import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TvChannel } from './iptv';
import { channelInitial, debounce, dropIndex, favouritesInOrder, moveItem, nearby, lastKey, parseLast, parseOpenOn, progressOf, stepIndex, withLast } from './surf';

const channel = (key: string, favourite = false, rank: number | null = null): TvChannel => ({ source: 's', key, name: key, logo: null, group: null, favourite, rank, listed: true, archive: 0 });

describe('surfing', () => {
  it('steps to the next and previous channel, wrapping around', () => {
    expect(stepIndex(5, 0, 1)).toBe(1);
    expect(stepIndex(5, 4, 1)).toBe(0);
    expect(stepIndex(5, 0, -1)).toBe(4);
    expect(stepIndex(5, 2, -7)).toBe(0);
    expect(stepIndex(1, 0, 1)).toBe(0);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });

  it('lists the channels around the current one, wrapping', () => {
    expect(nearby(3, 1, 2)).toEqual([0, 1, 2]);
    expect(nearby(10, 0, 2)).toEqual([8, 9, 0, 1, 2]);
    expect(nearby(10, 9, 1)).toEqual([8, 9, 0]);
    expect(nearby(0, 0, 2)).toEqual([]);
  });

  it('says how far through a programme it is', () => {
    const show = { title: 'x', start: 100, stop: 200, description: null };
    expect(progressOf(show, 150)).toBe(0.5);
    expect(progressOf(show, 50)).toBe(0);
    expect(progressOf(show, 300)).toBe(1);
    expect(progressOf({ ...show, stop: 100 }, 150)).toBe(0);
  });
});

describe('debounce', () => {
  afterEach(() => vi.useRealTimers());

  it('runs once, with the latest arguments, after presses stop', () => {
    vi.useFakeTimers();
    const tuned: number[] = [];
    const tune = debounce(600, (n: number) => tuned.push(n));
    tune.call(1);
    vi.advanceTimersByTime(400);
    tune.call(2);
    vi.advanceTimersByTime(400);
    tune.call(3);
    expect(tune.pending()).toBe(true);
    vi.advanceTimersByTime(599);
    expect(tuned).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(tuned).toEqual([3]);
    expect(tune.pending()).toBe(false);
  });

  it('can be cancelled', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const tune = debounce(600, fn);
    tune.call();
    tune.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('favourites order', () => {
  it('lists favourites by rank, keeping the list order for ties', () => {
    const list = [channel('a', true, 2), channel('b'), channel('c', true, 0), channel('d', true, 0), channel('e', true, null)];
    expect(favouritesInOrder(list).map((c) => c.key)).toEqual(['c', 'd', 'a', 'e']);
  });

  it('moves an item, clamping where it goes', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 1, -4)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c']);
  });

  it('works out where a dragged row lands', () => {
    const middles = [10, 30, 50, 70];
    expect(dropIndex(middles, 0, 5)).toBe(0);
    expect(dropIndex(middles, 0, 55)).toBe(2);
    expect(dropIndex(middles, 0, 99)).toBe(3);
    expect(dropIndex(middles, 3, 0)).toBe(0);
    expect(dropIndex(middles, 2, 40)).toBe(2);
    expect(moveItem(['a', 'b', 'c', 'd'], 0, dropIndex(middles, 0, 55))).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('Live TV settings', () => {
  it('opens on all channels unless set otherwise', () => {
    expect(parseOpenOn('favourites')).toBe('favourites');
    expect(parseOpenOn('last')).toBe('last');
    expect(parseOpenOn('all')).toBe('all');
    expect(parseOpenOn(null)).toBe('all');
    expect(parseOpenOn(42)).toBe('all');
    expect(parseOpenOn({ open: 'last' })).toBe('all');
  });

  it('reads the profile’s last group and channel, ignoring junk', () => {
    expect(parseLast({ group: { name: 'News' }, channel: { source: 's', key: 'k' } })).toEqual({ group: { name: 'News' }, channel: { source: 's', key: 'k' } });
    expect(parseLast({ group: 'favourites', channel: { source: 's' } })).toEqual({ group: 'favourites' });
    for (const junk of [null, undefined, 'x', 7, [], [{ group: 'all' }], { group: 'other', channel: 'k' }, { group: { name: '' }, channel: { source: 1, key: 2 } }]) {
      expect(parseLast(junk)).toEqual({});
    }
    expect(parseLast({ group: { name: 'x'.repeat(301) } })).toEqual({});
  });

  it('remembers a change on top of what was saved, dropping junk', () => {
    expect(withLast({ group: 'all' }, { channel: { source: 's', key: 'k2' } })).toEqual({ group: 'all', channel: { source: 's', key: 'k2' } });
    expect(withLast('junk', { group: { name: 'News' } })).toEqual({ group: { name: 'News' } });
  });

  it('keeps each profile’s place in its own setting', () => {
    expect(lastKey('0123456789abcdef')).toBe('live.last.0123456789abcdef');
    expect(lastKey('main')).toBe('live.last.main');
    // Never a key another setting could be, nor the old shared one.
    for (const bad of ['', 'A', 'a/b', 'x'.repeat(41)]) expect(lastKey(bad)).toBeNull();
  });
});

describe('channel logos', () => {
  it('stands in for a missing logo with the name\'s first letter, not half an emoji or a provider\'s bracket', () => {
    expect(channelInitial('BBC One')).toBe('B');
    // A flag is two characters of two UTF-16 units each: its first unit alone drew a broken glyph.
    expect(channelInitial('\u{1F1EC}\u{1F1E7} BBC One')).toBe('B');
    expect(channelInitial('|UK| Sky News')).toBe('U');
    expect(channelInitial('[4K] 24 Kitchen')).toBe('4');
    expect(channelInitial('\u{1D538}lpha')).toBe('\u{1D538}');
    expect(channelInitial('\u{1F3C8}')).toBe('\u{1F3C8}');
    expect(channelInitial('')).toBe('');
  });
});
