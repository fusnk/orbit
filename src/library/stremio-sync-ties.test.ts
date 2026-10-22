import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string) => (cmd === 'watch_list' ? { titles: [], progress: [] } : undefined)) }));

import type { Episode, Title } from '../catalog/titles';
import { importSeries, type StremioItem } from './stremio-sync';
import { cardProgress, continueWatching, lastWatchedAt, loadWatch, resumingVideoId } from './watch';

const ep = (number: number): Episode => ({ id: `tt9:1:${number}`, number, title: `Episode ${number}` });
const show: Title = { id: 'tt9', type: 'series', name: 'Show', genres: [], origins: [], seasons: [{ number: 1, episodes: [ep(1), ep(2), ep(3), ep(4)] }] };
const AT = Date.parse('2026-10-01T12:00:00Z');

beforeEach(async () => {
  await loadWatch();
});

it('a series part way through in Stremio, with earlier episodes watched there, lands in Continue Watching', () => {
  // Watched episodes 1 and 2 in Stremio, and 10 minutes into episode 3.
  const item: StremioItem = { _id: 'tt9', type: 'series', name: 'Show', poster: null, state: { lastWatched: '2026-10-01T12:00:00Z', timeOffset: 600_000, duration: 2_400_000, video_id: 'tt9:1:3', timesWatched: 0, watched: null } };
  importSeries(item, show, new Set(['tt9:1:1', 'tt9:1:2']), AT);
  expect(resumingVideoId('tt9')).toBe('tt9:1:3');
  expect(cardProgress('tt9')).toEqual(expect.objectContaining({ episode: 'S1 · E3' }));
  expect(lastWatchedAt('tt9')).toBe(AT);
  expect(continueWatching()).toEqual([expect.objectContaining({ title: expect.objectContaining({ id: 'tt9' }), sub: 'S1 · E3' })]);
});
