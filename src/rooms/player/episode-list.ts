import { loadMeta } from '../../catalog/service';
import type { Title } from '../../catalog/titles';
import type { EpisodeRef } from '../detail/title-actions';

/**
 * The full show behind an episode the player was handed with a copy of it that has no episode list (a
 * card's stored copy, say), or null when there's nothing to swap in. Without the list, finishing the
 * episode couldn't move "up next" on (watch.ts `recordProgress`), so the show left Continue Watching,
 * and Next Up couldn't tell what follows.
 */
export async function fullShow(request: { title: Title; episode?: EpisodeRef | undefined }, load: (type: string, id: string) => Promise<Title | null> = loadMeta): Promise<Title | null> {
  if (!request.episode || request.title.seasons?.length) return null;
  const full = await load(request.title.type, request.title.id).catch(() => null);
  return full?.seasons?.length ? full : null;
}
