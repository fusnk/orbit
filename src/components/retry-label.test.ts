/**
 * Every "that didn't work" box offers the same word: a rail that couldn't load,
 * the title page and the shared error state all say "Try again", through one
 * key, so no page says "Retry" while the one next to it says "Try again".
 */
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/locales/en';
import cards from './cards.ts?raw';
import stateMessage from './state-message.ts?raw';
import detail from '../rooms/detail/index.ts?raw';

describe('the retry button', () => {
  it('says Try again on a rail, the title page and the shared error box', () => {
    for (const source of [cards, stateMessage, detail]) {
      expect(source).toContain("t('browse.search.retry')");
      expect(source).not.toMatch(/t\('(browse\.service|titles\.detail)\.retry'\)/);
    }
    expect(en['browse.search.retry']).toBe('Try again');
  });

  it('has no second key for the same word', () => {
    expect(en).not.toHaveProperty('browse.service.retry');
    expect(en).not.toHaveProperty('titles.detail.retry');
  });
});
