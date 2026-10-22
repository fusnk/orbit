import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../components/toast', () => ({ toast: vi.fn() }));
const profile = vi.hoisted(() => ({ id: 'main' as string | null }));
vi.mock('./profiles', () => ({ activeProfileId: () => Promise.resolve(profile.id) }));

import { invoke } from '@tauri-apps/api/core';
import type { Title } from '../catalog/titles';
import { toast } from '../components/toast';
import { addLibraryGenres, inLibrary, libraryEntry, restoreLibrary, libraryEntries, libraryLoadError, loadLibrary, toggleLibrary } from './library';

const mocked = vi.mocked(invoke);
const title: Title = { id: 'tt1', type: 'movie', name: 'One', poster: 'https://img.example/1.jpg', genres: ['Drama'], origins: [{ key: 'a', name: 'A' }] };

beforeEach(async () => {
  profile.id = 'main';
  mocked.mockReset();
  mocked.mockResolvedValueOnce([]);
  await loadLibrary();
});

describe('loadLibrary', () => {
  it('keeps valid rows and skips ones that no longer validate', async () => {
    mocked.mockResolvedValueOnce([
      { id: 'tt1', addedAt: 5, title: { meta: { id: 'tt1', type: 'movie', name: 'One', poster: 'https://img.example/1.jpg' }, origins: [] } },
      { id: 'tt2', addedAt: 6, title: { meta: { id: 'tt2', type: 'movie' } } },
    ]);
    await loadLibrary();
    expect(libraryEntries().map((e) => [e.title.name, e.title.poster, e.addedAt])).toEqual([['One', 'https://img.example/1.jpg', 5]]);
  });

  it('remembers a failed load, so My Library can tell it apart from an empty one, until a load works', async () => {
    expect(libraryLoadError()).toBeNull();
    const failure = new Error('database is locked');
    mocked.mockRejectedValueOnce(failure);
    await expect(loadLibrary()).rejects.toThrow('database is locked');
    expect(libraryLoadError()).toBe(failure);
    expect(libraryEntries()).toEqual([]);
    mocked.mockResolvedValueOnce([]);
    await loadLibrary();
    expect(libraryLoadError()).toBeNull();
  });
});

describe('toggleLibrary', () => {
  it('saves a snapshot, then removes it', async () => {
    mocked.mockResolvedValue(undefined);
    expect(await toggleLibrary(title)).toBe(true);
    expect(inLibrary('tt1')).toBe(true);
    expect(mocked).toHaveBeenLastCalledWith('library_add', { id: 'tt1', profile: 'main', addedAt: expect.any(Number), title: expect.objectContaining({ meta: expect.objectContaining({ name: 'One', genres: ['Drama'] }) }) });
    expect(await toggleLibrary(title)).toBe(true);
    expect(inLibrary('tt1')).toBe(false);
    expect(mocked).toHaveBeenLastCalledWith('library_remove', { id: 'tt1', profile: 'main' });
  });

  it('undoes the change and tells the user when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocked.mockRejectedValueOnce(new Error('disk full'));
    const pending = toggleLibrary(title);
    expect(inLibrary('tt1')).toBe(true);
    expect(await pending).toBe(false);
    expect(inLibrary('tt1')).toBe(false);
    expect(toast).toHaveBeenCalled();
  });
});

describe('quick toggles', () => {
  it('reach storage in the order they were made', async () => {
    const order: string[] = [];
    // Adding is slow; removing right after must still be saved after it.
    mocked.mockImplementation(async (cmd) => {
      if (cmd === 'library_add') await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(cmd);
    });
    await Promise.all([toggleLibrary(title), toggleLibrary(title)]);
    expect(order).toEqual(['library_add', 'library_remove']);
    expect(inLibrary('tt1')).toBe(false);
  });
});

describe('profiles', () => {
  it('saves each change for the profile the library was read for, so one landing after a switch is refused rather than filed under the next profile', async () => {
    mocked.mockResolvedValueOnce([]);
    await loadLibrary();
    // The switch has begun (Rust's active profile is another one) while this window still shows the old library.
    profile.id = 'kids';
    mocked.mockResolvedValue(undefined);
    await toggleLibrary(title);
    expect(mocked).toHaveBeenLastCalledWith('library_add', expect.objectContaining({ id: 'tt1', profile: 'main' }));
    await toggleLibrary(title);
    expect(mocked).toHaveBeenLastCalledWith('library_remove', { id: 'tt1', profile: 'main' });
  });

  it('files found genres under the same profile', async () => {
    mocked.mockResolvedValueOnce([{ id: 'tt1', addedAt: 5, title: { meta: { id: 'tt1', type: 'movie', name: 'One' }, origins: [] } }]);
    await loadLibrary();
    profile.id = 'kids';
    mocked.mockResolvedValue(undefined);
    addLibraryGenres(new Map([['tt1', ['Drama']]]));
    await vi.waitFor(() => expect(mocked).toHaveBeenLastCalledWith('library_add', expect.objectContaining({ id: 'tt1', profile: 'main' })));
  });
});

describe('restoreLibrary', () => {
  it('puts a removed title back where it was in "Recently added", with when it was first added', async () => {
    const older = { ...title, id: 'tt2', name: 'Two' };
    mocked.mockResolvedValueOnce([
      { id: 'tt1', addedAt: 100, title: { meta: { id: 'tt1', type: 'movie', name: 'One' }, origins: [] } },
      { id: 'tt2', addedAt: 50, title: { meta: { id: 'tt2', type: 'movie', name: 'Two' }, origins: [] } },
    ]);
    await loadLibrary();
    mocked.mockResolvedValue(undefined);
    const removed = libraryEntry('tt2')!;
    await toggleLibrary(older);
    await restoreLibrary(removed);
    expect(libraryEntries().map((e) => [e.title.id, e.addedAt])).toEqual([['tt1', 100], ['tt2', 50]]);
    expect(mocked).toHaveBeenLastCalledWith('library_add', expect.objectContaining({ id: 'tt2', addedAt: 50 }));
  });

  it('leaves a title saved again meanwhile as it is', async () => {
    mocked.mockResolvedValue(undefined);
    await toggleLibrary(title);
    const removed = libraryEntry('tt1')!;
    await toggleLibrary(title);
    await toggleLibrary(title);
    const calls = mocked.mock.calls.length;
    expect(await restoreLibrary(removed)).toBe(true);
    expect(inLibrary('tt1')).toBe(true);
    expect(mocked.mock.calls.length).toBe(calls);
  });
});
