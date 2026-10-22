import { describe, expect, it, vi } from 'vitest';

const NOW = Date.parse('2026-10-05T12:00:00Z');
// Episode 2 airs tonight at 21:00 UTC, episode 1 aired this morning; episode 3's time isn't known.
const exact: Record<string, number> = { 'tt9:1:1': Date.parse('2026-10-05T02:00:00Z'), 'tt9:1:2': Date.parse('2026-10-05T21:00:00Z') };
vi.mock('../catalog/air-times', () => ({ exactAirTime: (id: string, season: number, episode: number) => exact[`${id}:${season}:${episode}`], loadAirTimes: async () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../catalog/service', () => ({ loadMeta: vi.fn() }));

const { freshEpisodes, nextAirTime } = await import('./alerts');

const show = {
  id: 'tt9',
  type: 'series',
  name: 'Show',
  genres: [],
  origins: [],
  seasons: [
    {
      number: 1,
      episodes: [
        { id: 'e1', number: 1, title: 'One', released: '2026-10-05T00:00:00.000Z' },
        { id: 'e2', number: 2, title: 'Two', released: '2026-10-05T00:00:00.000Z' },
        { id: 'e3', number: 3, title: 'Three', released: '2026-10-05T00:00:00.000Z' },
      ],
    },
  ],
};

describe('new-episode alerts with exact air times', () => {
  it('announce an episode once it has aired, not from the start of its day', () => {
    const found = freshEpisodes(show, NOW - 7 * 86_400_000, NOW, new Set());
    expect(found.map((item) => [item.videoId, item.airedAt])).toEqual([
      ['e1', exact['tt9:1:1']],
      // A date only: from the start of that day locally.
      ['e3', new Date(2026, 9, 5).getTime()],
    ]);
  });

  it('know when the next one airs, so a check can be set for then', () => {
    expect(nextAirTime(show, NOW)).toBe(exact['tt9:1:2']);
    expect(nextAirTime(show, exact['tt9:1:2']!)).toBeUndefined();
  });
});
