import { describe, expect, it } from 'vitest';
import { nextSource } from './next-up';
import type { PlayableSource } from './panels';

const source = (id: string): PlayableSource => ({ id, url: `https://cdn.example/${id}`, addon: 'Addon', label: '1080p', meta: '' });
const ranked = ['a', 'b', 'c', 'd'].map(source);

describe('nextSource', () => {
  it('picks the best-ranked source not yet tried', () => {
    expect(nextSource(ranked, ranked[0]!, new Set(['a']))?.id).toBe('b');
    expect(nextSource(ranked, ranked[1]!, new Set(['a', 'b']))?.id).toBe('c');
  });

  it('goes back up the list for sources skipped by hand', () => {
    // The viewer chose c first; a and b are still untried.
    expect(nextSource(ranked, ranked[2]!, new Set(['c']))?.id).toBe('a');
  });

  it('has nothing left once every source was tried', () => {
    expect(nextSource(ranked, ranked[3]!, new Set(['a', 'b', 'c', 'd']))).toBeUndefined();
    expect(nextSource([ranked[0]!], ranked[0]!, new Set())).toBeUndefined();
  });

  it('tries sources that failed recently last', () => {
    const failed = (s: PlayableSource) => s.id === 'b' || s.id === 'c';
    expect(nextSource(ranked, ranked[0]!, new Set(['a']), failed)?.id).toBe('d');
    expect(nextSource(ranked, ranked[3]!, new Set(['a', 'd']), failed)?.id).toBe('b');
  });
});
