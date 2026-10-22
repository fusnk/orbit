import { expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));
// The page's pieces aren't needed to read an address.
vi.mock('../../app/activity', () => ({}));
vi.mock('../../components/cards', () => ({}));
vi.mock('../../components/text-field', () => ({}));
vi.mock('../../components/toast', () => ({}));
vi.mock('../settings/playback', () => ({}));
vi.mock('./page', () => ({}));
vi.mock('./parts', () => ({}));
vi.mock('./collections.css', () => ({}));

const { readTmdbId } = await import('./edit');

it('reads a TMDB id or address, keeping Director for a person’s page', () => {
  expect(readTmdbId(' 10 ', 'collection')).toEqual({ id: 10, kind: 'collection' });
  expect(readTmdbId('https://www.themoviedb.org/collection/10-star-wars-collection', 'company')).toEqual({ id: 10, kind: 'collection' });
  // A director has no address of their own: their person page with Director chosen is their films as director.
  expect(readTmdbId('https://www.themoviedb.org/person/137427-denis-villeneuve', 'director')).toEqual({ id: 137427, kind: 'director' });
  expect(readTmdbId('https://www.themoviedb.org/person/137427-denis-villeneuve', 'collection')).toEqual({ id: 137427, kind: 'person' });
  expect(readTmdbId('0', 'list')).toBeNull();
  expect(readTmdbId('https://evil.example/collection/10', 'collection')).toBeNull();
});
