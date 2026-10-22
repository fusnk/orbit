/**
 * Downloads started for you: "Download season" on a series page, and
 * "Keep next episodes downloaded", which follows watch history (through
 * library/watch.ts's listeners, not the player) to keep the next episodes
 * of chosen shows ready offline and, if asked, delete watched ones.
 *
 * Episodes are queued one after another through the usual queue, which runs
 * two at a time and checks free space; nothing starts while offline or
 * without a usable downloads folder.
 */
import { loadMeta } from '../../catalog/service';
import { isShowType, type Title } from '../../catalog/titles';
import { toast } from '../../components/toast';
import { t, tn } from '../../i18n';
import { settings } from '../../lib/ipc';
import { KEEP_COUNT_KEY, keepNextOf, keptShows, loadKeepNext, nextToQueue, parseKeepCount, seasonToQueue, setKeepNext, watchedToDelete, type EpisodeRef, type KeepNext } from '../../library/auto-downloads';
import { allDownloads, downloadOf, failureText, removeDownload, storage } from '../../library/downloads';
import { onWatchSaved, watchRecord } from '../../library/watch';
import { playerOpen } from '../player';
import { queueBest } from './actions';

/** Failures that will fail every other episode too: no point going on. */
const STOPPERS = new Set(['folder', 'permission', 'no-space', 'disk-full', 'vault', 'storage']);
const isStopper = (error: unknown) => typeof error === 'object' && error !== null && STOPPERS.has(String((error as { kind?: unknown }).kind));

/** Has a download in any state but failed (a failed one can be tried again). */
const hasDownload = (videoId: string) => {
  const item = downloadOf(videoId);
  return !!item && item.state !== 'failed';
};

/** Whether downloads can start now: online, with a downloads folder. */
async function canDownload(): Promise<boolean> {
  if (!navigator.onLine) return false;
  const where = await storage().catch(() => null);
  return !!where?.folder;
}

/** Queues `refs` one at a time; stops early at a failure every other episode would share. */
async function queueAll(title: Title, refs: readonly EpisodeRef[]): Promise<{ queued: number; failure: unknown }> {
  let queued = 0;
  let failure: unknown = null;
  for (const ref of refs) {
    const outcome = await queueBest(title, ref).catch((error: unknown) => ({ kind: 'failed' as const, error }));
    if (outcome.kind === 'queued') queued++;
    else if (outcome.kind === 'failed') {
      failure = outcome.error;
      if (isStopper(outcome.error)) break;
    }
  }
  return { queued, failure };
}

// ── Download season ──

/** The episodes "Download season" would queue now. */
export const seasonEpisodes = (title: Title, season: number): EpisodeRef[] => seasonToQueue(title, season, Date.now(), hasDownload);

let seasonBusy = false;

/** Queues every aired episode of `season` that isn't downloaded yet (the button confirms the count first). */
export async function downloadSeason(title: Title, season: number): Promise<void> {
  if (seasonBusy) return;
  const refs = seasonEpisodes(title, season);
  if (!refs.length) return;
  if (!(await canDownload())) return toast(navigator.onLine ? t('downloads.error.folder') : t('downloads.season.offline'));
  seasonBusy = true;
  toast(tn('downloads.season.finding', refs.length));
  try {
    const { queued, failure } = await queueAll(title, refs);
    if (queued === refs.length) toast(tn('downloads.season.queued', queued));
    else if (queued) toast(tn('downloads.season.queued-some', refs.length, { queued }));
    else toast(failure ? t('downloads.toast.failed-start', { reason: failureText(failure) }) : t('downloads.toast.none', { name: title.name }));
  } finally {
    seasonBusy = false;
  }
}

// ── Keep next episodes downloaded ──

/** Per show: the episodes it had watched when last looked at, to tell which were just watched. */
const seen = new Map<string, Set<string>>();
/** Shows with a keepUp under way, and the episodes watched meanwhile (handled once it ends). */
const running = new Map<string, Set<string>>();
/** Downloads to delete once the player closes (the file may be the one playing). */
const pendingDeletes = new Set<string>();
let deleteTimer: ReturnType<typeof setInterval> | undefined;
/** Failures say so once a session; after that they're only logged. */
let failureShown = false;

const watchedOf = (titleId: string) => new Set((watchRecord(titleId)?.rows ?? []).filter((r) => r.watched).map((r) => r.videoId));

function deleteWhenFree(ids: readonly string[]): void {
  for (const id of ids) pendingDeletes.add(id);
  const run = () => {
    if (playerOpen()) return;
    for (const id of pendingDeletes) void removeDownload(id).catch((err: unknown) => console.warn('Could not delete a watched download', err));
    pendingDeletes.clear();
    clearInterval(deleteTimer);
    deleteTimer = undefined;
  };
  run();
  if (pendingDeletes.size && deleteTimer === undefined) deleteTimer = setInterval(run, 30_000);
}

/** Queues the next episodes of a show kept downloaded (and deletes just-watched ones if asked). */
async function keepUp(title: Title, justWatched: ReadonlySet<string>, announce: boolean): Promise<void> {
  const keep = keepNextOf(title.id);
  if (!keep) return;
  const missed = running.get(title.id);
  if (missed) {
    for (const id of justWatched) missed.add(id);
    return;
  }
  running.set(title.id, new Set());
  try {
    const toDelete = watchedToDelete(allDownloads(), title.id, keep, justWatched);
    if (toDelete.length) deleteWhenFree(toDelete);
    if (!(await canDownload())) return;
    // Watch history's own copy of a title has no episode list.
    const full = title.seasons?.length ? title : await loadMeta(title.type, title.id);
    if (!full?.seasons?.length) return;
    const count = parseKeepCount(await settings.get(KEEP_COUNT_KEY).catch(() => null));
    const watched = watchedOf(title.id);
    const refs = nextToQueue(full, { count, now: Date.now(), isWatched: (id) => watched.has(id), hasDownload });
    if (!refs.length) return;
    const { queued, failure } = await queueAll(full, refs);
    if (queued && announce) toast(tn('downloads.auto.queued', queued, { name: full.name }));
    else if (!queued && failure && !failureShown) {
      failureShown = true;
      toast(t('downloads.auto.failed', { name: full.name, reason: failureText(failure) }));
    }
  } catch (err) {
    console.warn('Could not keep the next episodes downloaded', err);
  } finally {
    const later = running.get(title.id);
    running.delete(title.id);
    if (later?.size) void keepUp(title, later, announce);
  }
}

/** After each change to watch history: act on shows kept downloaded whose episodes were just watched. */
function onSaved(title: Title): void {
  if (!isShowType(title.type) || !keepNextOf(title.id)) return;
  const now = watchedOf(title.id);
  const before = seen.get(title.id) ?? new Set<string>();
  seen.set(title.id, now);
  const justWatched = new Set([...now].filter((id) => !before.has(id)));
  if (justWatched.size) void keepUp(title, justWatched, true);
}

let started = false;

/** Reads the profile's shows kept downloaded and starts following watch history; call once at startup. */
export async function startAutoDownloads(): Promise<void> {
  if (started) return;
  started = true;
  await loadKeepNext();
  for (const id of keptShows()) seen.set(id, watchedOf(id));
  onWatchSaved(onSaved);
}

/** Turns "Keep next episodes downloaded" on or off for a show; turning it on queues the next episodes now. */
export async function setKeepNextFor(title: Title, keep: KeepNext | null): Promise<void> {
  const wasOn = !!keepNextOf(title.id);
  await setKeepNext(title.id, keep);
  if (!keep) {
    seen.delete(title.id);
    return toast(t('downloads.auto.off', { name: title.name }));
  }
  seen.set(title.id, watchedOf(title.id));
  if (wasOn) return toast(keep.deleteWatched ? t('downloads.auto.delete-on') : t('downloads.auto.delete-off'));
  toast(t('downloads.auto.on', { name: title.name }));
  await keepUp(title, new Set(), true);
}
