import { describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { collectionsLoadError, customCollections, loadCollections } from './collections';

describe('loading collections', () => {
  it('remembers a failed read, so Collections can tell it apart from none, and reads again on the next load', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('database is locked');
    await loadCollections();
    expect(collectionsLoadError()).toBe('database is locked');
    expect(customCollections()).toEqual([]);
    vi.mocked(invoke).mockResolvedValueOnce([{ id: '0123456789abcdef', name: 'Marvel', art: {}, sources: [], createdAt: 1, items: [] }]);
    await loadCollections();
    expect(collectionsLoadError()).toBeNull();
    expect(customCollections().map((c) => c.name)).toEqual(['Marvel']);
  });
});
