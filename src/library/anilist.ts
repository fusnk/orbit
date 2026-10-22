import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { toast } from '../components/toast';
import { t } from '../i18n';
import type { Title } from '../catalog/titles';
import { animeIdentity, completedAnimeEpisodes } from './anilist-rules';
import { historyPaused, onHistoryPauseChange } from './history-pause';
import { onWatchSaved, watchRecord, watchHistory } from './watch';

const positive = v.pipe(v.number(), v.integer(), v.minValue(1));
const avatar = v.nullable(v.pipe(v.string(), v.maxLength(512 * 1024), v.regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)));
const StatusSchema = v.object({ configured: v.boolean(), account: v.nullable(v.object({ id: positive, name: v.pipe(v.string(), v.maxLength(200)), avatar })), enabled: v.boolean(), connected: v.optional(v.boolean(), false), error: v.optional(v.nullable(v.picklist(['denied', 'network', 'invalid-data', 'rate-limited', 'keychain', 'signed-out', 'failed'])), null) });
export type AniListStatus = v.InferOutput<typeof StatusSchema>;
const CandidateSchema = v.object({
  id: v.pipe(v.string(), v.maxLength(200), v.check((id) => animeIdentity(id) !== null)),
  type: v.picklist(['movie', 'series']),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  poster: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2048), v.url(), v.startsWith('https://')))),
  year: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(20)))),
});

let state: AniListStatus = { configured: false, account: null, enabled: false, connected: false, error: null };
let generation = 0;
let writes: Promise<void> = Promise.resolve();
const sent = new Map<string, number>();
const listeners = new Set<() => void>();
let stopWatch: (() => void) | undefined;
let stopPause: (() => void) | undefined;
/** The startup check failed outright (the keychain or database not ready): nothing is known about the account yet. */
let checkFailed = false;

function cancelPending(): void {
  generation++;
  sent.clear();
  // Connecting, restarting or resuming never uploads preexisting watch history.
  const history = watchHistory();
  for (const { title } of history.titles) {
    for (const item of completedAnimeEpisodes(title, history.progress, false)) sent.set(`${item.id}:${item.season}`, item.episode);
  }
}
function note(next: AniListStatus): AniListStatus {
  // The saved sign-in's account, unknown while AniList couldn't be reached, coming back isn't a new
  // connection: what was already watched was set aside when it went unknown, and what was watched
  // since is still to send.
  const reached = (state.connected || checkFailed) && !state.account && next.connected && !!next.account;
  checkFailed = false;
  if (!reached && (state.account?.id !== next.account?.id || state.enabled !== next.enabled)) cancelPending();
  state = next;
  for (const listener of listeners) listener();
  return next;
}
export const anilistState = (): AniListStatus => state;
export function onAniListChange(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export async function refreshAniList(): Promise<AniListStatus> { return note(v.parse(StatusSchema, await invoke<unknown>('anilist_status'))); }
export const authorizeAniList = (): Promise<void> => invoke('anilist_authorize');
export async function connectAniList(token: string): Promise<AniListStatus> { cancelPending(); await invoke('anilist_connect', { token }); return refreshAniList(); }
export async function disconnectAniList(): Promise<void> { cancelPending(); await invoke('anilist_disconnect'); await refreshAniList(); }
export async function setAniListEnabled(on: boolean): Promise<void> { cancelPending(); await invoke('anilist_set_enabled', { on }); await refreshAniList(); }

export async function importAniListCandidates(): Promise<Title[]> {
  const rows = v.parse(v.pipe(v.array(CandidateSchema), v.maxLength(5000)), await invoke<unknown>('anilist_import_candidates'));
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const id = animeIdentity(row.id)!;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, type: row.type, name: row.name, ...(row.poster ? { poster: row.poster } : {}), ...(row.year ? { year: row.year } : {}), genres: ['Anime'], origins: [] }];
  });
}

/** Whether "AniList no longer accepts Orbit's sign-in" was shown this run. */
let warnedSignIn = false;

/** How often a finished episode may ask AniList again for an account it couldn't reach. */
const RECHECK_MS = 60_000;
let recheckedAt = -Infinity;

function saved(title: Title): void {
  // Started offline (or AniList was down or busy): the sign-in is saved but its account unknown.
  // Ask again, at most once a minute, rather than stay off until Orbit restarts.
  // So too when the startup check itself failed.
  const unknown = checkFailed || (!state.account && state.connected && state.enabled && (state.error === 'network' || state.error === 'rate-limited'));
  if (unknown && !historyPaused() && Date.now() - recheckedAt >= RECHECK_MS) {
    recheckedAt = Date.now();
    void refreshAniList().then(
      (now) => now.account && saved(title),
      () => {},
    );
    return;
  }
  if (!state.account || !state.enabled || historyPaused()) return;
  const epoch = generation;
  for (const request of completedAnimeEpisodes(title, watchRecord(title.id)?.rows ?? [], historyPaused())) {
    const key = `${request.id}:${request.season}`;
    if ((sent.get(key) ?? 0) >= request.episode) continue;
    writes = writes.then(async () => {
      // A pause, disconnect or changed account cancels queued work, even after resuming.
      if (epoch !== generation || historyPaused() || !state.enabled || !state.account || (sent.get(key) ?? 0) >= request.episode) return;
      await invoke('anilist_scrobble', { request });
      if (epoch === generation) {
        if (sent.size >= 500) sent.clear();
        sent.set(key, request.episode);
      }
    }).catch((err: unknown) => {
      // Native errors are generic; retry on a later completed watch save. A revoked
      // sign-in won't fix itself, though: say so once, so the person knows to reconnect.
      if ((String(err) === 'denied' || String(err) === 'signed-out') && !warnedSignIn) {
        warnedSignIn = true;
        toast(t('states.auth.anilist'));
      }
    });
  }
}

/** Subscribes to saved watch changes, not player assumptions or imported history. */
export async function startAniListSync(): Promise<void> {
  stopWatch?.();
  stopPause?.();
  cancelPending();
  stopPause = onHistoryPauseChange(cancelPending);
  await refreshAniList().catch(() => {
    note({ ...state, account: null, enabled: false, error: 'network' });
    checkFailed = true;
  });
  stopWatch = onWatchSaved(saved);
}