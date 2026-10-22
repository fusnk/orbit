import type { RoomContext } from '../../app/router';
import { loadMeta } from '../../catalog/service';
import { episodic, isShowType, type Episode, type Title } from '../../catalog/titles';
import type { MenuItem } from '../../components/menu';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { inLibrary, libraryEntry, restoreLibrary, toggleLibrary } from '../../library/library';
import { dequeue, dequeueTitle, enqueue, episodeQueued, queueItems, titleQueued, type Placement } from '../../library/queue';
import { openListPicker } from '../lists/lists';
import { openCollectionPicker } from '../collections/picker';
import { episodeState, isWatched, movieProgress, removeFromContinue, resumePosition, resumingVideoId, setWatched, watchRecord } from '../../library/watch';
import { formatTime } from '../player/format';
import { pickShuffled, shuffleEpisodes } from '../player/shuffle';
import { pageLeft } from './page-left';
import { playTitle } from './streams';

export interface EpisodeRef {
  season: number;
  episode: Episode;
}

/**
 * The episode Play should start: the one Continue Watching resumes, else the
 * one it names as next (a finished show being watched again has that one
 * marked watched, so the states below can't tell it apart), else up next,
 * else one left in progress, else the first unwatched aired one (specials,
 * season 0, only if nothing else is left); with all watched, the first aired
 * one again. None while nothing has aired.
 */
export function nextEpisode(title: Title): EpisodeRef | undefined {
  const all = (title.seasons ?? []).flatMap((s) => s.episodes.map((episode) => ({ season: s.number, episode })));
  const regular = all.filter((ref) => ref.season !== 0);
  const kinds = [...regular, ...all.filter((ref) => ref.season === 0)].map((ref) => ({ ref, kind: episodeState(title, ref.season, ref.episode).kind }));
  // An episode abandoned long ago mustn't win over the one being watched now, which may be one
  // marked watched and being watched again (as Continue Watching shows it).
  const resuming = resumingVideoId(title.id);
  const next = watchRecord(title.id)?.next?.videoId;
  return (
    kinds.find((k) => (k.kind === 'in-progress' || k.kind === 'watched') && k.ref.episode.id === resuming)?.ref ??
    kinds.find((k) => k.ref.episode.id === next && k.kind !== 'unaired')?.ref ??
    kinds.find((k) => k.kind === 'up-next')?.ref ??
    kinds.find((k) => k.kind === 'in-progress')?.ref ??
    kinds.find((k) => k.kind === 'unwatched')?.ref ??
    regular.find((ref) => !ref.episode.airs) ??
    all.find((ref) => !ref.episode.airs)
  );
}

/** A show with episodes listed but none out yet: Play has nothing to start (see `nextEpisode`). */
export function nothingAired(title: Title): boolean {
  return !!title.seasons?.some((s) => s.episodes.length) && !nextEpisode(title);
}

/** "Play", "Continue at 42:10", "Play S2 · E2" or "Continue S1 · E3 at 12:04" ("Resume…" if the spot isn't known). */
export function primaryLabel(title: Title): string {
  if (!episodic(title)) {
    if (!(movieProgress(title) > 0)) return t('titles.actions.play');
    const at = resumePosition(title);
    return at > 0 ? t('titles.actions.continue-at', { time: formatTime(at) }) : t('titles.actions.resume');
  }
  const ref = nextEpisode(title);
  if (!ref) return nothingAired(title) ? t('titles.detail.not-aired') : t('titles.actions.play');
  const code = { season: ref.season, episode: ref.episode.number };
  if (episodeState(title, ref.season, ref.episode).kind !== 'in-progress' && ref.episode.id !== resumingVideoId(title.id)) return t('titles.actions.play-episode', code);
  const at = resumePosition(title, ref.episode);
  return at > 0 ? t('titles.actions.continue-episode-at', { ...code, time: formatTime(at) }) : t('titles.actions.resume-episode', code);
}

/**
 * Shuffle: plays a random aired episode (no specials) and shuffles the rest
 * of the session (see player/shuffle.ts). A card's preview has no episode
 * list, so the full details are loaded first.
 */
export async function shuffleTitle(title: Title, ctx: RoomContext): Promise<void> {
  // Loading the episode list can take a while: if the person has moved on meanwhile, nothing opens over where they are now.
  const left = pageLeft();
  const full = title.seasons?.length ? title : await loadMeta(title.type, title.id).catch(() => null);
  if (left()) return;
  const pick = full ? pickShuffled(shuffleEpisodes(full), new Set()) : undefined;
  if (!full || !pick) return toast(t('titles.actions.shuffle-none', { name: title.name }));
  await playTitle(full, { episode: pick.ref, ctx, shuffle: true });
}

/** The extra item on Continue Watching cards. */
export function continueMenu(title: Title): MenuItem[] {
  return [
    {
      label: t('titles.actions.remove-continue'),
      action: () => {
        const undo = removeFromContinue(title.id);
        toast(t('titles.actions.removed-continue', { name: title.name }), { action: { label: t('pages.undo'), run: undo } });
      },
    },
  ];
}

/** "Breaking Bad S1 · E3", or a movie's name, for the queue's messages. */
function queuedName(title: Title, ref?: EpisodeRef): string {
  return ref ? `${title.name} ${t('titles.common.episode-code', { season: ref.season, episode: ref.episode.number })}` : title.name;
}

/**
 * Queues a movie, an episode (`ref`), or a series' next episode (the one
 * Play would start, worked out now), at the front or the end, and says so.
 */
export async function queueTitle(title: Title, where: Placement, ref?: EpisodeRef): Promise<void> {
  let episode = ref;
  // Anything but a movie may have episodes (a series, an addon's "anime"): queued whole, it would be asked for as a movie.
  if (!episode && title.type !== 'movie') {
    // A card's preview has no episode list; the full details do.
    const full = title.seasons?.length ? title : await loadMeta(title.type, title.id).catch(() => null);
    if (title.type === 'series' || (full && episodic(full))) {
      episode = full ? nextEpisode(full) : undefined;
      if (!episode) return toast(t('watching.queue.no-episode', { name: title.name }));
    }
  }
  const result = await enqueue(title, episode ? { season: episode.season, number: episode.episode.number, videoId: episode.episode.id, name: episode.episode.title } : null, where);
  const name = queuedName(title, episode);
  if (result === 'full') return toast(t('watching.queue.full'));
  if (result === 'exists' && where === 'end') return toast(t('watching.queue.already', { name }));
  toast(where === 'next' ? t('watching.queue.playing-next', { name }) : t('watching.queue.added', { name }));
}

/** "Play next", and "Add to queue" or "Remove from queue": for a title (any of its episodes counts as queued), or one episode. */
export function queueMenu(title: Title, ref?: EpisodeRef): MenuItem[] {
  const queued = ref ? episodeQueued(title.id, ref.episode.id) : titleQueued(title.id);
  const remove = () => {
    const item = ref && queueItems().find((i) => i.title.id === title.id && i.episode?.videoId === ref.episode.id);
    void (item ? dequeue(item.id) : dequeueTitle(title.id)).then(() => toast(t('watching.queue.removed', { name: queuedName(title, ref) })));
  };
  return [
    { label: t('watching.queue.play-next'), action: () => void queueTitle(title, 'next', ref) },
    queued ? { label: t('watching.queue.remove'), action: remove } : { label: t('watching.queue.add'), action: () => void queueTitle(title, 'end', ref) },
  ];
}

/** The shared title menu (⋯ on details, right-click on posters and Continue cards). */
export function titleMenu(title: Title, actions: { play(): void; chooseSource?: () => void; shuffle?: () => void; details?: () => void; changed?: () => void }): MenuItem[] {
  const items: MenuItem[] = [{ label: primaryLabel(title), action: actions.play }];
  if (actions.shuffle && isShowType(title.type)) items.push({ label: t('titles.actions.shuffle'), action: actions.shuffle });
  if (actions.chooseSource) items.push({ label: t('titles.actions.choose-source'), action: actions.chooseSource });
  items.push(...queueMenu(title));
  if (actions.details) items.push({ label: t('titles.actions.view-details'), action: actions.details });
  items.push({
    label: inLibrary(title.id) ? t('titles.actions.remove-library') : t('titles.actions.add-library'),
    action: () => {
      const removed = libraryEntry(title.id);
      void toggleLibrary(title).then((saved) => {
        // Removing has Undo (adding is undone from the same menu).
        if (saved) toast(t(removed ? 'titles.actions.removed-library' : 'titles.actions.added-library', { name: title.name }), removed ? { action: { label: t('pages.undo'), run: () => void restoreLibrary(removed).then(() => actions.changed?.()) } } : {});
        actions.changed?.();
      });
      actions.changed?.();
    },
  });
  items.push({ label: t('titles.actions.add-to-list'), action: () => openListPicker(title) });
  items.push({ label: t('collections.menu.add'), action: () => openCollectionPicker(title) });
  if (title.type !== 'series') {
    const watched = isWatched(title);
    items.push({
      label: watched ? t('titles.common.mark-unwatched') : t('titles.common.mark-watched'),
      action: () => {
        setWatched(title, !watched);
        actions.changed?.();
      },
    });
  }
  return items;
}
