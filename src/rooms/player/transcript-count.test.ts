import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/ipc', () => ({ settings: { get: vi.fn(), set: vi.fn() } }));

const { setLanguage, tn } = await import('../../i18n');

describe('transcript match count', () => {
  // The French catalog is compiled on first import; alongside the rest of the suite that alone can pass the time limit.
  it('says "1 match", not "1 matches"', { timeout: 60_000 }, async () => {
    await setLanguage('en').catch(() => {});
    expect(tn('player.transcript.matches', 1)).toBe('1 match');
    expect(tn('player.transcript.matches', 3)).toBe('3 matches');
    await setLanguage('fr').catch(() => {});
    expect(tn('player.transcript.matches', 1)).toBe('1 résultat');
    expect(tn('player.transcript.matches', 2)).toBe('2 résultats');
    await setLanguage('en').catch(() => {});
  });
});
