import { describe, expect, it } from 'vitest';
import { mergeLateSources } from './late-sources';
import type { PlayableSource } from './panels';

const source = (id: string, addon: string, url: string): PlayableSource => ({ id, addon, url, label: '1080p', meta: '' }) as PlayableSource;

describe('mergeLateSources', () => {
  const cloud = source('n1', 'In your cloud', 'orbit-debrid://1');
  const fast = source('n2', 'Addon A', 'https://a/1');

  it('takes the full list, keeping the playing source as it was', () => {
    const slow = source('n1', 'Addon D', 'https://b/1');
    const merged = mergeLateSources(cloud, [cloud, fast], [source('n9', 'In your cloud', 'orbit-debrid://1'), slow, source('n2', 'Addon A', 'https://a/1')]);
    expect(merged.map((s) => s.addon)).toEqual(['In your cloud', 'Addon D', 'Addon A']);
    expect(merged[0]).toBe(cloud);
  });

  it('never repeats an id, even though each round numbers from the start', () => {
    const merged = mergeLateSources(cloud, [cloud, fast], [source('n1', 'Addon D', 'https://b/1'), source('n2', 'Addon A', 'https://a/1')]);
    const ids = merged.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps sources only the first list had, at the end', () => {
    const merged = mergeLateSources(fast, [cloud, fast], [source('n1', 'Addon A', 'https://a/1')]);
    expect(merged.map((s) => s.url)).toEqual(['https://a/1', 'orbit-debrid://1']);
  });

  it('keeps the playing source after another file of its torrent was picked', () => {
    const torrent = source('n2', 'Addon A', 'https://a/1');
    const picked = { ...torrent, url: 'https://a/1?file=3' };
    const merged = mergeLateSources(picked, [cloud, torrent], [source('n1', 'Addon A', 'https://a/1'), source('n2', 'Addon D', 'https://b/1')]);
    expect(merged.map((s) => s.url)).toEqual(['https://a/1?file=3', 'https://b/1', 'orbit-debrid://1']);
    expect(merged[0]).toBe(picked);
  });
});
