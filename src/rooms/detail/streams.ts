import type { AddonError, AggregateEvent, Stream, UsableAddon } from '../../addons/types';
import type { RoomContext } from '../../app/router';
import { playAllowed } from '../profiles/parental';
import { loadStreams, streamAddons, streamRequest, usableAddons, type StreamSubtitles } from '../../catalog/service';
import type { Title } from '../../catalog/titles';
import { openDrawer } from '../../components/drawer';
import { icon, type IconName } from '../../components/icons';
import { classify, errorText, fixButton, isOffline, retryWhenOnline } from '../../components/state-message';
import { createSwitch } from '../../components/switch';
import { toast } from '../../components/toast';
import { locale, t, tn, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { blockReason, downloadBlock, downloadedCopy, downloadedSource } from '../../library/downloads';
import { ownServerVersions } from '../../library/own-servers';
import { autoCandidates, autoplayGate, collectForAutoplay, isTopQuality, type AutoplayGate } from '../../lib/autoplay';
import { unhealthyLast } from '../../lib/host-health';
import { settings } from '../../lib/ipc';
import { addonFilter, addonGroups, fromAddon, offerAddonFilter, type AddonGroup } from '../../lib/source-filter';
import { breaksLimit, rankSources, type Ranked, type Signal, type SignalId, type SourceTraits } from '../../lib/ranking-fallback';
import { otherFilmYear, streamLabels, type CopyKind } from '../../lib/stream-traits';
import { baseName, episodeHint, episodeOfFile, matchesHint, withFile, type TorrentFile } from '../../lib/torrent-files';
import { openPlayer, resumeAfterPrompt, type PlayableSource } from '../player';
import { alwaysExternal, canOpenExternally, externalConfigured, loadExternal, openExternally } from '../player/external';
import { createFilePicker, focusFilePicker } from '../player/file-picker';
import { failedLast, failedRecently, failureOf, loadFailures, whereKey, type FailureReason } from '../player/failed-sources';
import { PLAYBACK_SETTINGS } from '../player/next-up';
import { torrentFiles } from '../player/torrent';
import { findLast, type ResumeChoice } from '../player/last-source';
import { showSourceSearch, type SearchWatch } from '../player/source-search';
import { resumePosition } from '../../library/watch';
import { resumeChoice } from './resume-choice';
import { openSettingsTo } from '../settings';
import { autoplayLimits, rankingPrefs, torrentMode } from './ranking-prefs';
import './streams.css';
import type { EpisodeRef } from './title-actions';
import { vodOrigin, vodSources, vodStream } from '../../live/vod';
import { pageLeft } from './page-left';
import { isMac } from '../../lib/platform';

/** A source's audio trait as shown: "Stereo" is a word, the rest (Atmos, 5.1) are names. */
const audioLabel = (audio: string | undefined) => (audio === 'Stereo' ? t('player.tracks.stereo') : audio);

const FILTERS = ['All', '4K', '1080p', '720p'] as const;
type Filter = (typeof FILTERS)[number];
const REMEMBER_KEY = 'streams.remember';

type ProviderState = { kind: 'pending' } | { kind: 'ok'; count: number } | { kind: 'failed'; error: string; cause: AddonError };

/** One playable source as the picker shows it. */
interface Source {
  /** A neutral id for focus and Why? state: stream URLs can carry debrid tokens, so they never go into the DOM. */
  id: string;
  stream: Stream;
  addon: string;
  /** The addon's local key, to ask it again (a download's link expiring). */
  addonKey: string;
  traits: SourceTraits;
  codec?: string | undefined;
  release?: string | undefined;
  size?: string | undefined;
  /** CAM / TS / TC / SCR when it's a cinema or preview copy rather than the film's release. */
  copy?: CopyKind | undefined;
  /** Years in the source's name (see `otherFilmYear`). */
  years?: number[] | undefined;
  /** Filename, or the first line of the description, as shown in the row. */
  file?: string | undefined;
  /** For the person's own server (Jellyfin, Plex): where it says they stopped, in seconds. */
  resume?: number | undefined;
  /** When that server says it was last played (ms), if it says. */
  resumeAt?: number | undefined;
}

/** Short status for the footer, e.g. "Example Addon · didn't respond in time". */
function shortError(error: AddonError): string {
  switch (error.kind) {
    case 'timeout':
      return t('titles.streams.timeout');
    case 'http':
      // Usually an addon's own setup (a debrid key it holds) that has expired, not the addon being down.
      return error.status === 401 || error.status === 403 ? t('titles.streams.refused') : t('titles.streams.http', { status: String(error.status) });
    case 'rate-limited':
      return t('titles.streams.busy');
    case 'too-large':
      return t('titles.streams.too-large');
    case 'network':
      return t('titles.streams.network');
    case 'invalid-response':
      return t('titles.streams.invalid');
    default:
      return t('titles.streams.failed');
  }
}

/** Torrents are offered only when Settings → Playback allows them. */
const usable = (stream: Stream) => !stream.torrent || torrentMode() !== 'off';

function sourceFrom(stream: Stream, origin: { key: string; name: string } | undefined, id: string): Source {
  return { id, stream, addon: origin?.name ?? '', addonKey: origin?.key ?? '', ...streamLabels(stream), file: stream.filename ?? stream.description?.split('\n')[0] };
}

export type FoundSource = Source;

/**
 * The movie or episode's versions on the profile's own servers (Jellyfin,
 * Plex) and in its debrid cloud, ranked among themselves. Not offered for
 * download here (a cloud file downloads from My Library → My cloud).
 */
async function ownFound(title: Title, episode: EpisodeRef | undefined): Promise<Ranked<Source>[]> {
  const [found, iptv] = await Promise.all([ownServerVersions(title, episode ? { season: episode.season, number: episode.episode.number, id: episode.episode.id } : undefined), vodSources(title, episode ? { season: episode.season, number: episode.episode.number } : undefined)]);
  const origin = { jellyfin: 'jellyfin.source.origin', plex: 'plex.source.origin', cloud: 'cloud.source.origin' } as const;
  const prefix = { jellyfin: 'jf', plex: 'px', cloud: 'cl' } as const;
  const counts = { jellyfin: 0, plex: 0, cloud: 0 };
  return rankSources(
    [...found.map(({ kind, serverName, version, stream }) => ({
      ...sourceFrom(stream, { key: kind, name: t(origin[kind], { server: serverName }) }, `${prefix[kind]}${++counts[kind]}`),
      resume: version.resume ?? undefined,
      resumeAt: version.resumeAt ?? undefined,
    })), ...iptv.map((source, index) => sourceFrom(vodStream(source), { key: `iptv:${source.account}`, name: vodOrigin(source) }, `tv${index}`))],
    rankingPrefs(!!episode),
  );
}

/** Ids of sources from the debrid cloud (see `ownFound`'s prefixes). */
const isCloud = (source: { id: string }) => source.id.startsWith('cl') || source.id.startsWith('tv');

/**
 * Where the person's own copies go among the addons' sources. A server's
 * (Jellyfin, Plex) goes first: it's their own library. A debrid cloud copy
 * is ranked with the addons' by the same rules (quality, size, avoid…), since
 * it's usually the very release an addon offers; on a tie it goes first, as
 * it starts at once. `ranked` is the addons' sources, already ranked.
 */
function withOwn(own: readonly Ranked<Source>[], ranked: readonly Ranked<Source>[], episode: boolean, failed: (s: Ranked<Source>) => boolean): Ranked<Source>[] {
  const cloud = own.filter(isCloud);
  const servers = own.filter((s) => !isCloud(s));
  if (!cloud.length) return [...servers, ...ranked];
  return [...servers, ...failedLast(healthLast(rankSources([...cloud, ...ranked], rankingPrefs(episode))), failed)];
}

/** For a movie: the year a source names when it's another film's (see `otherFilmYear`). */
function otherFilm(title: Title, episode: EpisodeRef | undefined): (source: Source) => number | undefined {
  const year = title.type === 'movie' && !episode ? Number.parseInt(title.year ?? '', 10) || undefined : undefined;
  return (source) => otherFilmYear(source.years, year);
}

/** Another film's sources go after this one's, so Play and "best" never land on them while there's anything else. */
function otherFilmsLast<T extends Source>(list: readonly T[], title: Title, episode: EpisodeRef | undefined): T[] {
  const other = otherFilm(title, episode);
  return failedLast(list, (s) => other(s) !== undefined);
}

/** Whether any addon in use serves streams at all, for any title. */
const servesStreams = () => usableAddons().then((addons) => addons.some((addon) => addon.manifest.resources.some((r) => r.name === 'stream')));

/**
 * Every source for a movie or episode, ranked as the picker ranks them,
 * without showing the picker. Resolves once every addon has answered (or failed).
 */
export async function rankedSources(title: Title, episode: EpisodeRef | undefined, signal: AbortSignal, options: { collect?: boolean; watch?: SearchWatch } = {}): Promise<Ranked<Source>[]> {
  const req = streamRequest(title, episode ? { season: episode.season, number: episode.episode.number, id: episode.episode.id } : undefined);
  const [addons] = await Promise.all([streamAddons(req), loadFailures()]);
  // Play's search screen follows each addon (see player/source-search.ts).
  options.watch?.addons(addons.map((a) => ({ key: a.key, name: a.manifest.name })));
  let found: Source[] = [];
  // Its own signal, so collecting for an automatic pick can stop early; the round itself carries on and is kept (see service.ts).
  const reading = new AbortController();
  signal.addEventListener('abort', () => reading.abort(), { once: true });
  const events = loadStreams(addons, req, reading.signal);
  const take = (event: AggregateEvent<Stream>) => {
    options.watch?.event(event);
    // Each partial result holds everything found so far.
    if (event.type === 'partial') found = event.items.filter(({ item }) => usable(item)).map(({ item, origins }, i) => sourceFrom(item, origins[0], `n${i + 1}`));
  };
  if (options.collect) {
    // An automatic pick: what arrives within the collect window (see autoplay.ts), not the slowest addon's timeout.
    const limits = autoplayLimits();
    await collectForAutoplay(
      events,
      (event) => {
        take(event);
        const fitting = found.filter((s) => !autoplayGate(s, limits));
        return { candidate: fitting.length > 0, top: fitting.some((s) => isTopQuality(s.traits, limits)) };
      },
      () => reading.abort(),
    );
  } else {
    for await (const event of events) take(event);
  }
  // Sources that failed for this movie or episode lately go last (see failed-sources.ts), after those from hosts failing lately.
  const failed = failedRecently(whereKey(title.id, episode?.episode.id));
  return otherFilmsLast(failedLast(healthLast(rankSources(found, rankingPrefs(!!episode))), (s) => failed({ addon: s.addon, url: s.stream.url })), title, episode);
}

/** Sources from hosts that keep failing lately go after the rest (see host-health.ts). */
const healthLast = <T extends Source>(list: readonly T[]): T[] => unhealthyLast(list, (s) => ({ url: s.stream.url, addon: s.addon }));

/**
 * Sources to play, best first: used by the player to play the next episode.
 * A downloaded copy is all there is to it (it plays offline, and at once).
 * `collect`: for an automatic pick, stop listening to slow addons once the
 * collect window closes with something worth playing (see autoplay.ts).
 */
export async function resolveSources(title: Title, episode: EpisodeRef | undefined, signal: AbortSignal, options: { collect?: boolean; watch?: SearchWatch } = {}): Promise<PlayableSource[]> {
  const copy = downloadedCopy(episode?.episode.id ?? title.id);
  if (copy) return [downloadedSource(copy)];
  const [own, found] = await Promise.all([ownFound(title, episode), rankedSources(title, episode, signal, options)]);
  const failed = failedRecently(whereKey(title.id, episode?.episode.id));
  return otherFilmsLast(withOwn(own, found, !!episode, (s) => failed({ addon: s.addon, url: s.stream.url })), title, episode).map(playable);
}

function playable(source: Source): PlayableSource {
  return {
    id: source.id,
    url: source.stream.url,
    addon: source.addon,
    // A cinema copy says so first: its "1080p" is the recording's size, not the film's quality.
    label: [source.copy, source.traits.resolution ?? t('titles.streams.source')].filter(Boolean).join(' · '),
    meta: [source.stream.torrent ? t('titles.streams.torrent') : '', source.traits.hdr, source.codec, audioLabel(source.traits.audio), source.size, source.release].filter(Boolean).join(' · '),
    filename: source.stream.filename,
    videoSize: source.stream.videoSize,
    videoHash: source.stream.videoHash,
    bingeGroup: source.stream.bingeGroup,
    headers: source.stream.headers,
    resume: source.resume,
    resumeAt: source.resumeAt,
    autoplay: autoplayGate(source, autoplayLimits()),
    subtitles: subtitlesOf(source),
  };
}

/** The subtitles `source`'s addon shipped with it, attributed to that addon. */
export function subtitlesOf(source: Source): StreamSubtitles | undefined {
  return source.stream.subtitles.length ? { subtitles: source.stream.subtitles, origin: { key: source.addonKey, name: source.addon } } : undefined;
}

/** Each signal's "Why?" line. */
const SIGNAL_TEXT: Record<SignalId, MessageKey> = {
  resolution: 'titles.why.resolution',
  'above-preferred': 'titles.why.above-preferred',
  'above-limit': 'titles.why.above-limit',
  'dolby-vision': 'titles.why.dolby-vision',
  hdr: 'titles.why.hdr',
  'prefer-hdr': 'titles.why.prefer-hdr',
  atmos: 'titles.why.atmos',
  surround: 'titles.why.surround',
  stereo: 'titles.why.stereo',
  'prefer-audio': 'titles.why.prefer-audio',
  language: 'titles.why.language',
  'multi-audio': 'titles.why.multi-audio',
  local: 'titles.why.local',
  cached: 'titles.why.cached',
  large: 'titles.why.large',
  'low-bitrate': 'titles.why.low-bitrate',
  'over-size': 'titles.why.over-size',
  'under-size': 'titles.why.under-size',
  avoided: 'titles.why.avoided',
  'avoided-cam': 'titles.why.avoided-cam',
  keyword: 'titles.why.keyword',
  'avoided-keyword': 'titles.why.avoided-keyword',
  unsupported: 'titles.why.unsupported',
  'above-screen': 'titles.why.above-screen',
};

// A Mac's only "unsupported" is Dolby Vision (MAC_SUPPORT in ranking-fallback.ts): said for a Mac, not a TV.
const signalText = (signal: Signal) => t(isMac && signal.id === 'unsupported' ? 'titles.why.unsupported-mac' : SIGNAL_TEXT[signal.id], signal.vars);

/** The quiet tag on a source that failed lately for this movie or episode. */
const FAILURE_TEXT: Record<FailureReason | 'unknown', MessageKey> = {
  unknown: 'titles.streams.failure.unknown',
  failed: 'titles.streams.failure.failed',
  slow: 'titles.streams.failure.slow',
  stalled: 'titles.streams.failure.stalled',
  placeholder: 'titles.streams.failure.placeholder',
};

const failureNote = (failed: { reason: FailureReason | undefined } | null): HTMLElement | string => (failed ? h('span', { class: 'failed-note' }, t(FAILURE_TEXT[failed.reason ?? 'unknown'])) : '');

/** The quiet tag on a source Play and autoplay pass over (it can still be picked here). */
const GATE_TEXT: Record<AutoplayGate, [MessageKey, MessageKey]> = {
  uncached: ['sources.note.uncached', 'sources.note.uncached-hint'],
  'outside-limits': ['sources.note.outside-limits', 'sources.note.outside-limits-hint'],
};
const gateNote = (gate: AutoplayGate | undefined): HTMLElement | string => (gate ? h('span', { class: 'failed-note', title: t(GATE_TEXT[gate][1]) }, t(GATE_TEXT[gate][0])) : '');

function matchesFilter(source: Source, filter: Filter, hdrOnly: boolean): boolean {
  if (hdrOnly && !source.traits.hdr) return false;
  if (filter === 'All') return true;
  return source.traits.resolution === (filter === '4K' ? '2160p' : filter);
}

/**
 * The source picker: asks every stream addon in parallel, ranks what comes
 * back, and lets the user play the best match or pick a source. Results show
 * as each addon answers; "Why?" appears once all have, since until then the
 * ranking can still change.
 */
let finding = false;
/** A press of Play is reading the settings or waiting at the resume prompt (see `playTitle`). */
let deciding = false;

/** Where and how a title sent from another device (Orbit Connect, see app/connect.ts) starts here. */
export interface ConnectStart {
  start?: number | undefined;
  audio: string | null;
  subtitle: string | null;
}

/** A player request's part for a title sent from another device: its position, and the track languages it had. */
const connectRequest = (connect: ConnectStart | undefined) => (connect ? { start: connect.start, languages: { audio: connect.audio, subtitle: connect.subtitle } } : {});

/**
 * Play: straight to the best-ranked source, or the picker, as Settings →
 * Playback → "When I press Play" says. Falls back to the picker when nothing
 * can be played automatically (or there's no page to play in).
 */
export async function playTitle(title: Title, options: { episode?: EpisodeRef; ctx?: RoomContext; shuffle?: boolean; connect?: ConnectStart } = {}): Promise<void> {
  // The profile's content limit (see profiles/parental.ts); this runs again once an unknown rating is known.
  if (!playAllowed(title, () => void playTitle(title, options))) return;
  const handed = connectRequest(options.connect);
  // A downloaded copy plays first, and without a connection.
  const copy = downloadedCopy(options.episode?.episode.id ?? title.id);
  if (copy && options.ctx) return openPlayer({ title, episode: options.episode, source: downloadedSource(copy), sources: [downloadedSource(copy)], shuffle: options.shuffle, ...handed }, options.ctx);
  // A second press while the first still decides how to start (a double-click) does nothing: it
  // would stack a second "which source?" prompt, whose answer later starts the title again.
  if (deciding) return;
  deciding = true;
  let mode: unknown, resume: ResumeChoice | null | undefined;
  try {
    let resumeMode: unknown;
    [mode, resumeMode] = await Promise.all([settings.get(PLAYBACK_SETTINGS.play).catch(() => null), settings.get(PLAYBACK_SETTINGS.resume).catch(() => null), loadExternal()]);
    // Resuming: Settings → Playback → When resuming may ask, or say which source (see resume-choice.ts).
    // Sent from another device (Orbit Connect), it starts on the best source where it was sent from, without asking.
    // Start over isn't resuming: the player starts from 0, so which source to go on with doesn't apply (its row is hidden then).
    resume = !options.connect && options.ctx && resumeMode !== 'start-over' && resumePosition(title, options.episode?.episode) > 0 ? await resumeChoice(title, options.episode).catch(() => undefined) : undefined;
  } finally {
    deciding = false;
  }
  if (resume === null) return;
  if (resume?.kind === 'choose' || (!resume && mode === 'choose' && !options.connect) || !options.ctx) {
    // Answered over the player (its Episodes panel): what waited behind the prompt plays on under the
    // picker, as it does when the picker opens there without asking; picking a source switches it.
    if (resume) resumeAfterPrompt();
    return openStreams(title, options);
  }
  const last = resume?.kind === 'last' ? resume.last : undefined;
  const handled = await playFound(title, { ...options, ctx: options.ctx }, last && ((sources) => findLast(sources, last)));
  // Nothing switched (the search was cancelled, found nothing to start, or was already running): what
  // waited behind the prompt plays on, rather than staying paused with nothing over it.
  if (resume && !handled) resumeAfterPrompt();
}

/**
 * Finds the sources and plays `pick`'s choice among them, or the best; the
 * picker if none can be played. `pick` returning nothing (the last source is
 * gone) falls back to the best, saying so. Whether a source was started (in
 * the player, or the external one).
 */
async function playFound(title: Title, options: { episode?: EpisodeRef; ctx: RoomContext; shuffle?: boolean; connect?: ConnectStart }, pick?: (sources: readonly PlayableSource[]) => PlayableSource | undefined): Promise<boolean> {
  // A second press while the first is still looking does nothing.
  if (finding) return false;
  finding = true;
  // Each addon as it answers, until the player opens (or Cancel stops looking).
  const search = showSourceSearch(title, options.episode);
  // Finding sources takes a while: if the person has left meanwhile (Back out of
  // the player, another page), nothing opens over wherever they are now.
  const left = pageLeft();
  try {
    // Looking for the last source needs every addon's answer; the best one only what arrives within the collect window.
    const sources = await resolveSources(title, options.episode, search.signal, { collect: !pick, watch: search.watch });
    if (left() || search.cancelled()) return false;
    const picked = pick?.(sources);
    // The best is the best-ranked source an automatic pick may start: within the autoplay limits if any is, never an uncached one.
    const auto = autoCandidates(sources);
    if (pick && !picked && auto.list[0]) toast(t('player.resume-source.gone'));
    else if (!picked && auto.fellBack) toast(t('sources.autoplay.outside-limits'));
    const best = picked ?? auto.list[0];
    // Settings → Player → Always open in the external player: the chosen (or best) web source goes there (torrents stay in Orbit).
    const web = alwaysExternal() ? [...(picked ? [picked] : []), ...auto.list].find((s) => canOpenExternally(s.url)) : undefined;
    if (web) {
      await openExternally(web.url);
      return true;
    }
    // Picked within the collect window: slow addons are still answering, and join the player's Source list when they do (the round is shared, see service.ts).
    if (best) {
      // Focus back on Play first: opening the player remembers it for Back.
      search.close();
      const moreSources = pick ? undefined : resolveSources(title, options.episode, new AbortController().signal);
      openPlayer({ title, episode: options.episode, source: best, sources, moreSources, shuffle: options.shuffle, ...connectRequest(options.connect) }, options.ctx);
      return true;
    }
    // Only sources still downloading to the debrid service: the person chooses whether to start one.
    if (sources.length) toast(t('sources.autoplay.only-uncached'));
  } catch (err) {
    console.warn('Could not find sources automatically', err);
  } finally {
    finding = false;
    search.close();
  }
  if (!left() && !search.cancelled()) openStreams(title, options);
  return false;
}

/**
 * With `download`, the picker chooses a source to download instead of one to
 * play: same ranking and labels, the main action downloads, sources that
 * can't be saved are shown disabled with the reason, and playback-only
 * controls are left out.
 */
export function openStreams(title: Title, options: { episode?: EpisodeRef; ctx?: RoomContext; download?: (source: FoundSource) => void; shuffle?: boolean } = {}): void {
  if (!playAllowed(title, () => openStreams(title, options))) return;
  const download = options.download;
  const req = streamRequest(title, options.episode ? { season: options.episode.season, number: options.episode.episode.number, id: options.episode.episode.id } : undefined);
  const controller = new AbortController();
  let providers: UsableAddon[] | null = null;
  /** Whether any addon in use serves streams at all (when none serves this title). */
  let anyStreamAddon = false;
  /** Why the addons couldn't even be asked (null while that went fine). */
  let loadError: unknown = null;
  const states = new Map<string, ProviderState>();
  const ids = new Map<string, string>();
  let sources: Source[] = [];
  /** Versions on the profile's own servers (not when downloading), and whether they have answered. */
  let own: Ranked<Source>[] = [];
  let ownDone = !!download;
  /** Torrent sources left out because Settings → Playback has them off. */
  let hiddenTorrents = 0;
  let filter: Filter = 'All';
  let hdrOnly = false;
  let whyOpen: string | null = null;
  let remember = true;
  const failed = (source: Source) => failedRecently(whereKey(title.id, options.episode?.episode.id))({ addon: source.addon, url: source.stream.url });
  const failure = (source: Source) => failureOf(whereKey(title.id, options.episode?.episode.id))({ addon: source.addon, url: source.stream.url });
  /** Each addon chip's focus id, kept while the picker is open: chips reorder as addons answer, and names can hold any character. */
  const addonIds = new Map<string, string>();
  const addonId = (addon: string) => addonIds.get(addon) ?? addonIds.set(addon, `addon-${addonIds.size + 1}`).get(addon)!;
  /** Ranked as Settings ask, with sources that failed lately for this movie or episode last; the person's own servers' first. */
  const rank = () => otherFilmsLast(withOwn(own, failedLast(healthLast(rankSources(sources, rankingPrefs(!!options.episode))), failed), !!options.episode, failed), title, options.episode);
  const otherFilmYearOf = otherFilm(title, options.episode);
  // Whether the user has moved focus since the picker opened (it starts on Close).
  let userMovedFocus = false;
  /** A torrent's files, shown in place of the sources (see `showFiles`). */
  let files: { source: Source; view: HTMLElement } | null = null;

  const series = title.type === 'series';
  const sub = options.episode
    ? `${t('titles.common.episode-code', { season: options.episode.season, episode: options.episode.episode.number })} · ${options.episode.episode.title}`
    : [title.year, title.runtime].filter(Boolean).join(' · ');

  const closeButton = h('button', { class: 'icon-button', title: t('titles.streams.close-esc'), 'aria-label': t('titles.streams.close') }, icon('close'));
  const body = h('div', { class: 'picker-body' });
  const footer = h('footer', { class: 'picker-footer' });
  const content = h(
    'div',
    { class: 'picker' },
    h(
      'header',
      { class: 'picker-header' },
      h('div', { class: 'picker-titles' }, h('span', { class: 'eyebrow' }, download ? t('downloads.picker.eyebrow') : t('titles.streams.choose')), h('span', { class: 'picker-title' }, title.name), h('span', { class: 'picker-sub' }, sub)),
      closeButton,
    ),
    body,
    footer,
  );

  const play = (source: Source) => {
    close();
    if (download) return download(source);
    if (alwaysExternal() && canOpenExternally(source.stream.url, !!source.stream.torrent)) return void openExternally(source.stream.url);
    if (!options.ctx) return toast(t('titles.streams.play-from-page'));
    // The player gets every source, ranked, so it can switch without coming back here.
    const ranked = rank().map(playable);
    openPlayer({ title, episode: options.episode, source: playable(source), sources: ranked, shuffle: options.shuffle }, options.ctx);
  };

  /**
   * Plays one file of a torrent. A file named for another episode of this
   * series plays as that episode, so its progress lands there.
   */
  const playFile = (source: Source, file: TorrentFile) => {
    close();
    if (!options.ctx) return toast(t('titles.streams.play-from-page'));
    const base = playable(source);
    const episode = series ? episodeOfFile(title, file) : undefined;
    const chosen: PlayableSource = { ...base, url: withFile(base.url, file.index), filename: baseName(file.name), videoSize: file.size, videoHash: undefined, fileChosen: true };
    // The other sources listed are this episode's: another episode's file has only itself to switch to.
    const otherEpisode = !!episode && episode.episode.id !== options.episode?.episode.id;
    openPlayer({ title, episode: episode ?? options.episode, source: chosen, sources: otherEpisode ? [chosen] : rank().map(playable), shuffle: options.shuffle }, options.ctx);
  };

  /** Shows a torrent's files instead of the sources; Back returns to them. */
  function showFiles(source: Source): void {
    const back = h('button', { class: 'button', 'data-focus-id': 'files-back' }, icon('back'), t('player.files.back'));
    back.addEventListener('click', () => {
      files = null;
      render();
      content.querySelector<HTMLElement>(`[data-focus-id="files-${CSS.escape(source.id)}"]`)?.focus({ preventScroll: false });
    });
    const status = h('div', { class: 'picker-loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), t('player.files.loading'));
    const view = h('div', { class: 'picker-files' }, h('div', { class: 'picker-files-head' }, back, h('span', { class: 'picker-files-source' }, [source.addon, source.file].filter(Boolean).join(' · '))), status);
    files = { source, view };
    render();
    back.focus();
    const hint = episodeHint(title, options.episode);
    torrentFiles(source.stream.url, hint)
      .then((list) => {
        if (files?.view !== view) return;
        const chosen = list.files.find((f) => f.index === list.chosen);
        const picker = createFilePicker({ list, chosenLabel: chosen && matchesHint(chosen, hint) ? t('player.files.this-episode') : t('player.files.default'), onPick: (file) => playFile(source, file) });
        const waiting = document.activeElement === back;
        status.replaceWith(picker);
        if (waiting) focusFilePicker(picker);
      })
      .catch(() => {
        if (files?.view !== view) return;
        status.replaceChildren(t('player.files.failed'));
      });
  }

  function toSource(stream: Stream, addon: { key: string; name: string } | undefined): Source {
    let id = ids.get(stream.url);
    if (!id) {
      id = `s${ids.size + 1}`;
      ids.set(stream.url, id);
    }
    return sourceFrom(stream, addon, id);
  }

  function render(): void {
    const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusId : undefined;

    if (files) {
      body.replaceChildren(files.view);
      footer.hidden = true;
      if (focusId) content.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
      return;
    }

    if (loadError !== null && (!ownDone || !own.length)) {
      const offline = isOffline();
      body.replaceChildren(problem(offline ? 'offline' : 'info', offline ? t('states.offline.title') : t('states.streams.load-failed'), errorText(loadError), retryButton()));
      footer.hidden = true;
      return;
    }

    if (providers?.length === 0 && (!ownDone || !own.length)) {
      const install = installButton();
      body.replaceChildren(
        anyStreamAddon
          ? problem('addons', t('titles.streams.none-for-title'), t('titles.streams.none-for-title-body'), install)
          : problem('addons', t('titles.streams.no-addons'), t('titles.streams.no-addons-body'), install),
      );
      footer.hidden = true;
      return;
    }

    const all = providers ?? [];
    const settled = ownDone && (all.length > 0 || own.length > 0) && all.every((p) => states.get(p.key)?.kind !== 'pending');
    const anyAnswered = all.some((p) => states.get(p.key)?.kind !== 'pending') || own.length > 0;

    if (!anyAnswered) {
      body.replaceChildren(
        h('div', { class: 'picker-loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), providers ? tn('titles.streams.asking', all.length) : t('titles.streams.finding-addons')),
        ...Array.from({ length: 5 }, () => h('div', { class: 'row-skeleton', 'aria-hidden': 'true' })),
      );
      footer.hidden = true;
      return;
    }

    const ranked = rank();
    const pickable = (s: Source) => !download || !downloadBlock(s.stream, title.type);
    const best = ranked.find(pickable);
    const groups = addonGroups(ranked);
    const addon = addonFilter.resolve(groups, settled);
    const visible = fromAddon(ranked, addon).filter((s) => matchesFilter(s, filter, hdrOnly));
    // With a filter on, the main button plays the best of what's listed, and says so:
    // pressing it under one addon and getting another addon's source would be a surprise.
    const filtered = addon !== null || filter !== 'All' || hdrOnly;
    const target = filtered ? visible.find(pickable) : best;

    const controls: HTMLElement[] = [];
    // The main action of an empty or failed list, offered as Play best is (see below).
    const offer = (action: HTMLElement) => {
      // Already there as the picker opens (the drawer focuses it), or once the addons answer; a focus id
      // keeps it focused as the list redraws (the person's own servers answering after the addons).
      action.dataset.autofocus = '';
      action.dataset.focusId ??= 'sources-action';
      if (!userMovedFocus && document.activeElement === closeButton) queueMicrotask(() => action.focus({ preventScroll: true }));
      return action;
    };
    if (target) {
      const label = filtered ? (download ? t('titles.streams.download-best-shown') : t('titles.streams.play-best-shown')) : download ? t('downloads.picker.best') : t('titles.streams.play-best');
      const detail = [target.traits.resolution, target.traits.hdr, target.size, filtered ? target.addon : ''].filter(Boolean).join(' · ') || target.addon;
      const playBest = h(
        'button',
        { class: 'play-best', 'data-autofocus': true, 'data-focus-id': 'play-best' },
        download ? icon('download') : icon('play', { filled: true }),
        h('span', { class: 'play-best-text' }, h('span', { class: 'play-best-label' }, label), h('span', { class: 'play-best-detail' }, detail)),
      );
      playBest.addEventListener('click', () => play(target));
      // Once results arrive, offer the obvious action — unless the user already went elsewhere.
      if (!userMovedFocus && document.activeElement === closeButton) queueMicrotask(() => playBest.focus({ preventScroll: true }));
      controls.push(playBest);
    }
    const chips = FILTERS.map((f) => {
      const chip = h('button', { class: 'chip', 'aria-pressed': String(filter === f), 'data-focus-id': `filter-${f}` }, f === 'All' ? t('titles.streams.all') : f);
      chip.addEventListener('click', () => {
        filter = f;
        render();
      });
      return chip;
    });
    const hdrSwitch = createSwitch(t('titles.streams.hdr-only'), hdrOnly, (on) => {
      hdrOnly = on;
      render();
    });
    hdrSwitch.dataset.focusId = 'hdr-only';
    // Quality filters only once there's something to filter: over "nothing found" they'd do nothing.
    if (ranked.length) controls.push(h('div', { class: 'picker-filters' }, h('div', { class: 'chips', role: 'group', 'aria-label': t('titles.streams.quality') }, ...chips), hdrSwitch));
    if (offerAddonFilter(groups)) controls.push(addonChips(groups, addon));

    let list: HTMLElement;
    if (visible.length) {
      // Whether a source that breaks a limit scores more than the best one (so the best isn't the highest score).
      const outscored = !!best && ranked.some((s) => breaksLimit(s.signals) && s.score > best.score);
      list = h('div', { class: 'source-list' }, ...visible.map((s) => sourceRow(s, s === best, settled, ranked.length, best?.score ?? 0, outscored)));
    } else if (!ranked.length && settled && all.length && all.every((p) => states.get(p.key)?.kind === 'failed')) {
      // Every addon failed: that's not "no sources", and asking again often works.
      list = h('div', { class: 'source-list' }, allFailed(all.map((p) => states.get(p.key)).flatMap((state) => (state?.kind === 'failed' ? [state.cause] : [])), offer));
    } else if (!ranked.length && settled && hiddenTorrents > 0) {
      // Found only torrents, which Settings has off: "no sources" would send the person looking for another addon.
      const open = h('button', { class: 'button large primary', hidden: !options.ctx }, t('titles.streams.only-torrents-open'));
      open.addEventListener('click', () => {
        close();
        openSettingsTo('addons', undefined, 'sources');
        options.ctx?.go('settings');
      });
      list = h('div', { class: 'source-list' }, problem('addons', t('titles.streams.only-torrents-title'), t('titles.streams.only-torrents'), offer(open)));
    } else if (!ranked.length && settled) {
      // Every addon answered with nothing: another addon is the way on (asking again would get the same answer).
      list = h('div', { class: 'source-list' }, problem('addons', t('titles.streams.none-found-title'), t('titles.streams.none-found'), offer(installButton())));
    } else if (!ranked.length) {
      list = h('div', { class: 'source-list' }, h('div', { class: 'picker-no-match' }, h('span', {}, t('titles.streams.waiting'))));
    } else {
      const clear = h('button', { class: 'button' }, t('titles.common.clear-filters'));
      clear.addEventListener('click', () => {
        filter = 'All';
        hdrOnly = false;
        addonFilter.choose(null);
        render();
      });
      list = h('div', { class: 'source-list' }, h('div', { class: 'picker-no-match' }, h('span', {}, t('titles.streams.no-match')), clear));
    }

    body.replaceChildren(h('div', { class: 'picker-controls' }, ...controls), list);
    renderFooter(visible.length, ranked.length);
    if (focusId) content.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
  }

  /** "All addons" and one chip per addon (with its source count); wraps onto more lines with many addons. */
  function addonChips(groups: readonly AddonGroup[], active: string | null): HTMLElement {
    const chip = (addon: string | null, focusId: string, name: string, count?: number) => {
      const b = h(
        'button',
        { class: 'chip', 'aria-pressed': String(active === addon), 'data-focus-id': focusId, title: name, ...(count === undefined ? {} : { 'aria-label': tn('titles.streams.addon-sources', count, { name }) }) },
        h('span', { class: 'chip-name' }, name),
        count === undefined ? '' : h('span', { class: 'chip-count' }, count.toLocaleString(locale())),
      );
      b.addEventListener('click', () => {
        addonFilter.choose(addon);
        render();
      });
      return b;
    };
    return h(
      'div',
      { class: 'chips picker-addons', role: 'group', 'aria-label': t('titles.streams.addons') },
      chip(null, 'addon-all', t('titles.streams.all-addons')),
      ...groups.map((g) => chip(g.addon, addonId(g.addon), g.addon || t('titles.streams.unnamed-addon'), g.count)),
    );
  }

  function sourceRow(source: Ranked<Source>, isBest: boolean, settled: boolean, total: number, bestScore: number, outscored: boolean): HTMLElement {
    const { traits } = source;
    const res = traits.resolution;
    const tile = h('span', { class: 'res-tile' }, h('span', { class: 'res-big' }, res === '2160p' ? '4K' : res ? res.replace('p', '') : '?'), h('span', { class: 'res-sub' }, res === '2160p' ? '2160p' : res ? 'p' : ''));
    // The same kind of line for every source: what it is, never the addon's own label (that varies by addon).
    const spec = [traits.hdr, source.codec, audioLabel(traits.audio)].filter(Boolean).join(' · ') || source.release || t('titles.streams.unknown-quality');

    const blocked = download ? downloadBlock(source.stream, title.type) : null;
    const main = h(
      'button',
      { class: 'source-main', 'data-focus-id': `src-${source.id}`, disabled: !!blocked },
      tile,
      h(
        'span',
        { class: 'source-text' },
        h(
          'span',
          { class: 'source-line' },
          isBest ? h('span', { class: 'best-badge' }, t('titles.streams.best-match')) : '',
          source.copy ? h('span', { class: 'copy-badge', title: t(`titles.streams.copy.${source.copy.toLowerCase() as 'cam' | 'ts' | 'tc' | 'scr'}`) }, source.copy) : '',
          traits.hdr ? h('span', { class: 'hdr-badge' }, traits.hdr === 'Dolby Vision' ? 'DV' : 'HDR') : '',
          traits.cached ? h('span', { class: 'cached-badge', title: t('titles.streams.cached-hint') }, t('titles.streams.cached')) : '',
          h('span', { class: 'source-spec' }, spec),
          failureNote(failure(source)),
          download ? '' : gateNote(autoplayGate(source, autoplayLimits())),
          otherFilmYearOf(source) ? h('span', { class: 'failed-note' }, t('titles.streams.other-film', { year: String(otherFilmYearOf(source)) })) : '',
        ),
        h('span', { class: 'source-origin' }, [source.addon, source.release].filter(Boolean).join(' · ')),
        source.file ? h('span', { class: 'source-file mono', title: source.file }, source.file) : '',
        blocked ? h('span', { class: 'failed-note' }, blockReason(blocked)) : '',
      ),
    );
    main.addEventListener('click', () => play(source));

    const end = h('span', { class: 'source-end' }, source.size ? h('span', { class: 'source-size' }, source.size) : '');
    // A torrent can be a season pack: its files, to pick the one to play.
    if (!download && source.stream.torrent) {
      const pick = h('button', { class: 'why-button', title: t('player.files.open-label'), 'aria-label': t('player.files.open-label'), 'data-focus-id': `files-${source.id}` }, t('player.files.open'));
      pick.addEventListener('click', () => showFiles(source));
      end.append(pick);
    }
    // Settings → Player → External player: web sources only (see external.ts).
    if (!download && externalConfigured() && canOpenExternally(source.stream.url, !!source.stream.torrent)) {
      const external = h('button', { class: 'why-button', title: t('local.external.open-label'), 'aria-label': t('local.external.open-label'), 'data-focus-id': `external-${source.id}` }, t('local.external.open'));
      external.addEventListener('click', () => {
        close();
        void openExternally(source.stream.url);
      });
      end.append(external);
    }
    const open = whyOpen === source.id;
    const whyId = `why-${source.id}`;
    // Why? is a sibling of the row's play button (not inside it), so it's its
    // own focus stop and pressing it never starts playback.
    if (settled) {
      const why = h(
        'button',
        { class: 'why-button', 'aria-expanded': String(open), 'aria-controls': whyId, title: t('titles.streams.why-title'), 'data-focus-id': `why-${source.id}` },
        t('titles.streams.why'),
        icon('chevronDown'),
      );
      why.addEventListener('click', () => {
        whyOpen = open ? null : source.id;
        render();
      });
      end.append(why);
    }

    const row = h('div', { class: isBest ? 'source-row best' : 'source-row' }, main, end);
    if (!open || !settled) return h('div', { class: 'source-item' }, row);

    return h(
      'div',
      { class: 'source-item' },
      row,
      h(
        'div',
        { class: 'why-panel', id: whyId, role: 'region', 'aria-label': t('titles.streams.signals') },
        h('span', { class: 'why-title' }, t('titles.streams.how-ranked')),
        ...(source.signals.length
          ? source.signals.map((signal) =>
              h('div', { class: 'why-signal' }, h('span', {}, signalText(signal)), h('span', { class: signal.points > 0 ? 'points up' : signal.points < 0 ? 'points down' : 'points' }, signal.points > 0 ? `+${signal.points}` : signal.points < 0 ? `−${-signal.points}` : '0')),
            )
          : [h('div', { class: 'why-signal' }, h('span', {}, t('titles.streams.no-signals')))]),
        h('div', { class: 'why-total' }, h('span', {}, t('titles.streams.score')), h('span', {}, String(source.score))),
        h('span', { class: 'why-note' }, !isBest ? t('titles.streams.best-scores', { score: bestScore }) : outscored ? t('titles.why.best-within-limits') : tn('titles.streams.highest', total)),
        // A higher score can still sit lower: breaking a limit puts a source after all that don't.
        breaksLimit(source.signals) ? h('span', { class: 'why-note' }, isBest ? t('titles.why.best-breaks-limit') : t('titles.why.breaks-limit')) : '',
      ),
    );
  }

  function renderFooter(visible: number, total: number): void {
    const rememberSwitch = createSwitch(series ? t('titles.streams.remember-series') : t('titles.streams.remember-quality'), remember, (on) => {
      remember = on;
      settings.set(REMEMBER_KEY, on).catch((err: unknown) => console.error('Could not save setting', err));
    });
    rememberSwitch.dataset.focusId = 'remember';
    rememberSwitch.classList.add('wide');

    const statuses = (providers ?? []).map((addon) => {
      const state = states.get(addon.key) ?? { kind: 'pending' };
      const text = state.kind === 'pending' ? t('titles.streams.asking-status') : state.kind === 'failed' ? state.error : tn('titles.streams.sources', state.count);
      return h('span', { class: `provider ${state.kind}` }, h('span', { class: 'provider-dot', 'aria-hidden': 'true' }), `${addon.manifest.name} · ${text}`);
    });

    footer.hidden = false;
    const hidden = hiddenTorrents ? h('span', {}, tn('titles.streams.torrents-hidden', hiddenTorrents)) : '';
    footer.replaceChildren(download ? '' : rememberSwitch, h('div', { class: 'provider-status', role: 'status' }, h('span', {}, tn('titles.streams.visible-of', total, { visible })), hidden, ...statuses));
  }

  /** An empty or failed picker: icon, title, one line, one action. */
  function problem(iconName: IconName, title: string, detail: string, action: HTMLElement): HTMLElement {
    return h('div', { class: 'picker-empty', role: 'status' }, h('span', { class: 'state-icon' }, icon(iconName)), h('span', { class: 'picker-empty-title' }, title), h('p', {}, detail), action);
  }

  /** Install an addon: Settings → Addons (only from a title's page, where there's a page to go to). */
  function installButton(): HTMLElement {
    const install = h('button', { class: 'button large primary', hidden: !options.ctx }, t('titles.streams.install'));
    install.addEventListener('click', () => {
      close();
      openSettingsTo('addons');
      options.ctx?.go('settings');
    });
    return install;
  }

  /**
   * Every addon failed. Said as what went wrong when they all failed the same way: an addon refusing
   * (its setup or account expired) needs fixing in Settings, not another try; otherwise Try again.
   */
  function allFailed(causes: readonly AddonError[], offer: (action: HTMLElement) => HTMLElement): HTMLElement {
    if (isOffline()) return problem('offline', t('states.offline.title'), t('states.cause.offline'), offer(retryButton()));
    const found = causes.map((cause) => classify(cause).cause);
    const same = found.length > 0 && found.every((cause) => cause === found[0]) ? found[0] : undefined;
    if (same === 'signed-out' && options.ctx) {
      const fix = fixButton('addon', (room) => {
        close();
        options.ctx?.go(room);
      });
      fix.classList.add('large');
      return problem('info', t('states.streams.load-failed'), t('states.auth.addon'), offer(fix));
    }
    if (same === 'busy') return problem('info', t('states.streams.load-failed'), t('states.cause.busy'), offer(retryButton()));
    return problem('info', t('states.streams.failed-title'), t('states.streams.failed'), offer(retryButton()));
  }

  /** Try again: asks every addon afresh (and again by itself once the connection is back). */
  function retryButton(): HTMLElement {
    const button = h('button', { class: 'button large primary', 'data-focus-id': 'sources-retry' }, t('browse.search.retry'));
    button.addEventListener('click', again);
    retryWhenOnline(button, again);
    return button;
  }

  function again(): void {
    if (controller.signal.aborted) return;
    loadError = null;
    providers = null;
    sources = [];
    states.clear();
    render();
    start();
  }

  function start(): void {
    run().catch((err: unknown) => {
      console.error('Could not load sources', err);
      loadError = err;
      render();
    });
  }

  async function run(): Promise<void> {
    if (!download) {
      void ownFound(title, options.episode)
        .then((found) => {
          own = found;
          ownDone = true;
          render();
        })
        .catch((err: unknown) => {
          // The addons' sources still show: the own servers just add none.
          console.warn('Could not look for own copies', err);
          ownDone = true;
          render();
        });
    }
    [providers, anyStreamAddon] = await Promise.all([streamAddons(req), servesStreams(), loadFailures(), loadExternal()]);
    for (const addon of providers) states.set(addon.key, { kind: 'pending' });
    render();
    for await (const event of loadStreams(providers, req, controller.signal)) {
      if (event.type === 'partial') {
        hiddenTorrents = event.items.filter(({ item }) => !usable(item)).length;
        sources = event.items.filter(({ item }) => usable(item)).map(({ item, origins }) => toSource(item, origins[0]));
        states.set(event.origin.key, { kind: 'ok', count: event.items.filter((s) => s.origins.some((o) => o.key === event.origin.key)).length });
      } else if (event.type === 'error') {
        states.set(event.origin.key, { kind: 'failed', error: shortError(event.error), cause: event.error });
      }
      render();
    }
  }

  content.addEventListener('focusin', (event) => {
    if (event.target !== closeButton) userMovedFocus = true;
  });

  settings
    .get(REMEMBER_KEY)
    .then((saved) => {
      if (typeof saved === 'boolean') remember = saved;
    })
    .catch(() => undefined);

  render();
  const close = openDrawer(content, download ? t('downloads.picker.drawer', { name: title.name }) : t('titles.streams.drawer', { name: title.name }), () => controller.abort());
  closeButton.addEventListener('click', close);
  start();
}
