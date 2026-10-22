import { describe, expect, it, vi } from 'vitest';
import { isPlaceholderMeta } from './placeholder';
import { CatalogResponseSchema, parseWith } from './schema';

const poster = 'https://img.addon-a.example/x.png';

describe('isPlaceholderMeta', () => {
  it.each([
    ['a bare "error" id', { id: 'error', name: 'Something' }],
    ['a prefixed error id', { id: 'tmdb:error', name: 'Error Loading Content' }],
    ['a "noresults" id', { id: 'noresults', name: 'No results' }],
    ['a dashed no-results id', { id: 'addon-a:no-results', name: 'Nothing here' }],
    ['an addon-prefixed error id', { id: 'aiostreams-error', name: '[❌] Error' }],
    [
      'an error name with an error description',
      { id: 'tmdb:0', name: 'Error Loading Content', description: 'Could not load this catalog. Please try again later.' },
    ],
    ['an error name on an id with no number', { id: 'addon-a:placeholder-item', name: 'No Content' }],
    ['an invalid key message', { id: 'addon-a:x', name: 'Invalid API key', description: 'Check your configuration.' }],
    ['punctuation and emoji around the phrase', { id: 'addon-a:msg', name: '⚠️ Something went wrong!' }],
  ])('drops %s', (_, meta) => {
    expect(isPlaceholderMeta(meta)).toBe(true);
  });

  it.each([
    ['a real film named "Error" with an IMDb id', { id: 'tt1234567', name: 'Error', description: 'An error in the code sets off a chain of events.' }],
    ['an IMDb id even with error wording', { id: 'tt7654321', name: 'No Results', description: 'Try again, he said.' }],
    ['a real TMDB title named "Error" with a normal plot', { id: 'tmdb:55555', name: 'Error', description: 'A hacker discovers a flaw.' }],
    ['a title merely starting with "Error"', { id: 'addon-a:film', name: 'Errors of the Heart' }],
    ['an ordinary title', { id: 'kitsu:42', name: 'Cowboy Bebop' }],
    ['an id that contains an error word but is not one', { id: 'tt0000error1', name: 'Something' }],
  ])('keeps %s', (_, meta) => {
    expect(isPlaceholderMeta(meta)).toBe(false);
  });
});

describe('CatalogResponseSchema placeholders', () => {
  it('drops placeholder items and keeps the real ones', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { metas } = parseWith(CatalogResponseSchema, {
      metas: [
        { id: 'tt0111161', type: 'movie', name: 'The Shawshank Redemption', poster },
        { id: 'tmdb:error', type: 'series', name: 'Error Loading Content', description: 'An error occurred while loading content.', poster },
      ],
    });
    expect(metas.map((m) => m.id)).toEqual(['tt0111161']);
    expect(debug).toHaveBeenCalledOnce();
    expect(String(debug.mock.calls[0]?.[0])).not.toMatch(/https?:/);
    debug.mockRestore();
  });

  it('leaves an empty catalog when every item is a placeholder', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { metas } = parseWith(CatalogResponseSchema, {
      metas: [{ id: 'noresults', type: 'series', name: 'No Content', poster }],
    });
    expect(metas).toEqual([]);
    debug.mockRestore();
  });
});
