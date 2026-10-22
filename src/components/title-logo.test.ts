import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));
vi.mock('../theme/appearance', () => ({ appearance: () => ({ logos: true }) }));
/** An image whose error listener the test can fire. */
vi.mock('../lib/dom', () => ({
  h: () => {
    const listeners = new Map<string, () => void>();
    return { listeners, addEventListener: (type: string, listener: () => void) => listeners.set(type, listener) };
  },
}));

import type { Title } from '../catalog/titles';
import { knownLogo, logoImage } from './title-logo';

const titled = (logo: string): Title => ({ id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [], logo });
const fail = (src: string) => (logoImage(src, 'title-logo') as unknown as { listeners: Map<string, () => void> }).listeners.get('error')!();

describe('title logos', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the name for a logo that failed, but tries it again later', () => {
    // Remembered for the whole session, a logo that failed once (the network still waking after
    // sleep, say) showed as a name until Orbit restarted, and the list of them only grew.
    vi.useFakeTimers({ now: 0 });
    const src = 'https://img.example/logo.png';
    fail(src);
    expect(knownLogo(titled(src))).toBeNull();
    vi.setSystemTime(60 * 60_000);
    expect(knownLogo(titled(src))).toBe(src);
  });

  it('remembers a bounded number of failures, letting the oldest go', () => {
    vi.useFakeTimers({ now: 0 });
    for (let i = 0; i < 2000; i++) fail(`https://img.example/${i}.png`);
    expect(knownLogo(titled('https://img.example/0.png'))).toBe('https://img.example/0.png');
    expect(knownLogo(titled('https://img.example/1999.png'))).toBeNull();
  });
});
