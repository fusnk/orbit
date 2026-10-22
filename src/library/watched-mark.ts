/**
 * When a browsing card says "Watched": a film the profile finished, or a
 * series it finished with nothing new since (a series with new episodes has
 * something left to watch). Kept pure so it's testable.
 */
import { isShowType } from '../catalog/titles';

export interface WatchedMarkInput {
  type: string;
  /** A film marked or played to the end; a series finished (watch.ts `isWatched`). */
  watched: boolean;
  /** Episodes that aired since the series was last watched. */
  newEpisodes: number;
  /** Settings → Home & Library → Mark watched titles. */
  enabled: boolean;
}

export function showsWatchedMark({ type, watched, newEpisodes, enabled }: WatchedMarkInput): boolean {
  if (!enabled || !watched) return false;
  return !isShowType(type) || newEpisodes === 0;
}
