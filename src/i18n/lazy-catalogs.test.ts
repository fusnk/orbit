import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/ipc', () => ({ settings: { get: vi.fn(), set: vi.fn() } }));

const { everyCatalogLoaded, everyTranslation, loadEveryCatalog, setLanguage, t } = await import('./index');

describe('language catalogs loaded on demand', () => {
  it('loads a language when it is chosen, before its strings are used', async () => {
    await setLanguage('de');
    try {
      expect(t('browse.nav.home')).toBe('Startseite');
    } finally {
      await setLanguage('en');
    }
    expect(t('browse.nav.home')).toBe('Home');
  });

  // Every catalog is compiled on first import; alongside the rest of the suite that alone can pass 15 s.
  it('reads every language once all are loaded', { timeout: 60_000 }, async () => {
    await loadEveryCatalog();
    expect(everyCatalogLoaded()).toBe(true);
    const names = everyTranslation('browse.nav.home');
    expect(names[0]).toBe('Home');
    // At least some languages call it something else.
    expect(new Set(names).size).toBeGreaterThan(1);
  });
});
