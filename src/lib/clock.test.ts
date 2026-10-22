import { beforeEach, describe, expect, it, vi } from 'vitest';

const saved = new Map<string, unknown>();
vi.mock('./ipc', () => ({ settings: { get: async (key: string) => saved.get(key) ?? null, set: async (key: string, value: unknown) => void saved.set(key, value) } }));
vi.mock('../i18n', () => ({ locale: () => 'en-US' }));

const { clockFormat, formatClock, loadClock, parseClock, setClock, usesTwelveHour } = await import('./clock');

const evening = new Date(2026, 9, 14, 21, 5);

describe('clock', () => {
  beforeEach(async () => {
    saved.clear();
    await loadClock();
  });

  it('follows the language by default', () => {
    expect(formatClock(evening)).toMatch(/^9:05\sPM$/);
    expect(usesTwelveHour('en-GB')).toBe(false);
  });

  it('is 24-hour or 12-hour when asked, everywhere it formats', async () => {
    await setClock('24');
    expect(formatClock(evening)).toBe('21:05');
    expect(clockFormat(true).format(evening)).toBe('21');
    await setClock('12');
    expect(clockFormat(false, 'en-GB').format(evening)).toMatch(/^9:05\s(pm|PM)$/);
    expect(saved.get('general.clock')).toBe('12');
  });

  it('reads only known choices', () => {
    expect(parseClock('24')).toBe('24');
    expect(parseClock('13')).toBe('system');
    expect(parseClock(null)).toBe('system');
  });
});
