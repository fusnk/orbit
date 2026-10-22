import type { Title } from '../catalog/titles';
import type { Progress } from './watch';

export interface AniListEpisode { id: string; season: number; episode: number }

/** Only stable namespaces can be matched without guessing from a title. */
export function animeIdentity(id: string): string | null {
  const match = /^(mal|kitsu):(?:anime:)?([1-9]\d{0,8})$/.exec(id);
  if (match) return `${match[1]}:${match[2]}`;
  return /^tt\d{1,16}$/.test(id) ? id : null;
}

export function completedAnimeEpisodes(title: Pick<Title, 'id' | 'type'>, rows: readonly Progress[], paused: boolean): AniListEpisode[] {
  const id = animeIdentity(title.id);
  if (paused || !id || title.type !== 'series') return [];
  const seasons = new Map<number, number>();
  for (const row of rows) {
    if (row.titleId !== title.id || !row.watched || !Number.isSafeInteger(row.season) || !Number.isSafeInteger(row.episode) || row.season === null || row.episode === null || row.season < 1 || row.episode < 1) continue;
    seasons.set(row.season, Math.max(seasons.get(row.season) ?? 0, row.episode));
  }
  return [...seasons].sort(([a], [b]) => a - b).map(([season, episode]) => ({ id, season, episode }));
}

/** Mirrors the native mutation guard; Rust also reads remote progress before writing. */
export function progressUpdate(remote: number, watched: number, total: number | null, paused: boolean): { progress: number; status: 'CURRENT' | 'COMPLETED' } | null {
  if (paused || !Number.isSafeInteger(remote) || remote < 0 || !Number.isSafeInteger(watched) || watched < 1) return null;
  const known = total !== null && Number.isSafeInteger(total) && total > 0;
  if (total !== null && (total <= 0 || !Number.isSafeInteger(total) || watched > total)) return null;
  const progress = watched;
  if (progress <= remote) return null;
  return { progress, status: known && progress === total ? 'COMPLETED' : 'CURRENT' };
}