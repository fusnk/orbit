import { describe, expect, it } from 'vitest';
import { addRecent, candidate, GROUP_LIMITS, MAX_RECENT, orderGroups, parseRecents, rankGroups, recentKey, recentsFor, TITLES_RANK, withQueuedRecents, type Recent } from './model';

const meta = (id: string, name = id) => ({ meta: { id, type: 'movie', name, posterShape: 'poster' as const }, origins: [] });

describe('rankGroups', () => {
  it('groups matches, best first, capped per group', () => {
    const many = Array.from({ length: 20 }, (_, i) => candidate('yours', `title:${i}`, `t${i}`, `Star ${i}`));
    const groups = rankGroups([...many, candidate('settings', 's', 'subs', 'Subtitle size'), candidate('actions', 'a', 'home', 'Home')], 'star');
    expect(groups.map((g) => g.id)).toEqual(['yours']);
    expect(groups[0]!.items).toHaveLength(GROUP_LIMITS.yours);
    // Ties keep the sources' order.
    expect(groups[0]!.items.slice(0, 2)).toEqual(['t0', 't1']);
  });

  it('takes other caps when given (Search settings shows more)', () => {
    const many = Array.from({ length: 20 }, (_, i) => candidate('settings', `setting:${i}`, i, `Subtitle ${i}`));
    expect(rankGroups(many, 'subtitle', { ...GROUP_LIMITS, settings: 12 })[0]!.items).toHaveLength(12);
  });

  it('orders groups by their best match', () => {
    const groups = rankGroups(
      [candidate('yours', 'title:1', 'film', 'A video diary'), candidate('settings', 'video', 'video', 'Video'), candidate('actions', 'x', 'x', 'Previews of video')],
      'video',
    );
    expect(groups.map((g) => g.id)).toEqual(['settings', 'yours', 'actions']);
  });

  it('matches keywords, below the label’s own matches', () => {
    const groups = rankGroups([candidate('settings', 'audio', 'audio', 'Audio & Subtitles', 'sound captions dub'), candidate('settings', 'cap', 'cap', 'Captions')], 'captions');
    expect(groups[0]!.items).toEqual(['cap', 'audio']);
    // Loose letters never match keywords.
    expect(rankGroups([candidate('settings', 'audio', 'audio', 'Audio', 'sound captions dub')], 'scd')).toEqual([]);
  });

  it('finds nothing for a query of only punctuation or symbols, rather than everything', () => {
    const all = [candidate('settings', 's', 'subs', 'Subtitle size'), candidate('actions', 'a', 'home', 'Home')];
    for (const query of ['?', '-', '…', '🎬']) expect(rankGroups(all, query), query).toEqual([]);
  });

  it('keeps the first copy of a key', () => {
    const groups = rankGroups([candidate('yours', 'title:1', 'continue', 'Dune'), candidate('yours', 'title:1', 'library', 'Dune')], 'dune');
    expect(groups[0]!.items).toEqual(['continue']);
  });

  it('an empty query matches everything', () => {
    expect(rankGroups([candidate('actions', 'a', 1, 'Home'), candidate('actions', 'b', 2, 'Library')], '')[0]!.items).toEqual([1, 2]);
  });

  it('titles sit above weak local matches and below strong ones', () => {
    const order = (best: number) => orderGroups([{ id: 'titles' as const, best: TITLES_RANK }, { id: 'yours' as const, best }]).map((g) => g.id);
    expect(order(1000)).toEqual(['yours', 'titles']);
    expect(order(600)).toEqual(['titles', 'yours']);
  });
});

describe('recent picks', () => {
  const setting: Recent = { kind: 'setting', id: 'video/settings.video.hwdec' };
  const title: Recent = { kind: 'title', title: meta('tt1', 'Dune'), profile: 'p1' };

  it('parses what was saved and drops junk', () => {
    for (const junk of [null, undefined, 1, 'x', {}, { kind: 'setting' }]) expect(parseRecents(junk)).toEqual([]);
    const parsed = parseRecents([setting, { kind: 'nope', id: 'x' }, null, { kind: 'action', id: '' }, title, { kind: 'title', title: { meta: { id: 'x' } }, profile: 'p1' }, { kind: 'list', id: 'l1' }]);
    expect(parsed.map(recentKey)).toEqual(['setting:video/settings.video.hwdec', 'title:tt1']);
  });

  it('drops repeats and keeps at most the limit', () => {
    const list = Array.from({ length: 30 }, (_, i) => ({ kind: 'action', id: `a${i % 12}` }));
    const parsed = parseRecents(list);
    expect(parsed).toHaveLength(MAX_RECENT);
    expect(new Set(parsed.map(recentKey)).size).toBe(MAX_RECENT);
  });

  it('validates a saved title like addon data: artwork that isn’t https is dropped', () => {
    const [entry] = parseRecents([{ kind: 'title', title: { meta: { id: 'tt2', type: 'movie', name: 'X', poster: 'http://example.com/p.jpg' }, origins: [] }, profile: 'p1' }]);
    expect(entry?.kind === 'title' && entry.title.meta.poster).toBeUndefined();
  });

  it('puts the latest pick first, once', () => {
    let list: Recent[] = [];
    list = addRecent(list, setting);
    list = addRecent(list, title);
    list = addRecent(list, setting);
    expect(list.map(recentKey)).toEqual(['setting:video/settings.video.hwdec', 'title:tt1']);
    for (let i = 0; i < 20; i++) list = addRecent(list, { kind: 'action', id: `a${i}` });
    expect(list).toHaveLength(MAX_RECENT);
    expect(recentKey(list[0]!)).toBe('action:a19');
  });

  it('puts picks made before the saved list was read in front of it, newest first, once, capped', () => {
    const saved: Recent[] = [title, setting];
    const queued: Recent[] = [{ kind: 'action', id: 'a1' }, setting, { kind: 'action', id: 'a2' }];
    expect(withQueuedRecents(saved, queued).map(recentKey)).toEqual(['action:a2', 'setting:video/settings.video.hwdec', 'action:a1', 'title:tt1']);
    const many = Array.from({ length: 20 }, (_, i): Recent => ({ kind: 'action', id: `q${i}` }));
    expect(withQueuedRecents(saved, many)).toHaveLength(MAX_RECENT);
    expect(withQueuedRecents(saved, [])).toEqual(saved);
  });

  it('shows a profile only its own titles, lists and addons', () => {
    const list: Recent[] = [setting, title, { kind: 'list', id: 'l1', profile: 'p2' }, { kind: 'addon', key: 'k', name: 'Addon', profile: 'p1' }];
    expect(recentsFor(list, 'p1').map(recentKey)).toEqual(['setting:video/settings.video.hwdec', 'title:tt1', 'addon:k']);
    expect(recentsFor(list, 'p2').map(recentKey)).toEqual(['setting:video/settings.video.hwdec', 'list:l1']);
    expect(recentsFor(list, null).map(recentKey)).toEqual(['setting:video/settings.video.hwdec']);
  });
});
