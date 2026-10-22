import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { customLists, findList, listsLoadError, loadLists, onListsChange, removeFromList } from './lists';

const mocked = vi.mocked(invoke);
const row = (id: string) => ({ id, name: id, createdAt: 1, items: [{ titleId: 'tt1', addedAt: 1, title: { meta: { id: 'tt1', type: 'movie', name: 'Film' }, origins: [] } }] });

beforeEach(async () => {
  mocked.mockReset();
  mocked.mockResolvedValue([]);
  await loadLists();
});

describe('custom lists storage', () => {
  it('remembers a failed read, and tells listeners, until a read works', async () => {
    const changed = vi.fn();
    const stop = onListsChange(changed);
    try {
      mocked.mockRejectedValueOnce('database is locked');
      await expect(loadLists()).rejects.toBe('database is locked');
      expect(listsLoadError()).toBe('database is locked');
      expect(changed).toHaveBeenCalledTimes(1);
      mocked.mockResolvedValueOnce([row('good')]);
      await loadLists();
      expect(listsLoadError()).toBeNull();
    } finally {
      stop();
    }
  });

  it('skips corrupt rows and corrupt snapshots without losing valid neighbours', async () => {
    mocked.mockResolvedValue([{ ...row('good'), items: [...row('good').items, { titleId: 'bad', addedAt: 2, title: { meta: {} } }] }, { id: 'bad' }, row('other')]);
    await loadLists();
    expect(customLists().map((list) => list.id)).toEqual(['good', 'other']);
    expect(findList('good')?.titles.map((title) => title.id)).toEqual(['tt1']);
    expect(findList('missing')).toBeUndefined();
  });

  it('ignores an older storage response arriving after a newer reload', async () => {
    let resolveOld!: (rows: unknown[]) => void;
    mocked.mockImplementationOnce(() => new Promise<unknown[]>((resolve) => { resolveOld = resolve; }));
    mocked.mockResolvedValueOnce([row('new')]);
    const changed = vi.fn();
    const stop = onListsChange(changed);
    try {
      const oldLoad = loadLists();
      await loadLists();
      resolveOld([row('old')]);
      await oldLoad;
      expect(customLists().map((list) => list.id)).toEqual(['new']);
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('reloads the saved state even after a failed mutation while preserving the original error', async () => {
    const failure = new Error('storage refused the change');
    mocked.mockRejectedValueOnce(failure).mockResolvedValueOnce([row('kept')]);
    await expect(removeFromList('kept', 'tt1')).rejects.toBe(failure);
    expect(findList('kept')?.titles.map((title) => title.id)).toEqual(['tt1']);
    expect(mocked).toHaveBeenCalledWith('list_remove', { listId: 'kept', titleId: 'tt1' });
  });

  it('stops publishing storage changes after unsubscribing', async () => {
    const changed = vi.fn();
    const stop = onListsChange(changed);
    await loadLists();
    stop();
    await loadLists();
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
