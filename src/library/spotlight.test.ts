import { describe, expect, it } from 'vitest';
import type { Title } from '../catalog/titles';
import { spotlight } from './spotlight';

const title = (id: string, background?: string): Title => ({ id, type: 'movie', name: id, genres: [], origins: [], ...(background ? { background } : {}) });
const all = () => true;

describe('My Library spotlight', () => {
  it('features the newest title in Continue Watching first', () => {
    const resume = [{ title: title('a') }, { title: title('b', 'art') }];
    expect(spotlight(resume, [{ title: title('c', 'art') }], all)).toEqual({ kind: 'resume', entry: resume[0], title: resume[0]!.title });
  });

  it('skips what the content limit hides', () => {
    const resume = [{ title: title('kids-no') }];
    const result = spotlight(resume, [{ title: title('ok', 'art') }], (t) => t.id !== 'kids-no');
    expect(result).toEqual({ kind: 'added', title: title('ok', 'art') });
  });

  it('otherwise the latest addition, preferring one with artwork', () => {
    const saved = [{ title: title('newest') }, { title: title('older', 'art') }];
    expect(spotlight([], saved, all)?.title.id).toBe('older');
    expect(spotlight([], [{ title: title('only') }], all)?.title.id).toBe('only');
  });

  it('features nothing in an empty library', () => {
    expect(spotlight([], [], all)).toBeUndefined();
  });
});
