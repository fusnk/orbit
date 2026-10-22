import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import type { Title } from '../catalog/titles';
import { fromSnapshot, snapshot, SnapshotSchema } from './snapshot';

const title: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: ['Drama'], origins: [{ key: 'addon', name: 'Provider' }], description: 'x'.repeat(900), year: '2000', rating: '8.1', runtime: '100 min' };

describe('library snapshots', () => {
  it('round-trips display metadata while bounding descriptions and excluding episode payloads', () => {
    const stored = snapshot({ ...title, seasons: [{ number: 1, episodes: [] }] });
    const restored = fromSnapshot(v.parse(SnapshotSchema, stored));
    expect(restored).toMatchObject({ id: 'tt1', name: 'Film', year: '2000', rating: '8.1', runtime: '100 min', genres: ['Drama'], origins: [{ key: 'addon', name: 'Provider' }] });
    expect(restored.description).toHaveLength(600);
    expect(stored.meta).not.toHaveProperty('seasons');
    expect(title.description).toHaveLength(900);
  });

  it('validates saved addon artwork and rejects malformed title identity', () => {
    const stored = snapshot({ ...title, poster: 'javascript:alert(1)', background: 'http://img.example/a.jpg' });
    const restored = fromSnapshot(v.parse(SnapshotSchema, stored));
    expect(restored.poster).toBeUndefined();
    expect(restored.background).toBeUndefined();
    expect(v.safeParse(SnapshotSchema, { ...stored, meta: { ...stored.meta, id: '' } }).success).toBe(false);
  });

  it('defaults malformed origins without discarding a valid saved title', () => {
    const stored = snapshot(title);
    const restored = fromSnapshot(v.parse(SnapshotSchema, { ...stored, origins: [{ key: 'addon', name: 42 }] }));
    expect(restored.id).toBe('tt1');
    expect(restored.origins).toEqual([]);
  });
});
