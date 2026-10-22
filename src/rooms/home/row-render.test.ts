import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Title } from '../../catalog/titles';

vi.mock('../../catalog/service', () => ({ loadCatalog: async () => [] }));
vi.mock('../../catalog/streaming', () => ({ streamingRegion: async () => 'US' }));
vi.mock('../../catalog/tmdb', () => ({}));
vi.mock('../../components/cards', () => ({}));
vi.mock('../../lib/dom', () => ({}));
const jellyfin = {
  status: async (): Promise<unknown> => null,
  libraries: async (): Promise<unknown[]> => [],
};
vi.mock('../../library/jellyfin', () => ({ jellyfinStatus: () => jellyfin.status(), jellyfinLibraries: () => jellyfin.libraries(), jellyfinRow: null }));
vi.mock('../../library/plex', () => ({ plexStatus: null, plexLibraries: null, plexRow: null }));
vi.mock('../../library/library', () => ({ inLibrary: () => false, libraryEntries: () => [] }));
vi.mock('../../library/lists', () => ({ customLists: () => [], findList: () => undefined }));
vi.mock('../../library/collections', () => ({}));
vi.mock('../collections/overview', () => ({}));
vi.mock('../streaming/service', () => ({}));
vi.mock('./card-tags', () => ({}));
vi.mock('./dashboard', () => ({}));

const started: Title[] = [];
const finished: { title: Title; updatedAt: number }[] = [];
vi.mock('../../library/watch', () => ({ recentlyWatched: () => started, watchedTitles: () => finished }));

const { onceEach, resolveAddedRows } = await import('./row-render');

const alien: Title = { id: 'tt1', type: 'movie', name: 'Alien', genres: [], origins: [] };
const deps = { refs: [] } as never;

async function version(mood: 'feel-good' | 'comfort' | 'hidden-gems'): Promise<string> {
  const rows = await resolveAddedRows([{ id: 'row-a', source: { kind: 'mood', mood } }], deps);
  return rows.get('row-a')!.version;
}

describe('mood rows', () => {
  it('are redrawn once something is started or finished, as they leave out what was seen', async () => {
    for (const mood of ['feel-good', 'comfort', 'hidden-gems'] as const) {
      started.length = 0;
      finished.length = 0;
      const before = await version(mood);
      started.push(alien);
      finished.push({ title: alien, updatedAt: 1 });
      expect(await version(mood), mood).not.toBe(before);
    }
  });
});

describe('server library rows', () => {
  const LIBRARY = 'a'.repeat(32);
  const row = { id: 'row-a', source: { kind: 'jellyfin' as const, feed: 'library' as const, library: LIBRARY } };
  // Signed in to a server in every test here, whichever runs first.
  beforeEach(() => {
    jellyfin.status = async () => ({ serverName: 'Den', userName: 'sam', host: 'h', insecure: true });
  });

  it('stay on Home when the server can’t list its libraries just now, so the row can say why and retry', async () => {
    jellyfin.libraries = async () => {
      throw new Error('Couldn’t reach the Jellyfin server.');
    };
    const resolved = (await resolveAddedRows([row], deps)).get('row-a')!;
    expect(resolved.feed).toBeDefined();
  });

  it('are gone once the server no longer has the library', async () => {
    jellyfin.libraries = async () => [{ id: 'b'.repeat(32), name: 'Films', kind: 'movies' }];
    expect((await resolveAddedRows([row], deps)).get('row-a')!.feed).toBeUndefined();
    jellyfin.libraries = async () => [{ id: LIBRARY, name: 'Films', kind: 'movies' }];
    expect((await resolveAddedRows([row], deps)).get('row-a')!.feed?.title).toBe('Films');
  });
});

describe('onceEach', () => {
  it('keeps a title an addon listed twice once, at its first place', () => {
    const t = (id: string): Title => ({ id, type: 'movie', name: id, genres: [], origins: [] });
    expect(onceEach([t('a'), t('b'), t('a'), t('c'), t('b')]).map((title) => title.id)).toEqual(['a', 'b', 'c']);
  });
});
