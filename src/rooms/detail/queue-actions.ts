/**
 * Playing what's queued (see library/queue.ts). The source is chosen now,
 * the usual way, never kept with the item.
 */
import type { RoomContext } from '../../app/router';
import { loadMeta } from '../../catalog/service';
import type { Title } from '../../catalog/titles';
import type { QueueItem } from '../../library/queue';
import { pageLeft } from './page-left';
import { playTitle } from './streams';
import type { EpisodeRef } from './title-actions';

/**
 * The title with its episode list (for the player's Episodes panel and what
 * follows) and the queued episode in it; the saved copy if the details can't
 * be loaded, with the episode as it was queued.
 */
export async function queueTarget(item: QueueItem): Promise<{ title: Title; episode?: EpisodeRef }> {
  const full = await loadMeta(item.title.type, item.title.id).catch(() => null);
  const title = full ?? item.title;
  if (!item.episode) return { title };
  const { season, number, videoId, name } = item.episode;
  const all = (title.seasons ?? []).flatMap((s) => s.episodes.map((episode) => ({ season: s.number, episode })));
  const found = all.find((ref) => ref.episode.id === videoId) ?? all.find((ref) => ref.season === season && ref.episode.number === number);
  return { title, episode: found ?? { season, episode: { id: videoId, number, title: name } } };
}

/** Plays a queued item now: the best source, or the picker, per Settings → Playback (it leaves the queue once it starts). */
export function playQueued(item: QueueItem, ctx: RoomContext): void {
  // The details can take a while: if the person has moved on meanwhile (Back out of the player, another page), nothing opens over where they are now.
  const left = pageLeft();
  void queueTarget(item).then(({ title, episode }) => (left() ? undefined : playTitle(title, episode ? { episode, ctx } : { ctx })));
}
