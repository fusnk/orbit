/**
 * Starting downloads from a title page: the best source automatically
 * (within Settings → Downloads → Max download quality), or one chosen in the
 * source picker's download mode. Also plays a downloaded copy.
 */
import { invoke } from '@tauri-apps/api/core';
import type { RoomContext } from '../../app/router';
import { loadMeta, loadSubtitles, streamRequest } from '../../catalog/service';
import type { Title } from '../../catalog/titles';
import type { MenuItem } from '../../components/menu';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { settings } from '../../lib/ipc';
import {
  blockReason,
  downloadBlock,
  downloadCandidates,
  downloadedSource,
  downloadOf,
  episodeOf,
  failureText,
  isWrongContent,
  loadDownloads,
  onDownloadProgress,
  onDownloadsChange,
  parseMaxQuality,
  QUALITY_KEY,
  streamIdentity,
  type DownloadItem,
} from '../../library/downloads';
import { snapshot } from '../../library/snapshot';
import { pageLeft } from '../detail/page-left';
import { torrentMode } from '../detail/ranking-prefs';
import { openStreams, rankedSources, subtitlesOf, type FoundSource } from '../detail/streams';
import type { EpisodeRef } from '../detail/title-actions';
import { openPlayer } from '../player';
import { LANGUAGE_SETTINGS, mpvLanguages, parseLanguages } from '../player/preferred-language';

/** Subtitles in the person's language saved beside the video (a couple, in case one is off). */
const SUBTITLES_KEPT = 2;
const SUBTITLE_TIMEOUT_MS = 15_000;

/** Subtitle addons' offers in the preferred subtitle language, for Rust to fetch and check. */
async function preferredSubtitles(title: Title, episode: EpisodeRef | undefined, source: FoundSource): Promise<{ url: string; lang: string }[]> {
  const codes = mpvLanguages(parseLanguages(await settings.get(LANGUAGE_SETTINGS.subtitle).catch(() => ''))).split(',').filter(Boolean);
  if (!codes.length) return [];
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SUBTITLE_TIMEOUT_MS);
  try {
    const { subtitles } = await loadSubtitles(title, episode ? { season: episode.season, number: episode.episode.number, id: episode.episode.id } : undefined, { filename: source.stream.filename, videoSize: source.stream.videoSize, videoHash: source.stream.videoHash }, abort.signal, subtitlesOf(source));
    return subtitles
      .filter((s) => codes.includes(s.item.lang.toLowerCase()))
      .slice(0, SUBTITLES_KEPT)
      .map((s) => ({ url: s.item.url, lang: s.item.lang }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Queues `source` for download; a download of the same movie or episode is replaced. Resolves whether it was queued. */
export async function startDownload(title: Title, episode: EpisodeRef | undefined, source: FoundSource, quiet = false): Promise<boolean> {
  const block = downloadBlock(source.stream, title.type);
  if (block) {
    toast(blockReason(block));
    return false;
  }
  const result = await queueDownload(title, episode, source);
  if (!result.ok) {
    toast(t('downloads.toast.failed-start', { reason: failureText(result.error) }));
    return false;
  }
  if (!quiet) toast(t('downloads.toast.started', { name: episode ? `${title.name} · ${episode.episode.title}` : title.name }));
  return true;
}

type Queued = { ok: true } | { ok: false; error: unknown };

/** `startDownload` without any messages: the caller says what happened. */
async function queueDownload(title: Title, episode: EpisodeRef | undefined, source: FoundSource): Promise<Queued> {
  const ep = episode ? { season: episode.season, number: episode.episode.number, id: episode.episode.id } : undefined;
  const request = {
    titleId: title.id,
    videoId: episode?.episode.id ?? title.id,
    title: snapshot(title),
    name: title.name,
    year: title.year ?? null,
    season: episode?.season ?? null,
    episode: episode?.episode.number ?? null,
    episodeTitle: episode?.episode.title || null,
    label: [source.traits.resolution, source.traits.hdr, source.size, source.addon].filter(Boolean).join(' · '),
    addonKey: source.addonKey,
    streamType: title.type,
    streamId: streamRequest(title, ep).id,
    identity: await streamIdentity(source.stream),
    url: source.stream.url,
    upload: torrentMode() === 'share',
    poster: title.poster ?? null,
    logo: title.logo ?? null,
    subtitles: await preferredSubtitles(title, episode, source),
  };
  try {
    await invoke('download_start', { request });
  } catch (error) {
    return { ok: false, error };
  }
  await loadDownloads().catch(() => undefined);
  return { ok: true };
}

/** How many sources "Best source" tries when they send placeholders instead of the video. */
const BEST_TRIES = 3;
/** A placeholder shows up within seconds of the download running; past this, the download is taken as real. */
const JUNK_WINDOW_MS = 90_000;

/** Resolves true if the download of `videoId` fails as "not the video" soon after it starts running. */
function failsAsWrongContent(videoId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (junk: boolean) => {
      stopState();
      stopProgress();
      clearTimeout(timer);
      resolve(junk);
    };
    const check = () => {
      const item = downloadOf(videoId);
      // Real video past a few MB: placeholders are far smaller than this.
      if (!item || item.state === 'done' || item.doneBytes > 8 * 1024 * 1024) finish(false);
      else if (item.state === 'failed') finish(isWrongContent(item.error));
      // The window opens once it runs: queued behind other downloads (or a
      // closed download window) or paused, it hasn't fetched anything yet.
      else if (item.state === 'running') timer ??= setTimeout(() => finish(false), JUNK_WINDOW_MS);
    };
    const stopState = onDownloadsChange(check);
    const stopProgress = onDownloadProgress(check);
    // A placeholder is so small it may have failed already, before anything was listening.
    check();
  });
}

let finding = false;

/** Downloads the best-ranked source that fits Settings → Downloads → Max download quality. */
export async function downloadBest(title: Title, episode?: EpisodeRef): Promise<void> {
  // A second press while the first is still looking does nothing.
  if (finding) return;
  finding = true;
  let holding = true;
  toast(t('downloads.toast.finding'));
  try {
    const [cap, ranked] = await Promise.all([settings.get(QUALITY_KEY).catch(() => null), rankedSources(title, episode, new AbortController().signal)]);
    const candidates = downloadCandidates(ranked, parseMaxQuality(cap), title.type).slice(0, BEST_TRIES);
    if (!candidates.length) return toast(t('downloads.toast.none', { name: title.name }));
    const videoId = episode?.episode.id ?? title.id;
    // A debrid source can answer with a short placeholder (a torrent it hasn't
    // cached); the next best is tried in its place, as playback's failover does.
    for (const [i, source] of candidates.entries()) {
      if (i > 0) toast(t('downloads.toast.trying-next'));
      if (!(await startDownload(title, episode, source, i > 0))) return;
      // Once queued it may wait a long while for its turn: another press can look meanwhile.
      if (holding) finding = holding = false;
      if (!(await failsAsWrongContent(videoId))) return;
    }
    toast(t('downloads.toast.none-worked', { name: title.name }));
  } catch (err) {
    console.warn('Could not find a source to download', err);
    toast(t('downloads.toast.none', { name: title.name }));
  } finally {
    if (holding) finding = false;
  }
}

/** What a quiet "Best source" download came to: queued, no source to download, or a failure from Rust. */
export type BestOutcome = { kind: 'queued' } | { kind: 'none' } | { kind: 'failed'; error: unknown };

/**
 * "Best source" for many episodes at once ("Download season", keeping the
 * next episodes downloaded): no messages, and it resolves once the first
 * choice is queued. If that one turns out to be a placeholder, the next best
 * are tried in the background, as `downloadBest` does in the foreground.
 */
export async function queueBest(title: Title, episode: EpisodeRef): Promise<BestOutcome> {
  const [cap, ranked] = await Promise.all([settings.get(QUALITY_KEY).catch(() => null), rankedSources(title, episode, new AbortController().signal)]);
  const [first, ...rest] = downloadCandidates(ranked, parseMaxQuality(cap), title.type).slice(0, BEST_TRIES);
  if (!first) return { kind: 'none' };
  const queued = await queueDownload(title, episode, first);
  if (!queued.ok) return { kind: 'failed', error: queued.error };
  void (async () => {
    for (const source of rest) {
      if (!(await failsAsWrongContent(episode.episode.id))) return;
      if (!(await queueDownload(title, episode, source)).ok) return;
    }
  })();
  return { kind: 'queued' };
}

/** The source picker, in download mode. */
export function chooseDownload(title: Title, episode: EpisodeRef | undefined, ctx: RoomContext): void {
  openStreams(title, { ...(episode ? { episode } : {}), ctx, download: (source) => void startDownload(title, episode, source) });
}

/** "Best source" and "Choose a source…", for the Download button and menus. */
export function downloadChoices(title: Title, episode: EpisodeRef | undefined, ctx: RoomContext): MenuItem[] {
  return [
    { label: t('downloads.action.best'), action: () => void downloadBest(title, episode) },
    { label: t('downloads.action.choose'), action: () => chooseDownload(title, episode, ctx) },
  ];
}

/** How long Play on a downloaded episode waits for the show's episode list from its addons. */
const EPISODES_WAIT_MS = 4000;

/**
 * The show to play a downloaded episode with. A download keeps only a small
 * copy of the title, without its episode list, and the player finds the next
 * episode (Next Up, autoplay), fills its Episodes panel and records what's up
 * next from that list: its full details, when they come in time. Offline, or
 * when they don't, the small copy (it plays, just without a next episode).
 */
async function showOf(item: DownloadItem): Promise<Title> {
  if (item.season === null || !navigator.onLine) return item.title;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), EPISODES_WAIT_MS));
  const full = await Promise.race([loadMeta(item.title.type, item.titleId).catch(() => null), timeout]);
  return full?.seasons?.length ? full : item.title;
}

/** Plays a downloaded movie or episode from its file (works offline). */
export async function playDownload(item: DownloadItem, ctx: RoomContext): Promise<void> {
  const source = downloadedSource(item);
  // Waiting for the episode list: if the person moved on meanwhile, nothing opens over where they are now.
  const left = pageLeft();
  const title = await showOf(item);
  if (left()) return;
  openPlayer({ title, episode: episodeOf(item), source, sources: [source] }, ctx);
}
