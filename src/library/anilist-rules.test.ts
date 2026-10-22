import { describe, expect, it } from 'vitest';
import { animeIdentity, completedAnimeEpisodes, progressUpdate } from './anilist-rules';
import type { Title } from '../catalog/titles';
import type { Progress } from './watch';

const title: Title = { id: 'kitsu:42', type: 'series', name: 'Anime', genres: [], origins: [] };
const row = (episode: number, watched = true, season = 1): Progress => ({ videoId: `ep${episode}`, titleId: title.id, season, episode, position: 100, duration: 100, watched, updatedAt: 1 });

describe('anime identity', () => {
  it.each([['mal:42', 'mal:42'], ['mal:anime:42', 'mal:42'], ['kitsu:42', 'kitsu:42'], ['tt1234567', 'tt1234567']])('normalizes supported id %s', (input, expected) => {
    expect(animeIdentity(input)).toBe(expected);
  });
  it.each(['mal:0', 'kitsu:../42', 'tt', 'tmdb:42', 'local:42', 'mal:42:1:1'])('rejects unrelated or ambiguous id %s', (id) => {
    expect(animeIdentity(id)).toBeNull();
  });
});

describe('completed anime episodes', () => {
  it('sends only completed positive episode coordinates and keeps the highest per season', () => {
    expect(completedAnimeEpisodes(title, [row(1), row(4, false), row(3), row(0), row(1, true, 0)], false)).toEqual([{ id: 'kitsu:42', season: 1, episode: 3 }]);
  });
  it('blocks all candidates while watch history is paused', () => {
    expect(completedAnimeEpisodes(title, [row(2)], true)).toEqual([]);
  });
  it('does not combine different seasons or unrelated title rows', () => {
    expect(completedAnimeEpisodes({ ...title, id: 'tt123' }, [{ ...row(2), titleId: 'tt123' }, { ...row(3, true, 2), titleId: 'tt123' }, row(9)], false)).toEqual([{ id: 'tt123', season: 1, episode: 2 }, { id: 'tt123', season: 2, episode: 3 }]);
  });
  it('does not scrobble movies or unsupported ids', () => {
    expect(completedAnimeEpisodes({ ...title, type: 'movie' }, [row(2)], false)).toEqual([]);
    expect(completedAnimeEpisodes({ ...title, id: 'local:42' }, [row(2)], false)).toEqual([]);
  });
});

describe('AniList progress rules', () => {
  it('never decreases remote progress or resends an equal episode', () => {
    expect(progressUpdate(8, 3, 12, false)).toBeNull();
    expect(progressUpdate(8, 8, 12, false)).toBeNull();
  });
  it('sets current before the last episode and completed at the known total', () => {
    expect(progressUpdate(2, 3, 12, false)).toEqual({ progress: 3, status: 'CURRENT' });
    expect(progressUpdate(11, 12, 12, false)).toEqual({ progress: 12, status: 'COMPLETED' });
    expect(progressUpdate(11, 99, 12, false)).toBeNull();
  });
  it('does not invent completion for unknown episode totals', () => {
    expect(progressUpdate(0, 12, null, false)).toEqual({ progress: 12, status: 'CURRENT' });
  });
  it('blocks paused history and malformed numbers', () => {
    expect(progressUpdate(0, 1, 12, true)).toBeNull();
    for (const value of [NaN, Infinity, -1, 0, 1.5]) expect(progressUpdate(0, value, 12, false)).toBeNull();
  });
});