import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
// A content limit that lets only tt1 through.
vi.mock('../catalog/parental', () => ({ allowedTitles: async (titles: { id: string }[]) => titles.filter((t) => t.id === 'tt1') }));

import type { Title } from '../catalog/titles';
import type { ContinueEntry, Progress, watchRecord } from './watch';
import { allowedEntries, watchNextItems } from './watch-next';

const title = (over: Partial<Title>): Title => ({ id: 'tt1', type: 'movie', name: 'A film', genres: [], origins: [], ...over }) as Title;
const row = (over: Partial<Progress>): Progress => ({ videoId: 'v', titleId: 'tt1', season: null, episode: null, position: 600, duration: 6000, watched: false, updatedAt: 10, ...over });
const record = (t: Title, rows: Progress[]): ReturnType<typeof watchRecord> => ({ title: t, rows, next: null, completed: false, updatedAt: 1234 });

describe('home-screen Continue Watching', () => {
  it('carries where a film stopped, with its wide picture', () => {
    const film = title({ background: 'https://img/b.jpg', poster: 'https://img/p.jpg' });
    const entry: ContinueEntry = { title: film, progress: 0.1, sub: '' };
    expect(watchNextItems([entry], () => record(film, [row({})]))).toEqual([
      { id: 'tt1', kind: 'movie', title: 'A film', season: null, episode: null, art: 'https://img/b.jpg', wide: true, positionMs: 600_000, durationMs: 6_000_000, next: false, lastWatched: 1234 },
    ]);
  });

  it('resumes the latest episode of a series', () => {
    const show = title({ id: 'tt2', type: 'series', poster: 'https://img/p.jpg' });
    const rows = [row({ titleId: 'tt2', season: 1, episode: 2, updatedAt: 5 }), row({ titleId: 'tt2', season: 1, episode: 3, updatedAt: 9 })];
    const [item] = watchNextItems([{ title: show, progress: 0.2, sub: '' }], () => record(show, rows));
    expect(item).toMatchObject({ kind: 'series', season: 1, episode: 3, art: 'https://img/p.jpg', wide: false, next: false });
  });

  it('never uses a still, and leaves out pictures that aren’t https', () => {
    const show = title({ id: 'tt3', type: 'series', background: 'jellyfin-art://x', poster: 'http://img/p.jpg' });
    const entry: ContinueEntry = { title: show, progress: 0, sub: '', still: 'https://img/spoiler.jpg', spoiler: true };
    const [item] = watchNextItems([entry], () => undefined);
    expect(item).toMatchObject({ art: null, next: true, positionMs: 0, season: null, lastWatched: 0 });
  });
});

describe('home-screen Continue Watching under a content limit', () => {
  it('leaves out what the profile’s limit blocks', async () => {
    const entries: ContinueEntry[] = [title({}), title({ id: 'tt9', name: 'Rated R' })].map((t) => ({ title: t, progress: 0.1, sub: '' }));
    expect((await allowedEntries(entries)).map((e) => e.title.id)).toEqual(['tt1']);
  });
});
