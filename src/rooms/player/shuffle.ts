/**
 * Shuffle a show: random aired episodes, none twice until every one has
 * played in this shuffle. The player keeps one shuffle per session (it ends
 * when the player closes, or when something else plays); the queue still
 * comes first (see `chooseUpNext`).
 */
import type { Title } from '../../catalog/titles';
import type { EpisodeRef } from '../detail/title-actions';

/** Aired episodes in season order; specials (season 0) only with `specials`. */
export function shuffleEpisodes(title: Title, specials = false): EpisodeRef[] {
  return (title.seasons ?? [])
    .filter((s) => specials || s.number !== 0)
    .flatMap((s) => s.episodes.filter((episode) => !episode.airs).map((episode) => ({ season: s.number, episode })));
}

/**
 * A random episode not yet `played`. Once all have played, a new round starts
 * (anything but `current`, so the same one doesn't play twice in a row);
 * `fresh` says so, for the caller to forget the old round.
 */
export function pickShuffled(episodes: readonly EpisodeRef[], played: ReadonlySet<string>, current?: string, random: () => number = Math.random): { ref: EpisodeRef; fresh: boolean } | undefined {
  const left = episodes.filter((ref) => !played.has(ref.episode.id) && ref.episode.id !== current);
  const fresh = !left.length;
  const pool = fresh ? episodes.filter((ref) => ref.episode.id !== current) : left;
  const ref = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  return ref && { ref, fresh };
}

/** One show's shuffle: what has played, and (picked once per episode, so it doesn't change under the Next Up card) what plays next. */
export interface ShuffleSession {
  titleId: string;
  on: boolean;
  played: Set<string>;
  next: EpisodeRef | undefined;
}

export function startShuffle(titleId: string): ShuffleSession {
  return { titleId, on: true, played: new Set(), next: undefined };
}

/** An episode of the show started: it counts as played, and the one after it is drawn. */
export function shufflePlayed(session: ShuffleSession, title: Title, episodeId: string, random: () => number = Math.random): void {
  session.played.add(episodeId);
  const pick = pickShuffled(shuffleEpisodes(title), session.played, episodeId, random);
  if (pick?.fresh) session.played = new Set([episodeId]);
  session.next = pick?.ref;
}
