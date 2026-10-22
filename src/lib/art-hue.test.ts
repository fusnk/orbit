import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { artHue, dominantHue, sampleUrl } from './art-hue';

const pixels = (...colours: [number, number, number][]) => colours.flatMap(([r, g, b]) => [r, g, b, 255]);
const fill = (colour: [number, number, number], n = 16) => Array.from({ length: n }, () => colour);

describe('dominantHue', () => {
  it.each([
    [[200, 40, 40], 0],
    [[40, 200, 40], 120],
    [[40, 40, 200], 240],
  ] as const)('finds the hue of a solid colour %j', (colour, hue) => {
    expect(dominantHue(pixels(...fill([...colour])))).toBe(hue);
  });

  it('averages around the colour wheel (red on both sides of 0°)', () => {
    const hue = dominantHue(pixels(...fill([200, 40, 90], 8), ...fill([200, 90, 40], 8)));
    expect(hue === 0 || hue === 360 || (hue ?? 180) < 10 || (hue ?? 180) > 350).toBe(true);
  });

  it('returns null for black-and-white artwork', () => {
    expect(dominantHue(pixels(...fill([20, 20, 20]), ...fill([128, 128, 128]), ...fill([240, 240, 240])))).toBeNull();
  });
});

describe('sampleUrl', () => {
  it('asks TMDB for its small size', () => {
    expect(sampleUrl('https://image.tmdb.org/t/p/w1280/abc.jpg')).toBe('https://image.tmdb.org/t/p/w300/abc.jpg');
    expect(sampleUrl('https://image.tmdb.org/t/p/original/abc.jpg')).toBe('https://image.tmdb.org/t/p/w300/abc.jpg');
  });

  it('leaves other hosts alone', () => {
    expect(sampleUrl('https://images.metahub.space/background/medium/tt1/img')).toBe('https://images.metahub.space/background/medium/tt1/img');
  });
});

describe('artHue', () => {
  const fetches = vi.mocked(invoke);

  it('asks again for artwork whose fetch failed, rather than keeping no colour for the session', async () => {
    // Offline for a moment (the network waking after sleep), every banner's glow stayed grey until a restart.
    fetches.mockReset();
    fetches.mockRejectedValue(new Error('offline'));
    expect(await artHue('https://img.example/failed.jpg')).toBeNull();
    expect(await artHue('https://img.example/failed.jpg')).toBeNull();
    expect(fetches).toHaveBeenCalledTimes(2);
  });

  it('keeps a bounded number of hues, letting the oldest go', () => {
    fetches.mockReset();
    fetches.mockReturnValue(new Promise(() => {}));
    for (let i = 0; i < 2000; i++) void artHue(`https://img.example/${i}.jpg`);
    expect(fetches).toHaveBeenCalledTimes(2000);
    void artHue('https://img.example/1999.jpg');
    expect(fetches).toHaveBeenCalledTimes(2000);
    void artHue('https://img.example/0.jpg');
    expect(fetches).toHaveBeenCalledTimes(2001);
  });
});
