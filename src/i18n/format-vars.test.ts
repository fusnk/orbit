import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/ipc', () => ({ settings: { get: vi.fn(), set: vi.fn() } }));

const { formatDecimal, setLanguage, t, tn } = await import('./index');

describe('numbers in strings', () => {
  it('group counts the way the language does', async () => {
    await setLanguage('en').catch(() => {});
    expect(tn('browse.discover.titles', 12000)).toBe('12,000 titles');
  });

  it('leave ids, years, seasons and episode numbers ungrouped', async () => {
    await setLanguage('en').catch(() => {});
    expect(t('collections.source.tmdb-id', { kind: 'Collection', id: 86311 })).toBe('Collection 86311');
    expect(t('titles.common.episode-code', { season: 1, episode: 1100 })).toBe('S1 · E1100');
    expect(t('insights.review.title', { year: 2026 })).toBe('Your 2026 in Orbit');
    expect(t('browse.titles.episode', { number: 1050 })).toBe('Episode 1050');
  });
});

describe('one-decimal numbers (ratings)', () => {
  // The German catalog is compiled on first import; alongside the rest of the suite that alone can pass the time limit.
  it('follow Orbit’s language, not the system’s', { timeout: 60_000 }, async () => {
    await setLanguage('de').catch(() => {});
    expect(formatDecimal(7)).toBe('7,0');
    await setLanguage('en').catch(() => {});
    expect(formatDecimal(7.06)).toBe('7.1');
  });

  it('are how poster scores read', async () => {
    const { posterScores } = await import('../lib/poster-ratings');
    await setLanguage('de').catch(() => {});
    expect(posterScores({ imdb: '8.12', tmdb: 7, letterboxd: 3.87 }).map((s) => s.value)).toEqual(['8,1', '7,0', '3,9']);
    await setLanguage('en').catch(() => {});
  });
});
