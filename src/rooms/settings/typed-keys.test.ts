import { describe, expect, it, vi } from 'vitest';
import { keyField, saveTypedKeys } from './typed-keys';

const field = (value: string) => ({ value }) as HTMLInputElement;
const root = (...fields: HTMLInputElement[]) => ({ querySelectorAll: () => fields }) as unknown as HTMLElement;

describe('keys typed but not saved', () => {
  it('saves only the key fields with text, and says whether all were saved', async () => {
    const tmdb = field(' key ');
    const debrid = field('');
    const other = field('search text');
    const saveTmdb = vi.fn(async () => true);
    const saveDebrid = vi.fn(async () => true);
    keyField(tmdb, saveTmdb);
    keyField(debrid, saveDebrid);
    expect(await saveTypedKeys(root(tmdb, debrid, other))).toBe(true);
    expect(saveTmdb).toHaveBeenCalledOnce();
    expect(saveDebrid).not.toHaveBeenCalled();

    const bad = field('wrong');
    keyField(bad, async () => false);
    expect(await saveTypedKeys(root(tmdb, bad))).toBe(false);
    expect(await saveTypedKeys(root())).toBe(true);
  });
});
