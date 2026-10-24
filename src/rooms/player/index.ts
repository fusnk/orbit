/**
 * The Orbit player. Video is drawn natively by mpv beneath the page; this view
 * is the layer on top: a loading screen until the first frame, then the
 * controls and their panels. mpv is the source of truth: the view sends
 * commands and renders whatever state `player://event` reports.
 */
import { AVOID_TRACKS_KEY, parseAvoidWords } from './tracks';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { RoomContext } from '../../app/router';
import { episodeAfter, episodeBefore, type Title } from '../../catalog/titles';
import { artImage } from '../../components/cards';
import { favouriteHeart } from '../../components/favourite-heart';
import { icon, showIcon, type IconName } from '../../components/icons';
import { titleHeading } from '../../components/title-logo';
import { toast } from '../../components/toast';
import { isRtl, t } from '../../i18n';
import { quipLine } from '../../components/fun-lines';
import { h } from '../../lib/dom';
import { errorText, isOffline, playbackText } from '../../components/state-message';
import { settings } from '../../lib/ipc';
import { loadQueue, markStarted, onQueueChange, queueHead } from '../../library/queue';
import { createOwnServerReporter } from '../../library/own-servers';
import { recordProgress, resumePosition, watchRecord } from '../../library/watch';
import { resumeFrom } from '../../library/media-server';
import { playTitle } from '../detail/streams';
import { mayPlay } from '../profiles/parental';
import type { EpisodeRef } from '../detail/title-actions';
import { fullShow } from './episode-list';
import { formatTime, qualityLabel } from './format';
import { describeError } from '../../app/errors';
import { LEAVING_PROFILE } from '../../app/profile-switch';
import { QUITTING } from '../../app/quit';
import { firstKey } from '../../lib/keymap';
import { createPlayerTooltips } from './tooltips';
import { playerKeyHandler, VOLUME_STEP, withKey } from './keys';
import { mergeLateSources } from './late-sources';
import { AUTO_SYNC_KEY, clampVolume, DOUBLE_CLICK_SEEK_KEY, HDR_KEY, HDR_SUBTITLES_KEY, HOLD_BOOST_KEY, NUMBER_JUMP_KEY, parsePassthrough, parseSeekStep, PASSTHROUGH_FORMATS, PASSTHROUGH_KEY, pictureSide, SEEK_STEP_KEY, SMOOTH_MOTION_PREFIX, VOLUME_BOOST_KEY, VOLUME_BOOST_LEVEL_PREFIX, parseVolumeBoost, type VolumeBoostLevel } from './player-settings';
import { profileSetting } from '../../library/profiles';
import { createCheatSheet } from './cheat-sheet';
import { createEpisodeDock, EPISODES_DOCKED_KEY } from './episode-dock';
import { createGrayscalePause, GRAYSCALE_PAUSE_KEY } from './grayscale-pause';
import { BOOST_SPEED, createHoldSpeed } from './hold-speed';
import { createLock } from './lock';
import { createSeekBubble } from './seek-bubble';
import { presetStep, speedLabel } from './speed';
import { createSubtitleLift, liftFor } from './subtitle-lift';
import { parseSoundMode } from './sound';
import { parseTimeMode, TIME_MODE_KEY } from './time-readout';
import { chooseUpNext, countdownSeconds, HWDEC_KEY, leftAt, parseAutoplayLimit, parseAutoplayMode, parseNextUpAt, parseNextUpStyle, parseVolume, PLAYBACK_SETTINGS } from './next-up';
import { createNextUp } from './next-up-controller';
import { createNextUpBridge } from './next-up-bridge';
import { createPanels } from './panel-controller';
import { parseFit, type PlayableSource } from './panels';
import { LEGACY_LOOK_KEY, parsePicture, parsePictureQuality, PICTURE_KEY, PICTURE_QUALITY_KEY, type PictureQuality } from './picture';
import { rememberSource } from './last-source';
import { whereKey } from './failed-sources';
import { createVolumePopup, parseVolumePopupPosition, VOLUME_POPUP_KEY, VOLUME_POPUP_POSITION_KEY } from './volume-popup';
import './player.css';
import './playerplus.css';
import './player-polish.css';
import { createPlayerLayout } from './layout';
import { createCinema } from './cinema';
import { createEndScreen } from './end-screen';
import { creditsStarted, FILM_END_KEY, leavesFinished, parseFilmEnd, playsFromStart } from './end-screen-rules';
import { createDetail } from '../detail';
import { createEarlyStopRetry, createFailover, createLiveReconnect, createPlace, endOfFile, looksLikePlaceholder } from './failover';
import { acceptsEvent } from './load-events';
import { createPauseInfo } from './pause-info';
import { createPreviews, PREVIEWS_KEY } from './previews';
import { audioLanguages, keyForCode, LANGUAGE_SETTINGS, languagesChange, mpvLanguages, parseAudioLanguage, parseLanguages } from './preferred-language';
import { originalLanguage } from '../../catalog/extras';
import { withTimeout } from '../../lib/timeout';
import { createPresence, DISCORD_KEY } from './presence';
import { BUTTON_KEYS, createMediaKeyGate, createMediaSession, isMediaButton, MEDIA_BUTTON_EVENT, MEDIA_SEEK_EVENT, mediaGroup, runMediaSeek, unnamed } from './media-session';
import { resumePrompt } from './resume-prompt';
import { canStepChapter } from './chapters';
import { leavesFullscreen, topDragsWindow } from './fullscreen';
import { setPlayerOpen } from '../../app/player-gate';
import { parseSkipModes, SKIP_MODES_KEY, type Chapter } from './skip';
import { ADJUSTMENT_SETTINGS, createAdjustments } from './adjustments';
import { createChannelSurf } from './channel-surf';
import { createSkipController } from './skip-controller';
import { applySegmentColors, parseSegmentColors, SEGMENT_COLORS_KEY } from './skip-tuning';
import { LEARN_SKIPS_KEY } from './learned-skips';
import { shufflePlayed, startShuffle, type ShuffleSession } from './shuffle';
import { createSleepTimer } from './sleep-timer';
import { AUDIO_NORMALIZE_KEY, subtitleStyle } from './subtitle-style';
import type { TrackInfo } from './tracks';
import { isTorrent, startTorrent, stopTorrent } from './torrent';
import { episodeHint } from '../../lib/torrent-files';
import { createTransport } from './transport';
import { attachRemotePlayer, tellNowPlaying } from '../../app/remote-player';
import { attachPlayOn, openRemoteControl } from '../../app/connect-ui';
import { playMessage } from '../../lib/connect';
import { isAndroid } from '../../lib/platform';
import type { AudioOutputs } from './audio-device';

export type { PlayableSource } from './panels';

interface Status {
  timePos: number | null;
  subDelay?: number | null;
  duration: number | null;
  paused: boolean;
  buffering: boolean;
  volume: number | null;
  muted: boolean;
  cacheTime: number | null;
  height: number | null;
  speed: number | null;
  /** The sound goes to a receiver undecoded (Settings → Audio passthrough). */
  passthrough: boolean;
  /** At the end of the file: mpv paused itself on the last frame (not the viewer's pause). */
  eof: boolean;
}

/** `load` is the number `load()` gave the file the event is about (see load-events.ts). */
type PlayerEvent = { load: number } & (
  | ({ kind: 'status' } & Status)
  | { kind: 'tracks'; tracks: TrackInfo[] }
  | { kind: 'chapters'; chapters: Chapter[] }
  | ({ kind: 'outputs' } & AudioOutputs)
  | { kind: 'loaded' }
  | { kind: 'ready' }
  | { kind: 'ended' }
  | { kind: 'error'; message: string }
  // Android: the person left the native player screen (src-tauri/src/player/android.rs).
  | { kind: 'closed' }
  // Android: Channel up/down or next/previous on the remote, which the native player screen leaves to the page.
  | { kind: 'key'; key: string }
);

export interface PlayRequest {
  title: Title;
  episode?: EpisodeRef | undefined;
  source: PlayableSource;
  /** Every source for this title, ranked as in the picker (includes `source`). */
  sources: readonly PlayableSource[];
  /** The full list once slow addons have answered too, when playback started before they did (see late-sources.ts). */
  moreSources?: Promise<readonly PlayableSource[]> | undefined;
  /** A Live TV channel: no seeking, resuming or watch history. */
  live?: boolean | undefined;
  /** A past Live TV programme (catch-up): seekable, but no resuming or watch history. */
  replay?: boolean | undefined;
  /** A title's trailer (from YouTube): no resuming, watch history or skip times. */
  trailer?: boolean | undefined;
  /**
   * A video file from this PC (dropped onto the window): resumes, but has no other
   * sources to fail over to, and nothing about it (not even its name) goes to the
   * network: no subtitle addons, no Discord.
   */
  local?: boolean | undefined;
  /**
   * A link pasted into Search or the palette (app/play-link.ts): no catalog
   * title, so no resuming, watch history or source memory, no other sources,
   * and its address and name go nowhere but the player.
   */
  link?: boolean | undefined;
  /**
   * Started by "Shuffle" on a series: this player then shuffles the show
   * (see shuffle.ts) until it's turned off, another title plays, or the
   * player closes.
   */
  shuffle?: boolean | undefined;
  /** Sent from another device (Orbit Connect): where to start, without asking about resuming. Used once. */
  start?: number | undefined;
  /** Sent from another device: the audio and subtitle languages it was playing with (Orbit's language keys), ahead of this profile's. */
  languages?: { audio: string | null; subtitle: string | null } | undefined;
}

/** Spec: cursor and controls hide after 2.8 s idle while playing. */
const IDLE_MS = 2800;
const VOLUME_KEY = 'player.volume';
/** Distinguishes a click (play/pause) from the first half of a double-click (full screen). */
const CLICK_DELAY_MS = 220;
/** How long the speed pill stays up after the speed changes. */
const SPEED_PILL_MS = 1200;
/** How far `,` and `.` go while playing (paused, they step a frame). */
const FINE_SEEK_SECONDS = 1;
/** How often progress is saved while playing (also on pause, seek-away and close). */
const SAVE_EVERY_MS = 15_000;
/** At most this long looking up a title's original language before its file opens (without a TMDB key it's instant). */
const ORIGINAL_LANGUAGE_WAIT_MS = 2500;
/** A debrid placeholder no other source replaced (see failover.ts): coded, so the error is in the person's language. */
const PLACEHOLDER_ERROR = 'err.player.placeholder';
/** No first frame in time and no other source to try (see failover.ts): coded, like the placeholder's. */
const SLOW_ERROR = 'err.player.slow';
/** A live channel that kept dropping, and a film or episode whose stream stopped early twice: coded too. */
const LIVE_STOPPED_ERROR = 'err.player.live-stopped';
const STOPPED_EARLY_ERROR = 'err.player.stopped-early';

/** The open player, if any. Only one plays at a time. */
let session: { view: HTMLElement; close(): void; load(request: PlayRequest): void; pauseBehindPrompt(): boolean; resumeAfterPrompt(): void } | null = null;

/** Whether the player is showing; app-wide shortcuts stay out of its way. */
export function playerOpen(): boolean {
  return session !== null;
}

/** A prompt over the player is about to switch what it plays (e.g. "Continue with last source"): the file on now waits, paused. Whether it paused. */
export function pauseBehindPrompt(): boolean {
  return session?.pauseBehindPrompt() ?? false;
}

/** That prompt was dismissed without switching: the file waiting behind it plays on. */
export function resumeAfterPrompt(): void {
  session?.resumeAfterPrompt();
}

/** Stops playback once the router shows something other than the player. */
export function syncPlayer(view: HTMLElement): void {
  if (session && session.view !== view) session.close();
}

/**
 * Plays `request`. If the player is already showing (e.g. an episode picked
 * from its Episodes panel), it switches in place rather than stacking a
 * second player behind the first.
 */
export function openPlayer(request: PlayRequest, ctx: RoomContext): void {
  // The profile's content limit, before the player opens over the page (`load` asks again for each later file).
  if (!mayPlay(request, () => openPlayer(request, ctx))) return;
  if (session?.view.isConnected) return session.load(request);
  session?.close();
  ctx.open(playerView(request, ctx));
}

/** The saved volume, at most `max` (it may have been saved above 100% with the boost on), or null if none. */
async function savedVolume(max: number): Promise<{ volume: number; muted: boolean } | null> {
  const saved = parseVolume(await settings.get(VOLUME_KEY).catch(() => null));
  return saved && { ...saved, volume: clampVolume(saved.volume, max) };
}

function playerView(initial: PlayRequest, ctx: RoomContext): HTMLElement {
  const win = getCurrentWindow();
  let request = initial;
  let status: Status = { timePos: null, duration: null, paused: false, buffering: true, volume: null, muted: false, cacheTime: null, height: null, speed: null, passthrough: false, eof: false };
  let started = false;
  /** The playing file's chapters (most streams have none). */
  let chapters: Chapter[] = [];
  /** Whether this file's length has been checked for a debrid placeholder, and whether it is one. */
  let lengthChecked = false;
  let placeholder = false;
  /** Whether the error up is the slow-start or stalled one (see `SLOW_ERROR`): it goes by itself should the source come through. */
  let slowShown = false;
  /** The error put aside for the source list ("Try another source"), and for which load. */
  let errorAside: { reason: unknown; load: number } | undefined;
  /** Tries the source again once the connection is back, while its offline error is up (see `showError`). */
  let retryOnline = () => {};
  /** Sources opened again after their stream stopped early (see `endedEarly`): a second early stop soon after gives up on one. */
  const earlyStop = createEarlyStopRetry();
  let closed = false;
  let fullscreen = false;
  /** Maximized (not full screen): the top bar then isn't a drag region, or a missed click near Back restored the window. */
  let maximized = false;
  /** The window was in full screen as the player opened (Open as full screen, or kept from the last player): closing leaves it so. */
  let fullscreenBefore = false;
  let hideTimer: number | undefined;
  let clickTimer: number | undefined;
  let saveTimer: number | undefined;
  let lastSave = 0;
  /** Counts loads, so a resume question left unanswered can't open an older request, and events from an older file are ignored. */
  let loads = 0;
  /** Stops the torrent progress line once the video shows (or another file loads). */
  let stopTorrentNote = () => {};
  /** Whether a torrent is downloading for this player, to stop when it moves on. */
  let torrentRunning = false;
  /** True from asking mpv for a file until it reports that file loaded; older events are ignored. */
  let awaitingFile = false;
  /** The load a pause was pressed for while its file was still being asked for: `player_open` unpauses, so it's sent again after. */
  let pausePending = 0;
  /** Paused only to wait behind a prompt: not the person pausing, so the "You're watching" card stays away. */
  let promptPaused = false;
  /** Paused by `pauseBehindPrompt` (a prompt from outside the player), until `resumeAfterPrompt` or another file. */
  let heldByPrompt = false;
  /** The Playback settings have been read and the first file asked for (see `session.load`). */
  let settingsRead = false;
  /** Settings → Playback → Resume: 'always', 'start-over' or 'ask'. */
  let resumeMode = 'always';
  let autoplay = true;
  let pauseOnMinimize = true;
  /** How far ←/→ and the jump buttons go (Settings → Player). */
  let seekStep = parseSeekStep(undefined);
  /** 100, or 150 with "Allow volume above 100%" on (Settings → Player). */
  let maxVolume = 100;
  let boostKey: string | undefined;
  let boostChange: Promise<unknown> = Promise.resolve();
  /** Settles once mpv has the volume limit, so a saved volume above 100% isn't refused before it. */
  let limitApplied: Promise<unknown> = Promise.resolve();
  /** Settings → Audio & Subtitles, read as the player opens; and mpv's languages for the file asked for, set before it opens. */
  let languagePrefs = { audio: '', subtitles: [] as string[], forcedOnly: false, original: false };
  let languagesApplied: Promise<unknown> = Promise.resolve();
  /** Counts `applyLanguages` calls: only the latest sets mpv's languages. */
  let languageTurn = 0;
  /** The languages in place are the ones another device sent (see `languagesChange`). */
  let languagesSent = false;
  /** Settings → Video → Picture quality, as sent to mpv. */
  let pictureQuality: PictureQuality = 'balanced';
  /** Settings → Playback: stay in full screen after closing the player. */
  let keepFullscreen = false;
  /** Settings → Playback → Volume pop-up: shown for volume changes while the controls are hidden. */
  let volumePopupOn = false;
  const volumePopup = createVolumePopup();
  const cleanups: (() => void)[] = [];
  /** This session's shuffle, if a show is being shuffled. */
  let shuffle: ShuffleSession | undefined;
  /** The episode the shuffle last drew a next one for (a new source for the same episode keeps the draw). */
  let shuffleDrawnFor: string | undefined;
  // Discord Rich Presence, if turned on (see presence.ts).
  const presence = createPresence();
  // Windows' media flyout and the media keys while Orbit is in the background (see media-session.ts).
  const media = createMediaSession();
  const mediaGate = createMediaKeyGate();
  // Seek-bar previews from a second, hidden mpv (see previews.ts).
  const previews = createPreviews();
  let previewsOn = true;
  // A dead or stalled source gives way to the next best one (see failover.ts).
  let autoSwitch = true;
  /** Where it has got to, for going on elsewhere after a failure (see `createPlace`). */
  const place = createPlace();
  const failover = createFailover({
    enabled: () => autoSwitch,
    request: () => request,
    position: () => place.at(),
    // 0 rather than undefined, so a retry doesn't ask about resuming again.
    switchTo: (source, at) => load({ ...request, source }, at ?? 0),
    stalled: () => {
      if (request.live) reconnectLive();
      // A film or episode with nowhere to switch to: the message and its choices, rather than spinning on.
      // Not on Android, where the error makes the player step aside (stopping what may yet buffer through).
      else if (!isAndroid) showError(SLOW_ERROR);
    },
    slow: () => showError(SLOW_ERROR),
  });
  // A live channel whose stream dropped (mpv reached its end, or buffered on for the stall limit) is opened again a few times (see failover.ts).
  const liveReconnect = createLiveReconnect();
  function reconnectLive(): void {
    if (liveReconnect.reconnect(request.source.url, Date.now())) load(request);
    else fail(LIVE_STOPPED_ERROR);
  }

  // ── Loading screen (rebuilt for each title/episode) ──
  const loading = h('div', { class: 'player-loading' });

  // ── Controls ──
  const button = (label: string, iconName?: IconName, className = 'player-button') => {
    const b = h('button', { class: className, title: label, 'aria-label': label });
    if (iconName) b.append(icon(iconName));
    return b;
  };

  const back = button(t('player.controls.back'), 'back');
  back.addEventListener('click', () => ctx.back());

  // Play/pause, jumps, volume, seek bar and time (see transport.ts).
  const transport = createTransport({
    status: () => status,
    setPaused: (paused) => setPaused(paused),
    seekBy: (seconds) => seekBy(seconds),
    seekTo: (seconds) => {
      skip.userSeek({ to: seconds });
      void soft('player_seek', { seconds }, t('player.error.seek'));
    },
    setMuted,
    setVolume,
    segments: () => (started ? skip.segments() : []),
    timeModeChanged: (mode) => void settings.set(TIME_MODE_KEY, mode).catch(() => {}),
  });
  /** One "+30 s" for presses in a row (see seek-bubble.ts). */
  const bubble = createSeekBubble();
  /** Settings → Player: number keys jump, hold play/pause for 2× (both on unless turned off). */
  let numberJump = true;
  let holdBoost = true;
  /** Settings → Player: double-click the picture's sides to jump (off unless turned on). */
  let doubleClickSeek = false;
  // Hold play/pause for 2× (see hold-speed.ts).
  const boostPill = h('div', { class: 'speed-pill', 'aria-hidden': 'true', hidden: true }, `${BOOST_SPEED}×`);
  // Subtitles move up while the controls show (see subtitle-lift.ts).
  const subtitleLift = createSubtitleLift((lift) => void invoke('player_lift_subtitles', { lift }).catch(() => {}));
  /** Hides the pill after a speed change shows it (any change, not only the held 2×). */
  let pillTimer: number | undefined;
  function flashSpeed(value: number): void {
    if (view.classList.contains('boosting')) return;
    boostPill.textContent = speedLabel(value);
    boostPill.hidden = false;
    window.clearTimeout(pillTimer);
    pillTimer = window.setTimeout(() => {
      if (!view.classList.contains('boosting')) boostPill.hidden = true;
    }, SPEED_PILL_MS);
  }
  const hold = createHoldSpeed({
    enabled: () => holdBoost,
    actNow: () => status.paused || !started || !!request.live,
    togglePause: () => setPaused(!status.paused),
    speed: () => status.speed ?? 1,
    setSpeed: (speed) => void soft('player_set_speed', { speed }, t('player.error.speed')),
    boosting: (on) => {
      window.clearTimeout(pillTimer);
      boostPill.textContent = `${BOOST_SPEED}×`;
      boostPill.hidden = !on;
      view.classList.toggle('boosting', on);
    },
  });

  const name = h('div', { class: 'player-name' });
  const quality = h('span', { class: 'quality-badge', hidden: true });

  const sleep = createSleepTimer({
    paused: () => status.paused,
    pause: () => setPaused(true),
    changed: () => {
      panels.redraw();
      render();
    },
  });

  // Timing, picture shape and night mode (see adjustments.ts).
  const adjust = createAdjustments((cmd, args, message) => void soft(cmd, args, message));
  // Black and white while paused, if turned on (see grayscale-pause.ts).
  const grayPause = createGrayscalePause((amount) => adjust.setGray(amount));

  // The floating panel and the buttons that open it (see panel-controller.ts).
  const panels = createPanels({
    adjust,
    ctx,
    request: () => request,
    status: () => status,
    sleep,
    load: (next, start) => load(next, start),
    position: () => place.at(),
    seekTo: (seconds) => {
      skip.userSeek({ to: seconds });
      void soft('player_seek', { seconds }, t('player.error.seek'));
    },
    segments: () => (started ? skip.segments() : []),
    playSegment: (segment) => skip.watch(segment),
    soft: (cmd, args, message) => void soft(cmd, args, message),
    showControls: () => showControls(),
    pictureQuality: () => pictureQuality,
    episodesDocked: () => dock.enabled(),
    speedNote: () => {
      const key = firstKey('player.play-pause');
      return holdBoost && key && !request.live ? t('playerplus.hub.speed-note', { key }) : '';
    },
    toggleDock: () => dock.toggle(),
    shortcuts: () => { cheat.toggle(''); cheat.element.querySelector<HTMLButtonElement>('button')?.focus(); },
    volumeBoost: () => maxVolume,
    setVolumeBoost,
    // Closed without picking another source (which loads, and so counts as moving on): the error comes back.
    closed: () => {
      if (errorAside?.load === loads) showError(errorAside.reason);
    },
  });

  // Skip intro / recap / credits (see skip-controller.ts).
  const skip = createSkipController({
    position: () => ({ timePos: status.timePos, duration: status.duration, started }),
    // In the credits with an episode to go to, the Next Up card takes over.
    // A film's end screen stands in for it too.
    creditsHandedOff: () => (autoplay && !!upNext() && !nextUp.dismissed()) || endScreen.shown(),
    seek: (seconds) => void soft('player_seek', { seconds }, t('player.error.skip')),
    next: () => {
      const next = upNext();
      return next ? (next.kind === 'queue' ? t('watching.queue.next-in-queue') : t('player.controls.next-episode')) : null;
    },
    // Offered only in the credits: a hand-off, so the episode counts as finished.
    playNext: () => void nextUp.playNext(false, true),
    focusFallback: () => transport.toggle.focus({ preventScroll: true }),
  });

  // Next Up and the end-credits takeover (see next-up-controller.ts).
  const bridge = createNextUpBridge();
  const nextUp = createNextUp({
    ctx,
    request: () => request,
    status: () => status,
    started: () => started,
    closed: () => closed,
    upNext: () => upNext(),
    segments: () => skip.segments(),
    panelOpen: () => !!panels.kind(),
    blocked: () => !autoplay || sleep.stopsAtEnd() || endScreen.shown(),
    play: (next, finished) => {
      // A hand-off eases into the next episode (see next-up-bridge.ts); it loads at once all the same.
      if (finished) bridge.begin(next, nextUp.inCorner());
      load(next, undefined, finished);
    },
    shuffling: () => shuffling(),
    pause: () => setPaused(true),
    back: () => ctx.back(),
  });

  // Shuffle on/off, shown while a show is being shuffled.
  const shuffleButton = button(t('watching.shuffle.on'), 'shuffle', 'player-button shuffle-toggle');
  shuffleButton.hidden = true;
  shuffleButton.addEventListener('click', () => {
    if (!shuffle) return;
    shuffle.on = !shuffle.on;
    // Back on: draw the next one again, from what's left.
    if (shuffle.on && request.episode) shufflePlayed(shuffle, request.title, request.episode.episode.id);
    toast(t(shuffle.on ? 'watching.shuffle.turned-on' : 'watching.shuffle.turned-off'));
    nextChanged();
  });

  // Lock controls (see lock.ts).
  const lock = createLock({
    view: () => view,
    changed: (on) => {
      if (on) {
        panels.close();
        cheat.close();
        hold.cancel();
      }
      showControls();
    },
  });
  const lockButton = button(withKey(t('playerplus.lock.action'), 'player.lock'), 'lock');
  lockButton.addEventListener('click', () => lock.lock());

  // The shortcut list (see cheat-sheet.ts).
  const cheat = createCheatSheet({ numberJump: () => numberJump, holdBoost: () => holdBoost, live: () => !!request.live });

  // The docked Episodes list, when Settings → Player says so (see episode-dock.ts).
  const dock = createEpisodeDock({
    request: () => request,
    // Like picking it from the Episodes panel: the best source, or the picker, per Settings.
    play: (season, episode) => void playTitle(request.title, { episode: { season, episode }, ctx }),
    showControls: () => showControls(),
  });

  const nextButton = button(withKey(t('player.controls.next-episode'), 'player.next'), 'next');
  nextButton.addEventListener('click', () => void nextUp.playNext());

  const fullscreenButton = button(withKey(t('player.controls.fullscreen'), 'player.fullscreen'));
  fullscreenButton.addEventListener('click', () => void setFullscreen(!fullscreen));

  // Picture in picture: the window shrinks to a corner, on top (see src-tauri/src/pip.rs).
  let pip = false;
  const pipButton = button(withKey(t('player.controls.pip'), 'player.pip'), 'pip');
  pipButton.addEventListener('click', () => void setPip(!pip));
  const pipPlay = button(withKey(t('player.controls.play-pause'), 'player.play-pause'), undefined, 'player-button pip-play');
  pipPlay.addEventListener('click', () => setPaused(!status.paused));
  const pipExpand = button(withKey(t('player.controls.pip-exit'), 'player.pip'), 'exitFullscreen');
  pipExpand.addEventListener('click', () => void setPip(false));
  const pipClose = button(t('player.controls.close'), 'close');
  pipClose.addEventListener('click', () => ctx.back());
  const pipControls = h('div', { class: 'pip-controls' }, h('div', { class: 'pip-top' }, pipExpand, pipClose), pipPlay);

  // "Continue on…" (Orbit Connect): goes on from the same moment on another device, which finds its own
  // sources, and stops here once it plays there (it keeps playing here if the other can't); this one then controls it. Only a catalog title: not a channel, a file from this PC, a link or a trailer.
  const continueOn = button(t('connect.continue-on'), 'cast');
  const handoffable = () => !request.live && !request.replay && !request.trailer && !request.local && !request.link;
  const syncContinueOn = attachPlayOn(continueOn, {
    available: handoffable,
    message: () => {
      if (!handoffable()) return null;
      const { audio, subtitle } = panels.selectedLanguages();
      const episode = request.episode && { season: request.episode.season, number: request.episode.episode.number };
      return playMessage(request.title, episode, { position: status.timePos ?? 0, audio: keyForCode(audio), subtitle: keyForCode(subtitle) });
    },
    sent: (device) => {
      // It plays there now. Closed here meanwhile (or it went on to something else): nothing left to stop.
      if (closed) return;
      // Where it got to is saved here as the player closes.
      ctx.back();
      openRemoteControl(device);
    },
  });

  const errorBox = h('div', { class: 'player-error', role: 'alert', hidden: true });

  const { episodes, tracks, speed, queue, source, info } = panels.buttons;
  const bar = h('div', { class: 'player-bar' }, transport.start, name, h('div', { class: 'player-bar-end' }, shuffleButton, nextButton, episodes, queue, tracks, speed, quality, lockButton, pipButton, fullscreenButton));
  const bottom = h('div', { class: 'player-bottom' }, transport.seekRow, bar);
  // The top of the player is the window's drag region (the title bar is hidden); double-click maximizes.
  const top = h('div', { class: 'player-top', 'data-tauri-drag-region': true }, back, h('div', { class: 'player-top-end' }, continueOn, source, info));
  const stage = h('div', { class: 'player-stage' });
  // What's playing, shown a few seconds into a pause (see pause-info.ts).
  const pauseInfo = createPauseInfo({
    setShown: (on) => {
      view.classList.toggle('pause-info-on', on);
      liftSubtitles();
    },
    // Not for the pause mpv makes at the end, where Next Up or the end screen takes over.
    canShow: () => started && status.paused && !status.eof && !nextUp.shown() && !panels.kind() && !cinema.isOpen() && !endScreen.shown() && !!errorBox.hidden,
    current: () => ({ title: request.title, episode: request.episode, secondsLeft: status.duration && status.timePos !== null ? status.duration - status.timePos : null, speed: status.speed ?? 1 }),
  });
  const ui = h('div', { class: 'player-ui' }, top, stage, dock.element, dock.tab, bottom, panels.element, nextUp.element, skip.element, pauseInfo.element, panels.infoHud, volumePopup.element, bubble.element, boostPill, pipControls, cheat.element);
  // The timeline, transport controls and times read left to right in every language, as in other
  // players (media time isn't mirrored right to left); so do the bars around them. The text over the
  // picture (panels, cards, prompts, the pause screen) follows the language.
  const view = h('div', { class: 'player', dir: 'ltr' }, loading, bridge.element, skip.fade, ui, lock.element, errorBox, nextUp.prompt);
  // Settings → Playback → Skipping: each kind's colour on the seek bar.
  void settings
    .get(SEGMENT_COLORS_KEY)
    .then((saved) => applySegmentColors(view, parseSegmentColors(saved)))
    .catch(() => {});
  for (const part of [loading, panels.element, nextUp.element, nextUp.prompt, skip.element, pauseInfo.element, cheat.element, lock.element, errorBox]) part.dir = isRtl() ? 'rtl' : 'ltr';
  // Tooltip labels are text only; key chips read the current remapping when shown.
  for (const [element, action, label] of [
    [transport.toggle, 'player.play-pause', ''],
    [transport.start.querySelector('button.skip-back'), 'player.seek-back', ''],
    [transport.start.querySelector('button.skip-ahead'), 'player.seek-forward', ''],
    [transport.start.querySelector('.player-volume button'), 'player.mute', ''],
    [tracks, 'player.tracks', t('playerplus.hub.title')],
    [lockButton, 'player.lock', t('playerplus.lock.action')],
    [nextButton, 'player.next', t('player.controls.next-episode')],
    [fullscreenButton, 'player.fullscreen', ''],
    [pipButton, 'player.pip', t('player.controls.pip')],
    [pipExpand, 'player.pip', t('player.controls.pip-exit')],
    [pipPlay, 'player.play-pause', ''],
  ] as const) {
    if (!(element instanceof HTMLElement)) continue;
    element.dataset.tooltipAction = action;
    if (label) element.setAttribute('aria-label', label);
  }
  // No key of their own: the same tooltip, without a key chip (Speed's label shows the speed; see panel-controller.ts).
  for (const [element, label] of [
    [episodes, t('player.controls.episodes')],
    [queue, t('watching.queue.title')],
    [source, t('player.controls.switch-source')],
    [info, t('player.controls.info')],
  ] as const) element.dataset.tooltipLabel = label;
  const tooltips = createPlayerTooltips(view);
  // Settings → Player: the preset and switches (see layout.ts).
  const layout = createPlayerLayout({ view, top, bottom, quality, name, nextButton, labelled: { episodes, tracks, speed, queue }, secondary: [lockButton, pipButton], request: () => request, upNext: () => upNext(), status: () => status, started: () => started });
  /** Leaves the player for `title`'s page (paused, in case Back returns to it). */
  const openDetails = (title: Title) => {
    setPaused(true);
    ctx.back();
    // Back is usually this title's page already; from anywhere else (or for a suggestion), its page opens.
    if (!document.querySelector(`.detail[data-title-id="${CSS.escape(title.id)}"]`)) ctx.open(createDetail(title, ctx));
  };
  // The Cinema preset's own parts (see cinema.ts); hidden in the other layouts.
  const cinema = createCinema({
    view,
    extras: [episodes, speed],
    request: () => request,
    status: () => status,
    episodesOpen: () => panels.kind() === 'episodes' || dock.isOpen(),
    toggleEpisodes: () => panels.toggle('episodes'),
    openPanel: (kind) => panels.toggle(kind),
    restart: () => void soft('player_seek', { seconds: 0 }, t('player.error.seek')),
    details: openDetails,
    back: () => ctx.back(),
    showControls: () => showControls(),
  });
  top.querySelector('.player-top-end')?.append(cinema.close);
  tracks.before(...cinema.icons);
  bottom.append(...cinema.bottomParts);
  // A film's end, in every layout (see end-screen.ts).
  const endScreen = createEndScreen({
    view,
    request: () => request,
    status: () => status,
    started: () => started,
    hasUpNext: () => !!upNext(),
    segments: () => skip.segments(),
    pip: () => pip,
    pause: () => setPaused(true),
    play: (title) => void playTitle(title, { ctx }),
    details: openDetails,
    back: () => ctx.back(),
    showControls: () => showControls(),
    focusFallback: () => transport.toggle.focus({ preventScroll: true }),
  });
  ui.after(endScreen.element);

  /** Slow addons' sources join the Source list once they arrive, while the same movie or episode plays. */
  function followLateSources(req: PlayRequest): void {
    req.moreSources
      ?.then((all) => {
        if (closed || request.title.id !== req.title.id || request.episode?.episode.id !== req.episode?.episode.id) return;
        request = { ...request, sources: mergeLateSources(request.source, request.sources, all), moreSources: undefined };
        panels.sourcesChanged();
      })
      .catch((err: unknown) => console.warn('Could not add the later sources', err));
  }

  /** Title-dependent parts: loading screen, name, episode and source buttons. */
  function renderRequest(): void {
    const { title, episode, source: playing } = request;
    // The controls (and their Back button) only show once playback starts, so loading needs its own way out.
    const cancel = h('button', { class: 'button glass small player-loading-cancel' }, t('player.next-up.cancel'));
    cancel.addEventListener('click', () => ctx.back());
    // The title's logo in place of its name, as on the banners (a channel keeps its name).
    const showName = (className: string) => (request.live ? h('span', { class: className }, title.name) : titleHeading('span', className, title));
    loading.replaceChildren(
      title.background ? artImage(title.background, 'player-loading-art', true) : '',
      h('div', { class: 'player-loading-shade', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'player-loading-text', role: 'status' },
        episode ? showName('eyebrow player-loading-show') : '',
        episode ? h('span', { class: 'player-loading-title' }, episode.episode.title) : showName('player-loading-title'),
        episode ? h('span', { class: 'player-loading-episode' }, t('player.loading.episode', { season: String(episode.season), episode: String(episode.episode.number) })) : '',
        h('span', { class: 'spinner', 'aria-hidden': 'true' }),
        h('span', { class: 'player-loading-note' }, t('player.loading.from', { addon: playing.addon })),
        // A rotating quip (Settings → Appearance → Little extras); it rests once the video is showing.
        request.live || request.trailer ? '' : quipLine('player-loading-quip', (line) => !!line.closest('.player.started')),
        cancel,
      ),
    );
    name.replaceChildren(
      request.live ? h('span', { class: 'live-badge' }, t('player.badge.live')) : request.replay ? h('span', { class: 'live-badge' }, t('player.badge.catch-up')) : request.trailer ? h('span', { class: 'live-badge' }, t('player.badge.trailer')) : '',
      h('span', { class: 'player-title' }, title.name),
      episode ? h('span', { class: 'player-episode' }, t('player.episode.short', { season: String(episode.season), episode: String(episode.episode.number) })) : '',
      // With the episode's name, when it has one: the Theatre layout shows it in place of the line above (layout.css).
      episode?.episode.title.trim() ? h('span', { class: 'player-episode-full' }, t('player.episode.short-title', { season: String(episode.season), episode: String(episode.episode.number), title: episode.episode.title })) : '',
      // The episode playing can be kept in My Library → Favourite episodes.
      episode && !request.live && !request.trailer ? favouriteHeart(title, episode.season, episode.episode, { className: 'player-fav', focusId: 'player-fav' }) : '',
    );
    view.classList.toggle('live', !!request.live);
    renderShuffleButton();
    renderNextButton();
    panels.renderRequest();
    layout.renderRequest();
    cinema.renderRequest();
    dock.renderRequest();
    tellRemote();
  }

  /** The episode line a phone and Windows' media flyout show, or null for a movie or channel. */
  function episodeLine(): string | null {
    const { episode } = request;
    if (!episode) return null;
    return episode.episode.title.trim()
      ? t('player.episode.short-title', { season: String(episode.season), episode: String(episode.episode.number), title: episode.episode.title })
      : t('player.episode.short', { season: String(episode.season), episode: String(episode.episode.number) });
  }

  /** The episode before the playing one, if any. */
  const previousEpisode = () => (request.episode ? episodeBefore(request.title, request.episode.season, request.episode.episode.number, request.episode.episode.id) : undefined);

  /** What Windows' media flyout shows (see media-session.ts); Rust only hears about changes. */
  function tellMedia(): void {
    if (closed) return;
    // On Live TV, next and previous change channel.
    const live = !!request.live;
    media.update({ title: request.title.name, detail: episodeLine(), poster: request.title.poster ?? null, local: unnamed(request), canNext: live || !!upNext(), canPrevious: live || !!previousEpisode() });
  }

  /** What a paired phone shows (see app/remote.ts). A file from this PC or a pasted link isn't named, as it isn't anywhere off this PC. */
  function tellRemote(): void {
    if (closed) return;
    tellMedia();
    const { title } = request;
    const detail = episodeLine();
    const hidden = unnamed(request);
    tellNowPlaying({
      title: request.link ? t('pastelink.source') : hidden ? t('remote.local-file') : title.name,
      detail: hidden ? null : detail,
      poster: hidden ? null : (title.poster ?? null),
      live: !!request.live,
      canNext: !!upNext(),
      maxVolume,
    });
  }

  /** Shuffle's toggle: shown while this show is being shuffled, pressed while it's on. */
  function renderShuffleButton(): void {
    const active = !!shuffle && shuffle.titleId === request.title.id;
    shuffleButton.hidden = !active;
    const label = t(shuffle?.on ? 'watching.shuffle.on' : 'watching.shuffle.off');
    shuffleButton.title = label;
    shuffleButton.setAttribute('aria-label', label);
    shuffleButton.setAttribute('aria-pressed', String(!!shuffle?.on));
  }

  /**
   * A show handed over without its episode list (a card's stored copy) gets it, so its progress moves
   * "up next" on as each episode is finished and Next Up knows what follows (episode-list.ts).
   */
  function fillEpisodes(of: PlayRequest): void {
    void fullShow(of).then((full) => {
      if (!full || closed || request.title.id !== full.id || request.title.seasons?.length) return;
      request = { ...request, title: full };
      // The Episodes button and the docked list were drawn without the list, so they hid themselves.
      panels.renderRequest();
      dock.renderRequest();
      nextChanged();
    });
  }

  /** What plays next may have changed (the queue, or shuffle turned on or off). */
  function nextChanged(): void {
    renderShuffleButton();
    renderNextButton();
    layout.renderNext();
    panels.queueChanged();
    nextUp.queueChanged();
    tellRemote();
  }

  /** The Next button: shown when something follows, named for what it is. */
  function renderNextButton(): void {
    const next = upNext();
    nextButton.hidden = !next;
    const label = next?.kind === 'queue' ? t('watching.queue.next-in-queue') : t('player.controls.next-episode');
    nextButton.title = withKey(label, 'player.next');
    nextButton.setAttribute('aria-label', label);
  }

  /** The maximized state decides whether the top bar is a drag region (see `topDragsWindow`). */
  function syncMaximized(): Promise<void> {
    return win
      .isMaximized()
      .then((on) => {
        if (!closed && on !== maximized) {
          maximized = on;
          render();
        }
      })
      .catch(() => {});
  }

  function render(): void {
    transport.render();
    panels.render();
    // Neither full screen nor a maximized window can be dragged out of: the top only moves a window that's neither.
    if (topDragsWindow({ fullscreen, maximized })) top.setAttribute('data-tauri-drag-region', 'true');
    else top.removeAttribute('data-tauri-drag-region');

    const label = qualityLabel(status.height);
    quality.hidden = !label;
    quality.textContent = label ?? '';

    showIcon(fullscreenButton, fullscreen ? 'exitFullscreen' : 'fullscreen');
    fullscreenButton.title = withKey(fullscreen ? t('player.controls.exit-fullscreen') : t('player.controls.fullscreen'), 'player.fullscreen');
    fullscreenButton.setAttribute('aria-label', fullscreen ? t('player.controls.exit-fullscreen-label') : t('player.controls.fullscreen-label'));

    showIcon(pipPlay, status.paused ? 'play' : 'pause', { filled: true });
    pipPlay.title = withKey(status.paused ? t('player.controls.play') : t('player.controls.pause'), 'player.play-pause');
    pipPlay.setAttribute('aria-label', status.paused ? t('player.controls.play-label') : t('player.controls.pause-label'));
    view.classList.toggle('buffering', started && status.buffering);
    view.classList.toggle('paused', status.paused);
    layout.render();
    cinema.render();
    // Panels, the pause screen and picture in picture change what covers the picture.
    liftSubtitles();
  }

  // ── Commands (mpv answers with events; nothing else is updated optimistically) ──
  const soft = (cmd: string, args: Record<string, unknown>, message: string) =>
    invoke(cmd, args).catch((err: unknown) => {
      console.error(message, err);
      if (!closed) toast(message);
    });
  const setPaused = (paused: boolean) => {
    // Until the file loads its status events are ignored (see load-events.ts): kept here, so a second press toggles back.
    if (awaitingFile) {
      status = { ...status, paused };
      pausePending = paused ? loads : 0;
    }
    // Play on the last frame starts over: unpausing there would play nothing.
    if (!paused && started && !awaitingFile && !request.live && playsFromStart(status)) {
      skip.userSeek({ to: 0 });
      void soft('player_seek', { seconds: 0 }, t('player.error.seek')).then(() => soft('player_set_paused', { paused }, t('player.error.pause')));
      return;
    }
    void soft('player_set_paused', { paused }, t('player.error.pause'));
  };
  const seekBy = (seconds: number) => {
    showControls();
    if (started && !request.live) bubble.add(seconds);
    skip.userSeek({ by: seconds });
    void soft('player_seek', { seconds, relative: true }, t('player.error.seek'));
  };
  function setVolumeBoost(level: VolumeBoostLevel): void {
    if (status.passthrough || closed) return;
    boostChange = boostChange.catch(() => {}).then(async () => {
      if (closed) return;
      await invoke('player_set_volume_boost_level', { level });
      if (closed) return;
      maxVolume = level;
      transport.setVolumeMax(level);
      panels.refresh();
      // A preset only moves the ceiling: the volume stays, and comes down only to a lower ceiling.
      if ((status.volume ?? 100) > level) setVolume(level);
      // Off is the switch alone: the last preset stays saved, so turning the switch back on in Settings brings it back.
      if (boostKey && level > 100) await settings.set(boostKey, level);
      await settings.set(VOLUME_BOOST_KEY, level > 100);
    }).catch(() => { if (!closed) toast(t('player.error.volume-boost')); });
  }
  function setVolume(level: number): void {
    // The sound passes through to a receiver: Orbit's volume can't change it (the slider is off too).
    if (status.passthrough) return toast(t('player.passthrough.volume'));
    const clamped = clampVolume(level, maxVolume);
    void soft('player_set_volume', { volume: clamped }, t('player.error.volume'));
    if (status.muted && clamped > 0) void soft('player_set_muted', { muted: false }, t('player.error.unmute'));
    saveVolume(clamped, clamped === 0 ? status.muted : false);
  }
  function setMuted(muted: boolean): void {
    void soft('player_set_muted', { muted }, t('player.error.mute'));
    saveVolume(status.volume ?? 100, muted);
  }
  function saveVolume(level: number, muted: boolean): void {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void settings.set(VOLUME_KEY, { volume: level, muted }).catch(() => {}), 500);
  }

  async function setPip(on: boolean): Promise<void> {
    if (on === pip) return;
    if (on) panels.close();
    const info = await invoke<Record<string, string>>('player_info').catch(() => ({}) as Record<string, string>);
    const aspect = Number(info.width) / Number(info.height);
    // Closed meanwhile (Back right after the key): close() saw no picture in picture to undo.
    if (closed) return;
    try {
      await invoke('window_pip', { on, aspect: Number.isFinite(aspect) ? aspect : 16 / 9 });
    } catch (err) {
      return toast(t('player.error.window', { error: errorText(err) }));
    }
    // Closed while the window was shrinking: it goes back, or browsing stays in a small window on top.
    if (closed) {
      if (on) void invoke('window_pip', { on: false, aspect: 16 / 9 }).catch(() => {});
      return;
    }
    pip = on;
    // Entering also leaves full screen.
    if (on) fullscreen = false;
    view.classList.toggle('pip', on);
    pipButton.title = withKey(on ? t('player.controls.pip-exit') : t('player.controls.pip'), 'player.pip');
    // A film's end screen waits for picture in picture to end; at the very end no more status comes to show it.
    if (!on) endScreen.update();
    render();
  }

  async function setFullscreen(on: boolean): Promise<void> {
    // From picture in picture (its key), the window first goes back to how it was: full screen over
    // the small always-on-top window would keep its size limits and show only its controls.
    if (on && pip) {
      await setPip(false);
      if (pip) return;
    }
    await win.setFullscreen(on).catch((err: unknown) => console.error('Could not change full screen', err));
    // Closed while the window was going full screen: close() saw none to leave, so browsing would stay in it.
    if (closed) {
      if (on && !keepFullscreen) void win.setFullscreen(false).catch(() => {});
      return;
    }
    fullscreen = await win.isFullscreen().catch(() => on);
    render();
  }

  /**
   * `reason`: mpv's error text, or why opening failed; worded for the person, never shown raw.
   * "Try again" opens the same source from where it got to; "Copy details" copies what went
   * wrong for a bug report, redacted by Rust (no addresses, keys or paths).
   */
  function fail(reason: unknown): void {
    // Offline, the source isn't to blame: none is marked failed or moved past, and the error waits for the connection.
    if (isOffline()) {
      failover.stop();
      return showError(reason);
    }
    if (failover.recover('failed')) return;
    showError(reason);
  }

  /** The error over the player, with Try again, Another source, Copy details and Back (see `fail`). */
  function showError(reason: unknown): void {
    errorAside = undefined;
    window.removeEventListener('online', retryOnline);
    // mpv is still opening a slow source: should it start after all, it plays (see 'ready').
    slowShown = reason === SLOW_ERROR;
    // Before Android's player stops: where it got to, to try again from there.
    const from = place.at();
    // Android's player screen steps aside, so the message and its buttons are seen.
    if (isAndroid) void invoke('player_stop').catch(() => {});
    bridge.cancel();
    loading.classList.add('failed');
    errorBox.hidden = false;
    const others = request.sources.filter((s) => s.id !== request.source.id);
    const retreat = h('button', { class: 'button large glass' }, t('player.error.back'));
    retreat.addEventListener('click', () => ctx.back());
    const retry = h('button', { class: 'button large primary' }, from && !request.live ? t('pstream.error.retry-at', { time: formatTime(from) }) : t('pstream.error.retry'));
    // 0 rather than undefined, so trying again doesn't ask about resuming.
    retry.addEventListener('click', () => {
      // Tried again by hand: a live channel gets its reconnects back.
      liveReconnect.reset();
      load(request, request.live ? undefined : (from ?? 0));
    });
    const another = h('button', { class: 'button large glass', hidden: !others.length }, t('player.error.another'));
    another.addEventListener('click', () => {
      errorAside = { reason, load: loads };
      errorBox.hidden = true;
      loading.classList.remove('failed');
      panels.toggle('source');
    });
    const copy = h('button', { class: 'button large glass' }, t('pstream.error.copy'));
    copy.addEventListener('click', () => void copyDetails(reason, from));
    // Offline, its line says it loads again by itself when the connection is back: it does, from where it got to.
    const offline = isOffline();
    if (offline) {
      retryOnline = () => {
        if (!closed && !errorBox.hidden) retry.click();
      };
      window.addEventListener('online', retryOnline, { once: true });
    }
    errorBox.replaceChildren(
      h('span', { class: 'player-error-title' }, offline ? t('states.offline.title') : t('player.error.title')),
      h('p', { class: 'muted' }, playbackText(reason)),
      h('div', { class: 'hero-actions' }, retry, another, copy, retreat),
    );
    retry.focus();
  }

  /** The slow (or stalled) error goes, also when it was put aside behind the source list (closing that list must not bring it back over a playing video). */
  function clearSlowError(): void {
    errorBox.hidden = true;
    loading.classList.remove('failed');
    errorAside = undefined;
    slowShown = false;
  }

  /** The error, the source's addon and quality, what kind of source and where it stopped: never its address (Rust redacts what's left). */
  async function copyDetails(reason: unknown, at: number | undefined): Promise<void> {
    const { source: from, live, local } = request;
    const kind = live ? 'live' : local ? 'local file' : isTorrent(from.url) ? 'torrent' : from.url.startsWith('orbit-download:') ? 'download' : /^https?:/i.test(from.url) ? 'web' : 'other';
    const text = [
      `Orbit playback error (${isAndroid ? 'Android' : 'desktop'})`,
      `Error: ${describeError(reason)}`,
      `Source: ${[from.addon, from.label].filter(Boolean).join(' · ')} (${kind})`,
      at !== undefined ? `Position: ${formatTime(at)}${status.duration ? ` / ${formatTime(status.duration)}` : ''}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(await invoke<string>('diagnostics_redact', { text }));
      toast(t('pstream.error.copied'));
    } catch {
      toast(t('pstream.error.copy-failed'));
    }
  }

  /**
   * mpv's audio and subtitle languages for `next`. With "Original language first" its own language
   * (TMDB's) leads the audio list; the lookup is brief (cached from its page, or one TMDB request)
   * and the file waits for it, since mpv picks the audio track as the file opens.
   */
  function applyLanguages(next: PlayRequest): Promise<unknown> {
    // mpv's languages are the player's, not the file's: a lookup for a title already left behind (still
    // waiting on TMDB after the next title's came back) mustn't set them over the newer title's.
    const turn = ++languageTurn;
    const { forcedOnly, original } = languagePrefs;
    // Continued from another device (Orbit Connect): the languages it was playing with lead this profile's.
    const sent = next.languages;
    languagesSent = !!sent;
    const audio = sent?.audio || languagePrefs.audio;
    const subtitles = sent?.subtitle ? [sent.subtitle, ...languagePrefs.subtitles.filter((key) => key !== sent.subtitle)] : languagePrefs.subtitles;
    const own = original && !next.live && !next.local && !next.link && !next.trailer ? withTimeout(originalLanguage(next.title), ORIGINAL_LANGUAGE_WAIT_MS).catch(() => null) : Promise.resolve(null);
    return own.then((language) => closed || turn !== languageTurn || soft('player_set_languages', { audio: audioLanguages(language, audio), subtitle: mpvLanguages(subtitles), forcedOnly }, t('player.error.languages')));
  }

  // ── Watch history ──
  /** Saves how far in this movie or episode is; throttled unless `force`. `finished`: handed off to what's next (see `leftAt`). */
  function saveProgress(force = false, finished = false): void {
    const { timePos, duration } = status;
    if (!started || placeholder || timePos === null || !duration || request.live || request.replay || request.trailer || request.link) return;
    if (!force && Date.now() - lastSave < SAVE_EVERY_MS) return;
    lastSave = Date.now();
    recordProgress(request.title, request.episode, leftAt(timePos, duration, finished), duration);
  }
  /** Keeps the person's own server (Jellyfin, Plex) up to date on a video played from it. */
  const serverReports = createOwnServerReporter();

  /** Whether this show is being shuffled with shuffle on. */
  const shuffling = () => !!shuffle?.on && shuffle.titleId === request.title.id && !!request.episode;
  /** The episode after the current one (or the shuffle's draw), if this is a series and there is one. */
  const following = () => (shuffling() ? shuffle?.next : request.episode ? episodeAfter(request.title, request.episode.season, request.episode.episode.number, request.episode.episode.id) : undefined);

  /** Starts, keeps or ends the shuffle for `next`, and draws what follows a newly started episode. */
  function updateShuffle(next: PlayRequest): void {
    if (next.shuffle && next.episode) {
      if (shuffle?.titleId !== next.title.id) shuffle = startShuffle(next.title.id);
      shuffle.on = true;
    } else if (shuffle && shuffle.titleId !== next.title.id) {
      // Something else plays (e.g. from the queue): the shuffle ends.
      shuffle = undefined;
    }
    const id = next.episode?.episode.id;
    if (shuffle?.on && id && shuffle.titleId === next.title.id && shuffleDrawnFor !== id) {
      shuffleDrawnFor = id;
      shufflePlayed(shuffle, next.title, id);
    }
  }
  /** What plays next: the queue's first item, else the next episode (see next-up.ts). */
  const upNext = () => chooseUpNext(queueHead(), following(), request);

  /** Starts `next` (a new source, or another episode), optionally at a position. `finished`: Next Up or the credits handed off to it. */
  function load(next: PlayRequest, start?: number, finished = false): void {
    // The content limit, for every file: a queued title Next Up starts, or another channel, as much as one opened from a page.
    if (!mayPlay(next, () => closed || load(next, start, finished))) {
      // A hand-off's still would otherwise cover the player (and the limit's prompt) until it gives up on its own.
      bridge.cancel();
      nextUp.refused();
      return;
    }
    // A position sent from another device counts once: a retry or the next episode starts as usual.
    if (next.start !== undefined) {
      start ??= next.start;
      next = { ...next, start: undefined };
    }
    const sameTitle = next.title.id === request.title.id && next.episode?.episode.id === request.episode?.episode.id;
    // Leaving a movie or episode for another: remember where it got to.
    if (!sameTitle) saveProgress(true, leavesFinished(finished, endScreen.shown(), creditsStarted(skip.segments(), status.timePos)));
    // Speed carries across a title's episodes and sources, not into another title (see speed.ts).
    if (next.title.id !== request.title.id) void soft('player_set_speed', { speed: 1 }, t('player.error.speed'));
    // Another title has its own original language, and isn't the one continued from another device.
    if (languagesChange({ newTitle: next.title.id !== request.title.id, original: languagePrefs.original, sentBefore: languagesSent, sentNow: !!next.languages })) languagesApplied = applyLanguages(next);
    serverReports.newFile();
    nextUp.reset(sameTitle);
    endScreen.newFile();
    updateShuffle(next);
    request = next;
    fillEpisodes(next);
    syncContinueOn();
    followLateSources(next);
    const id = ++loads;
    // Forget the previous file's position, and ignore its late events until the new one loads.
    // `player_open` unpauses, so a pause left by the previous file's end isn't this one's.
    status = { ...status, timePos: null, duration: null, cacheTime: null, height: null, buffering: true, eof: false, paused: false };
    awaitingFile = true;
    pausePending = 0;
    promptPaused = false;
    heldByPrompt = false;
    pauseInfo.hide();
    started = false;
    chapters = [];
    lengthChecked = false;
    placeholder = false;
    view.classList.remove('started');
    // A resume question still up for the file before goes with it (renderRequest replaces it): left
    // marked as asking, the player's keys would stay off for this one.
    loading.classList.remove('failed', 'asking');
    errorBox.hidden = true;
    panels.close();
    renderRequest();
    skip.newFile();
    panels.newFile();
    previews.stop();
    transport.setPreviews(null);
    if (!sameTitle) {
      sleep.newVideo();
      panels.newTitle();
      skip.newTitle(request.title, request.episode);
    }
    stopTorrentNote();
    failover.opening();
    // A torrent plays from a local address once Rust has started it; a web source plays directly.
    let url: Promise<string> = Promise.resolve(request.source.url);
    if (isTorrent(request.source.url)) {
      torrentRunning = true;
      const note = loading.querySelector('.player-loading-note');
      // A file picked by hand plays as picked; otherwise Rust looks for this episode among a pack's files.
      const torrent = startTorrent(request.source.url, request.source.fileChosen ? undefined : episodeHint(request.title, request.episode), (text) => {
        if (note) note.textContent = text;
      });
      stopTorrentNote = torrent.stop;
      url = torrent.url;
    } else if (torrentRunning) {
      torrentRunning = false;
      stopTorrent();
    }
    const open = (from: number | undefined) => {
      // Now, not once the address is known: a torrent can fail before then.
      place.asked(from);
      void Promise.all([savedVolume(maxVolume), url, limitApplied, languagesApplied])
        .then(([saved, address]) => {
          if (closed || id !== loads) return;
          // Live channels often flag their closed captions as default; without a
          // preferred subtitle language they start off (C turns them on).
          const subtitles = (request.live || request.replay) && !panels.subtitlePreference() ? { subtitles: false } : {};
          // The slow-source clock starts now, not while the resume prompt waited for an answer.
          failover.waiting();
          // A failure to open counts only while this is still the load wanted (not after surfing on).
          // An addon's headers go with its own web address only, not with a torrent's local one.
          const headers = request.source.headers && !isTorrent(request.source.url) ? { streamHeaders: request.source.headers } : {};
          void invoke('player_open', { url: address, load: id, ...headers, ...(from ? { start: from } : {}), ...(saved ? { volume: saved.volume, muted: saved.muted } : {}), ...subtitles, ...(request.live ? { live: true } : {}) })
            .then(() => {
              // Paused before this file was asked for (a torrent starting, say): player_open just unpaused it.
              if (!closed && id === loads && pausePending === id) void soft('player_set_paused', { paused: true }, t('player.error.pause'));
            })
            .catch((err: unknown) => {
              if (!closed && id === loads) fail(err);
            });
        })
        .catch((err: unknown) => {
          stopTorrentNote();
          if (!closed && id === loads) fail(err);
        });
    };
    // Switching source passes the position; otherwise pick up where it was left off, per Settings.
    // Where the person's own server (Jellyfin, Plex) says they stopped, when that's later than Orbit's history or Orbit has none.
    const ownRow = watchRecord(next.title.id)?.rows.find((r) => r.videoId === (next.episode?.episode.id ?? next.title.id));
    const resume =
      start === undefined && resumeMode !== 'start-over' && !next.live && !next.replay && !next.trailer && !next.link
        ? resumeFrom({ position: resumePosition(next.title, next.episode?.episode), updatedAt: ownRow?.updatedAt }, next.source)
        : 0;
    if (resume > 0 && resumeMode === 'ask') {
      // The file before keeps playing behind the prompt otherwise. Not `setPaused`: that would count as pausing the new one.
      if (id > 1) {
        promptPaused = true;
        void invoke('player_set_paused', { paused: true }).catch(() => {});
      }
      return ask(resume, open);
    }
    open(start ?? (resume > 0 ? resume : undefined));
  }

  /**
   * Seek-bar previews, for web streams only: a live channel has no timeline,
   * and a torrent would fetch pieces from all over the file.
   */
  function startPreviews(): void {
    const { url } = request.source;
    if (!previewsOn || request.live || !/^https?:\/\//i.test(url)) return;
    const id = loads;
    void invoke<Record<string, string>>('player_info')
      // Closed or moved on meanwhile: its stop has been sent, and a start now would open a preview mpv nothing stops.
      .then((info) => (id === loads && !closed ? previews.start(url, Number(info.width) || 1920, Number(info.height) || 1080) : Promise.reject(new Error('moved on'))))
      .then(() => {
        if (id === loads && !closed) transport.setPreviews(previews);
      })
      .catch(() => {});
  }

  /** Asks on the loading screen whether to resume, then opens the file. */
  function ask(position: number, open: (start: number | undefined) => void): void {
    const text = loading.querySelector('.player-loading-text');
    bridge.cancel();
    loading.classList.add('asking');
    const prompt = resumePrompt(position, (from) => {
      loading.classList.remove('asking');
      prompt.remove();
      open(from);
    });
    text?.append(prompt);
    prompt.querySelector('button')?.focus();
  }

  // ── Showing and hiding the controls ──
  function showControls(): void {
    view.classList.remove('idle');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideIfIdle, IDLE_MS);
    liftSubtitles();
  }
  function hideIfIdle(): void {
    // Stay up while paused, buffering, seeking, a panel is open, or the pointer rests on the controls.
    if (status.paused || status.buffering || transport.dragging() || panels.kind() || cinema.isOpen() || endScreen.shown() || cheat.isOpen() || bottom.matches(':hover') || top.matches(':hover') || (dock.isOpen() && dock.element.matches(':hover, :focus-within'))) return showControls();
    view.classList.add('idle');
    tooltips.hide();
    liftSubtitles();
  }
  /**
   * Subtitles clear the control bar while it shows (see subtitle-lift.ts). Not when nothing
   * covers the picture (hidden controls, picture in picture, the pause screen), nor while the
   * Subtitle style view is open, where the position being picked should show as it is.
   */
  function liftSubtitles(): void {
    if (isAndroid) return;
    const covers = started && !closed && !pip && !view.classList.contains('idle') && !view.classList.contains('pause-info-on') && panels.kind() !== 'subtitle-style';
    subtitleLift.want(covers ? liftFor(window.innerHeight - bottom.getBoundingClientRect().top, window.innerHeight) : 0);
  }
  /** The mouse or keyboard was used: controls up, and the pause screen waits again. */
  function onInput(): void {
    showControls();
    pauseInfo.wake(status.paused);
    layout.wake();
  }
  view.addEventListener('pointermove', onInput);
  view.addEventListener('pointerdown', onInput);
  // A key or click (not just moving the mouse) shows someone's watching: see next-up-controller.ts.
  const interacted = () => nextUp.interacted();
  view.addEventListener('pointerdown', interacted);
  // A mouse click on a control leaves no keyboard position behind: arrows go
  // back to seeking, volume or (on a live channel) surfing, rather than moving
  // between the controls the pointer happened to press. Keys and remotes
  // activate with detail 0 and keep their place; a click that moved focus on
  // (into a panel, the channel list) is left alone.
  view.addEventListener('click', (event) => {
    const active = document.activeElement;
    if (event.detail > 0 && active instanceof HTMLElement && (bar.contains(active) || top.contains(active))) active.blur();
  });
  document.addEventListener('keydown', interacted, { capture: true });
  cleanups.push(() => document.removeEventListener('keydown', interacted, { capture: true }));

  /** Double-clicked on a side of the picture with that setting on: jumps that way (true), or false for full screen. */
  function sideJump(event: MouseEvent): boolean {
    if (!doubleClickSeek || pip || !started || request.live) return false;
    const rect = stage.getBoundingClientRect();
    const side = pictureSide(event.clientX, rect.left, rect.width);
    if (side) seekBy(side * seekStep);
    return side !== 0;
  }
  // Held on the picture, the mouse plays at 2× until let go, as the play/pause key does (see hold-speed.ts).
  const MOUSE_HOLD = 'pointer';
  /** The press that just ended sped playback up: its click doesn't pause. */
  let heldClick = false;
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.pointerType !== 'mouse' || pip || !started || panels.kind() || lock.locked()) return;
    hold.press(MOUSE_HOLD, false);
  });
  stage.addEventListener('pointerup', (event) => {
    if (event.button !== 0) return;
    heldClick = hold.boosted();
    hold.release(MOUSE_HOLD);
  });
  for (const type of ['pointerleave', 'pointercancel'] as const) stage.addEventListener(type, () => hold.cancel(MOUSE_HOLD));
  // A click on the picture pauses or plays (or closes a panel); a double-click toggles full screen.
  stage.addEventListener('click', (event) => {
    if (heldClick) return void (heldClick = false);
    if (panels.kind()) return panels.close();
    window.clearTimeout(clickTimer);
    // Clicking on after a double-click on a side keeps jumping, rather than pausing.
    if (event.detail > 2 && sideJump(event)) return;
    clickTimer = window.setTimeout(() => setPaused(!status.paused), CLICK_DELAY_MS);
  });
  // The mouse wheel over the picture changes the volume, a step per notch.
  // Touchpads send many small deltas, so they're added up into whole steps; the
  // level is tracked here because mpv's report of the last step may not be back yet.
  let wheelDelta = 0;
  let wheelLevel: number | null = null;
  let wheelTimer = 0;
  stage.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      wheelDelta += event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : event.deltaY * 100;
      const steps = Math.trunc(wheelDelta / 100);
      if (!steps) return;
      wheelDelta -= steps * 100;
      wheelLevel = clampVolume((wheelLevel ?? status.volume ?? 100) - steps * VOLUME_STEP, maxVolume);
      setVolume(wheelLevel);
      if (!(volumePopupOn && view.classList.contains('idle'))) showControls();
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => (wheelLevel = null), 400);
    },
    { passive: false },
  );
  stage.addEventListener('dblclick', (event) => {
    window.clearTimeout(clickTimer);
    if (pip) void setPip(false);
    else if (!sideJump(event)) void setFullscreen(!fullscreen);
  });
  // In picture in picture the video moves the window: dragging (not clicking) starts a move.
  stage.addEventListener('pointerdown', (down) => {
    if (!pip || down.button !== 0) return;
    const move = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) < 5) return;
      stage.removeEventListener('pointermove', move);
      window.clearTimeout(clickTimer);
      void win.startDragging().catch(() => {});
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', () => stage.removeEventListener('pointermove', move), { once: true });
  });

  // Locked, nothing else sees a key (see lock.ts): its handler goes first of all.
  document.addEventListener('keydown', lock.onKey, { capture: true });
  cleanups.push(() => document.removeEventListener('keydown', lock.onKey, { capture: true }), () => lock.dispose());

  // A media key pressed with Orbit focused may also arrive as a media-controls button (see media-session.ts):
  // whichever comes second is the same press, and is dropped. Before the player's own keys see it.
  const onMediaKey = (event: KeyboardEvent) => {
    const group = event.isTrusted ? mediaGroup(event.key) : null;
    if (!group || mediaGate.pass(group, 'key')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.addEventListener('keydown', onMediaKey, { capture: true });
  cleanups.push(() => document.removeEventListener('keydown', onMediaKey, { capture: true }));
  // The flyout's buttons and media keys pressed elsewhere: run as the same keys would be here (as Android's remote keys are).
  void listen<unknown>(MEDIA_BUTTON_EVENT, (e) => {
    const button = e.payload;
    if (closed || !isMediaButton(button)) return;
    const group = mediaGroup(BUTTON_KEYS[button]);
    if (group && !mediaGate.pass(group, 'system')) return;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: BUTTON_KEYS[button], bubbles: true, cancelable: true }));
  }).then((fn) => (closed ? fn() : cleanups.push(fn)));
  // Their seeks (Linux): through the lock and Live TV's rules, as the player's own seeks.
  void listen<unknown>(MEDIA_SEEK_EVENT, (e) => {
    if (closed) return;
    runMediaSeek(e.payload, {
      locked: lock.locked(),
      live: !!request.live,
      seekBy,
      seekTo: (seconds) => {
        skip.userSeek({ to: seconds });
        void soft('player_seek', { seconds }, t('player.error.seek'));
      },
    });
  }).then((fn) => (closed ? fn() : cleanups.push(fn)));

  // Live TV: Up/Down change channel, E lists them (see channel-surf.ts). Created first, so its keys come before keys.ts's.
  const surf = createChannelSurf({
    view,
    bar,
    panel: panels.element,
    request: () => request,
    load: (next) => load(next),
    closed: () => closed,
    asking: () => loading.classList.contains('asking'),
    inControls: (el) => !!el && (bar.contains(el) || top.contains(el) || panels.element.contains(el)),
    closePanel: () => panels.close(),
    showControls: onInput,
  });
  ui.append(...surf.elements);
  cleanups.push(surf.dispose);

  // ── Keyboard (see keys.ts) ──
  const onKey = playerKeyHandler({
    view,
    panel: panels.element,
    // The error's buttons too: arrows move between "Try another source" and "Back", Space presses one.
    regions: [dock.element, cheat.element, ...cinema.regions, endScreen.element, errorBox],
    // Next Up's and Skip's buttons too: focused (the credits takeover puts it on Play), arrows reach the other button or the bar rather than seek.
    controls: [dock.tab, ...cinema.controls, nextUp.element, skip.element],
    bar,
    top,
    volume: transport.volume,
    toggle: transport.toggle,
    timeline: transport.seekRow,
    closed: () => closed,
    asking: () => loading.classList.contains('asking') || nextUp.asking(),
    panelOpen: () => !!panels.kind(),
    fullscreen: () => fullscreen,
    pip: () => pip,
    togglePip: () => void setPip(!pip),
    status: () => status,
    seekStep: () => seekStep,
    showControls: onInput,
    setPaused,
    playPause: (key) => hold.press(key),
    seekBy,
    fineSeek: (direction) => {
      if (!started || request.live) return;
      // Paused, mpv steps one frame and stays paused there; it reports the new position itself.
      if (status.paused) void soft('player_frame_step', { back: direction < 0 }, t('player.error.seek'));
      else seekBy(direction * FINE_SEEK_SECONDS);
    },
    stepSpeed: (direction) => {
      // A live channel plays at the broadcast's pace; holding for 2× owns the speed while held.
      if (!started || request.live || hold.holding()) return;
      showControls();
      void soft('player_set_speed', { speed: presetStep(status.speed ?? 1, direction) }, t('player.error.speed'));
    },
    jumpTo: (fraction) => {
      if (!numberJump || !started || request.live || !status.duration) return false;
      // Not `skip.userSeek`: a jump to a tenth of the way isn't skipping an intro, and in a short
      // episode "1" from the start is short enough to be learned as one (see learned-skips.ts).
      void soft('player_seek', { seconds: fraction * status.duration }, t('player.error.seek'));
      return true;
    },
    setVolume,
    setMuted,
    volumePopup: () => volumePopupOn && view.classList.contains('idle'),
    controlsHidden: () => view.classList.contains('idle'),
    setFullscreen: (on) => void setFullscreen(on),
    playNext: () => void nextUp.playNext(),
    playPrevious: () => {
      const previous = previousEpisode();
      // Like picking it from the Episodes panel: the best source, or the picker, per Settings.
      if (previous) void playTitle(request.title, { episode: previous, ctx });
    },
    screenshot: () =>
      void invoke<string>('player_screenshot')
        .then(() => toast(t('player.screenshot.saved')))
        .catch((err: unknown) => toast(errorText(err))),
    nudgeDelay: (kind, direction) => {
      adjust.nudge(kind, direction);
      if (panels.kind() === 'timing' || panels.kind() === 'hub') panels.redraw();
    },
    cycleFit: () => {
      adjust.cycleFit();
      if (panels.kind() === 'picture') panels.redraw();
    },
    chapter: (step) => {
      if (canStepChapter(chapters, started)) void soft('player_chapter', { step }, t('player.error.chapter'));
    },
    whatDidTheySay: () => panels.whatDidTheySay(),
    tryAnotherSubtitle: () => panels.tryAnotherSubtitle(),
    openTracks: () => panels.toggle('hub'),
    openTranscript: () => panels.toggle('transcript'),
    // mpv flips its own subtitle visibility and says which way it went. With no subtitle selected, there's
    // nothing to show or hide: one is picked, or, with none to pick, the Subtitles view opens.
    toggleSubtitles: () => {
      if (!panels.subtitleSelected()) {
        if (panels.showSomeSubtitle()) return toast(t('player.subtitles.shown'));
        toast(t('player.tracks.none-to-show'));
        return panels.open('subtitles');
      }
      void invoke<boolean>('player_toggle_subtitles')
        .then((shown) => toast(t(shown ? 'player.subtitles.shown' : 'player.subtitles.hidden')))
        .catch((err: unknown) => {
          console.error(t('player.error.subtitles-toggle'), err);
          toast(t('player.error.subtitles-toggle'));
        });
    },
    dismiss: () => {
      if (cheat.isOpen()) {
        cheat.close();
        return true;
      }
      return endScreen.dismiss() || cinema.dismiss() || dock.dismiss() || surf.dismiss();
    },
    panelBack: () => panels.keyBack(),
    lock: () => lock.lock(),
    toggleShortcuts: (key) => cheat.toggle(key),
  });
  document.addEventListener('keydown', onKey, { capture: true });
  cleanups.push(() => document.removeEventListener('keydown', onKey, { capture: true }));

  // A paired phone works the same controls (see app/remote.ts).
  cleanups.push(
    attachRemotePlayer({
      setPaused,
      seekBy,
      seekTo: (seconds) => {
        if (request.live) return;
        skip.userSeek({ to: seconds });
        void soft('player_seek', { seconds }, t('player.error.seek'));
      },
      setVolume,
      setMuted,
      playNext: () => void nextUp.playNext(),
      subtitle: (id) => panels.chooseSubtitleTrack(id),
      audio: (id) => panels.chooseAudio(id),
      stop: () => ctx.back(),
    }),
  );
  // Letting go of a held key: play/pause's 2× ends (a short press pauses), the shortcut list held open closes.
  const onKeyUp = (event: KeyboardEvent) => {
    if (closed || lock.locked()) return;
    hold.release(event.key);
    cheat.release(event.code);
  };
  const onBlur = () => hold.cancel();
  document.addEventListener('keyup', onKeyUp, { capture: true });
  window.addEventListener('blur', onBlur);
  cleanups.push(() => document.removeEventListener('keyup', onKeyUp, { capture: true }), () => window.removeEventListener('blur', onBlur));

  // Full screen can also change from outside (e.g. Windows shortcuts). Android's Activity is always full screen.
  if (!isAndroid) {
    // Already in full screen (kept from the last player, Settings → Playback): Esc and the button start from there.
    void win
      .isFullscreen()
      .then((on) => {
        fullscreenBefore = on;
        if (!closed && on !== fullscreen) {
          fullscreen = on;
          render();
        }
      })
      .catch(() => {});
    void syncMaximized();
    void win
      .onResized(() => {
        // Minimised while playing: pause (Settings → Playback).
        if (pauseOnMinimize && !status.paused) {
          void win.isMinimized().then((minimized) => {
            if (minimized && !closed) setPaused(true);
          });
        }
        void win.isFullscreen().then((on) => {
          if (on !== fullscreen) {
            fullscreen = on;
            render();
          }
        });
        void syncMaximized();
      })
      .then((fn) => (closed ? fn() : cleanups.push(fn)));
  }

  function onEvent(e: PlayerEvent): void {
    if (closed || !acceptsEvent(e.kind, e.load, loads, awaitingFile)) return;
    if (e.kind === 'loaded') awaitingFile = false;
    switch (e.kind) {
      case 'status': {
        // The hub, Speed and Sound views show the speed, and the sound mode (which passthrough turns off).
        const speedPanelChanged = e.speed !== status.speed || e.passthrough !== status.passthrough || e.height !== status.height;
        // However it changed (keys, the Speed view, a phone), the new speed shows for a moment.
        if (started && e.speed !== null && status.speed !== null && Math.abs(e.speed - status.speed) > 0.005) flashSpeed(e.speed);
        const pausedNow = e.paused && !status.paused;
        // With the controls hidden, a new volume shows in the pop-up (when on); the first report is just the starting level.
        const volumeChanged = status.volume !== null && (e.volume !== status.volume || e.muted !== status.muted);
        if (volumePopupOn && started && volumeChanged && e.volume !== null && view.classList.contains('idle')) volumePopup.show(e.volume, e.muted, maxVolume);
        status = { timePos: e.timePos, duration: e.duration, paused: e.paused, buffering: e.buffering, volume: e.volume, muted: e.muted, cacheTime: e.cacheTime, height: e.height, speed: e.speed, passthrough: e.passthrough, eof: e.eof };
        if (started) place.played(status.timePos);
        // Before any progress is saved: a placeholder's few seconds would count as watching it.
        if (!lengthChecked && e.duration) {
          lengthChecked = true;
          placeholder = looksLikePlaceholder(request, e.duration);
          if (placeholder && failover.recover('placeholder')) break;
          // With nowhere to move to, the clip stops here with the error rather than playing out.
          if (placeholder) {
            setPaused(true);
            showError(PLACEHOLDER_ERROR);
          }
        }
        // A placeholder's status is no movie's or episode's: nothing is saved, offered next or counted down.
        if (placeholder) break;
        if (speedPanelChanged && (panels.kind() === 'speed' || panels.kind() === 'sound' || panels.kind() === 'hub')) panels.redraw();
        // The pause mpv makes at the end stays in colour, under Next Up or the end screen.
        grayPause.paused(started && status.paused && !status.eof);
        saveProgress(pausedNow);
        if (started && !placeholder) serverReports.status(request.source.url, status.timePos, status.paused, status.duration);
        nextUp.update();
        endScreen.update();
        skip.update();
        sleep.check();
        // Pausing watch history or a content limit can change while playing: the flyout follows.
        tellMedia();
        // A file from this PC or a pasted link isn't shared, not even by name. Nor is the end: Rust reports
        // the status (eof) right after "ended" cleared it, and it would come back as "Paused".
        if (request.local || request.link) presence.hide();
        else if (status.eof) presence.clear();
        else presence.update(request.title, request.episode, status, request.live ? t('player.presence.live-tv') : request.replay ? t('player.badge.catch-up') : request.trailer ? t('player.badge.trailer') : undefined);
        failover.status(started, status.buffering, status.paused);
        // Called stalled, then buffered through after all (mpv is the source of truth): its error goes.
        if (slowShown && started && !status.buffering) clearSlowError();
        panels.tick(status.timePos);
        if (pausedNow) {
          if (!promptPaused) pauseInfo.arm();
        } else if (!status.paused) {
          promptPaused = false;
          pauseInfo.hide();
        }
        break;
      }
      case 'chapters':
        chapters = e.chapters;
        skip.setChapters(e.chapters);
        transport.setChapters(e.chapters);
        panels.setChapters(e.chapters);
        break;
      case 'outputs':
        panels.setOutputs({ devices: e.devices, active: e.active });
        break;
      case 'tracks':
        panels.setTracks(e.tracks);
        layout.setTracks(e.tracks);
        cinema.setTracks(e.tracks);
        break;
      case 'ready':
        if (!started) {
          // A source that came through after being called slow plays: its error goes, also when it was put
          // aside behind the source list (closing that list must not bring it back over a playing video).
          if (slowShown) clearSlowError();
          started = true;
          // Its first frame is where it got to, until mpv reports more (as before `place`, the error's Try again used it).
          place.played(status.timePos);
          view.classList.add('started');
          bridge.ready();
          showControls();
          panels.started();
          stopTorrentNote();
          failover.started();
          startPreviews();
          // A debrid placeholder's clip (its error is up) isn't the movie or episode playing: it stays queued, and isn't the last source.
          if (placeholder) break;
          // A queued movie or episode leaves the queue once it plays, however it was started.
          if (!request.live && !request.replay && !request.trailer && !request.link) void markStarted(request.title.id, request.episode?.episode.id);
          // What resuming offers as "last source" (see detail/resume-choice.ts); not for a file on this PC or a download.
          if (!request.live && !request.replay && !request.trailer && !request.local && !request.link && !request.source.url.startsWith('orbit-download:')) rememberSource(whereKey(request.title.id, request.episode?.episode.id), request.source);
        }
        break;
      case 'ended': {
        // A live channel has no end: its stream dropped, and mpv holds the last frame.
        if (request.live) {
          reconnectLive();
          break;
        }
        const end = endOfFile(request, placeholder, status.timePos, status.duration, creditsStarted(skip.segments(), status.timePos));
        // A placeholder clip that played out (its error is up): not the end of the movie or episode.
        if (end === 'placeholder') break;
        // Before its length, the stream dropped (mpv reads a failed reconnect as the end; with keep-open
        // there's no end-file reason to tell them apart): open it again from there once, then give way to the
        // next source or the error. Nothing is marked watched and nothing plays next. Stopping again at the
        // same moment near the end is where the file really ends.
        // Not the request object: late sources replace it while the same source plays.
        const playing = `${request.title.id}/${request.episode?.episode.id ?? ''}\n${request.source.url}`;
        if (end === 'early' && !earlyStop.endsHere(playing, status.timePos ?? 0, status.duration ?? 0)) {
          if (earlyStop.reopen(playing, status.timePos ?? 0)) load(request, status.timePos ?? 0);
          else fail(STOPPED_EARLY_ERROR);
          break;
        }
        // mpv keeps the last frame; the episode or movie is done.
        status = { ...status, paused: true, eof: true, timePos: status.duration ?? status.timePos };
        saveProgress(true);
        serverReports.status(request.source.url, status.timePos, true, status.duration);
        serverReports.stop();
        showControls();
        // Before the sleep timer lets go: a timer set for the end means nothing plays next.
        nextUp.update(true);
        endScreen.update(true);
        sleep.ended();
        presence.clear();
        // Android's player screen steps aside, so the end screen or the next episode's countdown is seen
        // (and picked with the remote) here. Stopping it this way sends no "closed": the page stays.
        if (isAndroid) void invoke('player_stop').catch(() => {});
        break;
      }
      case 'error':
        fail(e.message);
        break;
      case 'closed':
        // Leaves as Back does: progress is saved and playback stopped on the way out.
        ctx.back();
        return;
      case 'key':
        // As if pressed here: the channel surfer and the player's keys take it (the next channel or episode).
        if (e.key === 'MediaTrackNext' || e.key === 'MediaTrackPrevious') document.body.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true, cancelable: true }));
        // The player screen's Skip button: this page's Skip does it (learning intros as it goes).
        else if (e.key === 'Skip') skip.element.click();
        return;
    }
    render();
  }

  // Orbit quitting (app/quit.ts): where it got to is saved, as on the way out of the player.
  const onQuitting = () => saveProgress(true, leavesFinished(false, endScreen.shown(), creditsStarted(skip.segments(), status.timePos)));
  window.addEventListener(QUITTING, onQuitting);
  // Switching profile (app/profile-switch.ts): saved to the profile that was watching, before it changes.
  window.addEventListener(LEAVING_PROFILE, onQuitting);

  function close(): void {
    if (closed) return;
    window.removeEventListener(QUITTING, onQuitting);
    window.removeEventListener(LEAVING_PROFILE, onQuitting);
    window.removeEventListener('online', retryOnline);
    // Leaving from a film's end screen (Back, Details), from "Still watching?", or once the credits started, counts as finished, as Next Up's hand-off does.
    saveProgress(true, leavesFinished(nextUp.leftAsked(), endScreen.shown(), creditsStarted(skip.segments(), status.timePos)));
    serverReports.stop();
    nextUp.reset();
    bridge.cancel();
    endScreen.dispose();
    skip.dispose();
    presence.clear();
    media.clear();
    stopTorrentNote();
    if (torrentRunning) stopTorrent();
    previews.stop();
    failover.stop();
    grayPause.stop();
    hold.cancel();
    closed = true;
    for (const cleanup of cleanups) cleanup();
    tooltips.dispose();
    panels.dispose();
    dock.dispose();
    layout.dispose();
    transport.dispose();
    window.clearTimeout(hideTimer);
    window.clearTimeout(clickTimer);
    window.clearTimeout(pillTimer);
    subtitleLift.reset();
    pauseInfo.hide();
    if (pip) void invoke('window_pip', { on: false, aspect: 16 / 9 }).catch(() => {});
    document.documentElement.classList.remove('player-open');
    // What waited for the video to end (the update banner, an install link) may come now.
    setPlayerOpen(false);
    if (leavesFullscreen({ now: fullscreen, before: fullscreenBefore, keep: keepFullscreen })) void win.setFullscreen(false).catch(() => {});
    void invoke('player_stop').catch((err: unknown) => console.error('Could not stop playback', err));
    if (session?.view === view) session = null;
  }

  // The queue can change from the Queue panel, or as an item starts.
  cleanups.push(
    onQueueChange(() => {
      if (closed) return;
      nextChanged();
    }),
  );
  void loadQueue();
  fillEpisodes(request);

  session = {
    view,
    close,
    load: (next) => {
      if (settingsRead) return load(next);
      // Asked again before the Playback settings are read (a phone, another device): the first load,
      // once they are, opens this one instead. Loading now would open it without the person's
      // settings (resume, languages, volume limit), and the first load would then open a file again.
      request = next;
      followLateSources(next);
      renderRequest();
    },
    // Only once a file is open (as ask() does): before that there's nothing playing, and mpv may not exist yet.
    pauseBehindPrompt: () => {
      // Already paused (by the person, or by mpv at the end): dismissing the prompt must leave it paused, not play it.
      if (closed || !(started || loads > 1) || status.paused) return false;
      promptPaused = true;
      heldByPrompt = true;
      // While a file is still being asked for, `player_open` would unpause it: setPaused keeps the pause for it.
      if (awaitingFile) setPaused(true);
      else void invoke('player_set_paused', { paused: true }).catch(() => {});
      return true;
    },
    // Only a pause `pauseBehindPrompt` made: not one the person made, nor one for a file since replaced.
    resumeAfterPrompt: () => {
      if (closed || !heldByPrompt) return;
      heldByPrompt = false;
      setPaused(false);
    },
  };
  document.documentElement.classList.add('player-open');
  setPlayerOpen(true);
  followLateSources(request);
  renderRequest();
  render();

  // Listen before starting (so no event is missed) and read the Playback settings first.
  void Promise.all([
    listen<PlayerEvent>('player://event', (e) => onEvent(e.payload)),
    settings.get(PLAYBACK_SETTINGS.countdown).catch(() => undefined),
    settings.get(PLAYBACK_SETTINGS.resume).catch(() => undefined),
    settings.get(PLAYBACK_SETTINGS.autoplay).catch(() => undefined),
    settings.get(PLAYBACK_SETTINGS.skipLookup).catch(() => undefined),
    settings.get(PLAYBACK_SETTINGS.autoSkip).catch(() => undefined),
    subtitleStyle(),
    settings.get(PLAYBACK_SETTINGS.pauseOnMinimize).catch(() => undefined),
    settings.get(AUDIO_NORMALIZE_KEY).catch(() => undefined),
    settings.get(HWDEC_KEY).catch(() => undefined),
    settings.get(DISCORD_KEY).catch(() => undefined),
    settings.get(LANGUAGE_SETTINGS.audio).catch(() => undefined),
    settings.get(LANGUAGE_SETTINGS.subtitle).catch(() => undefined),
    settings.get(LANGUAGE_SETTINGS.forcedOnly).catch(() => undefined),
    settings.get(LANGUAGE_SETTINGS.originalAudio).catch(() => undefined),
    settings.get(ADJUSTMENT_SETTINGS.fit).catch(() => undefined),
    settings.get(ADJUSTMENT_SETTINGS.night).catch(() => undefined),
    settings.get(PICTURE_KEY).catch(() => undefined),
    settings.get(PREVIEWS_KEY).catch(() => undefined),
    settings.get(PLAYBACK_SETTINGS.autoSwitch).catch(() => undefined),
    settings.get(AVOID_TRACKS_KEY).catch(() => undefined),
    settings.get(SEEK_STEP_KEY).catch(() => undefined),
    settings.get(VOLUME_BOOST_KEY).catch(() => undefined),
    settings.get(HDR_KEY).catch(() => undefined),
    settings.get(PASSTHROUGH_KEY).catch(() => undefined),
    settings.get(AUTO_SYNC_KEY).catch(() => undefined),
    // The look chosen before picture adjustments, carried over until they're first changed.
    settings.get(LEGACY_LOOK_KEY).catch(() => undefined),
    settings.get(PICTURE_QUALITY_KEY).catch(() => undefined),
    settings.get(PLAYBACK_SETTINGS.sameSource).catch(() => undefined),
    settings.get(PLAYBACK_SETTINGS.keepFullscreen).catch(() => undefined),
    settings.get(VOLUME_POPUP_KEY).catch(() => undefined),
    settings.get(VOLUME_POPUP_POSITION_KEY).catch(() => undefined),
    settings.get(SKIP_MODES_KEY).catch(() => undefined),
    settings.get(ADJUSTMENT_SETTINGS.sound).catch(() => undefined),
    settings.get(HOLD_BOOST_KEY).catch(() => undefined),
    settings.get(NUMBER_JUMP_KEY).catch(() => undefined),
    settings.get(GRAYSCALE_PAUSE_KEY).catch(() => undefined),
    settings.get(EPISODES_DOCKED_KEY).catch(() => undefined),
    settings.get(TIME_MODE_KEY).catch(() => undefined),
    settings.get(FILM_END_KEY).catch(() => undefined),
    settings.get(LEARN_SKIPS_KEY).catch(() => undefined),
    settings.get(HDR_SUBTITLES_KEY).catch(() => undefined),
    settings.get(DOUBLE_CLICK_SEEK_KEY).catch(() => undefined),
    profileSetting(VOLUME_BOOST_LEVEL_PREFIX).catch(() => ({ key: undefined, value: null })),
  ]).then(([fn, countdownSetting, resumeSetting, autoplaySetting, skipLookupSetting, autoSkipSetting, style, pauseSetting, normalize, hwdec, discord, audioLanguage, subtitleLanguage, forcedOnly, originalAudio, fit, night, pictureSetting, previewSetting, switchSetting, avoidSetting, stepSetting, boostSetting, hdrSetting, passthroughSetting, autoSyncSetting, legacyLook, qualitySetting, sameSourceSetting, keepFullscreenSetting, popupSetting, popupPosition, skipModesSetting, soundSetting, holdSetting, numberSetting, graySetting, dockSetting, timeModeSetting, filmEndSetting, learnSetting, hdrSubtitlesSetting, doubleClickSetting, boostLevelSetting]) => {
    if (closed) return fn();
    cleanups.push(fn);
    settingsRead = true;
    nextUp.configure({ countdown: countdownSeconds(countdownSetting), mode: parseAutoplayMode(autoplaySetting), sameSource: sameSourceSetting !== false });
    keepFullscreen = keepFullscreenSetting === true;
    volumePopupOn = popupSetting === true;
    volumePopup.setPosition(parseVolumePopupPosition(popupPosition));
    void settings
      .get(PLAYBACK_SETTINGS.autoplayLimit)
      .then((limit) => nextUp.configure({ limit: parseAutoplayLimit(limit) }))
      .catch(() => {});
    void Promise.all([settings.get(PLAYBACK_SETTINGS.nextUpAt), settings.get(PLAYBACK_SETTINGS.nextUpStyle)])
      .then(([at, style]) => nextUp.configure({ at: parseNextUpAt(at), style: parseNextUpStyle(style) }))
      .catch(() => {});
    resumeMode = resumeSetting === 'start-over' || resumeSetting === 'ask' ? resumeSetting : 'always';
    autoplay = parseAutoplayMode(autoplaySetting) !== 'never';
    skip.configure({ lookup: skipLookupSetting !== false, modes: parseSkipModes(skipModesSetting, autoSkipSetting), learn: learnSetting !== false });
    holdBoost = holdSetting !== false;
    numberJump = numberSetting !== false;
    doubleClickSeek = doubleClickSetting === true;
    grayPause.configure(graySetting === true);
    dock.configure(dockSetting === true);
    transport.setTimeMode(parseTimeMode(timeModeSetting));
    endScreen.configure(parseFilmEnd(filmEndSetting));
    void soft('player_set_subtitle_style', { style }, t('player.error.subtitle-style'));
    panels.setSubtitleStyle(style);
    pauseOnMinimize = pauseSetting !== false;
    presence.configure(discord === true);
    languagePrefs = { audio: parseAudioLanguage(audioLanguage), subtitles: parseLanguages(subtitleLanguage), forcedOnly: forcedOnly === true, original: originalAudio === true };
    languagesApplied = applyLanguages(request);
    panels.preferSubtitles(parseLanguages(subtitleLanguage), forcedOnly === true);
    panels.avoidTracks(parseAvoidWords(avoidSetting));
    panels.autoSync(autoSyncSetting === true);
    // Before the sound settings: which of them apply depends on it (see player_set_passthrough).
    void soft('player_set_passthrough', { formats: PASSTHROUGH_FORMATS[parsePassthrough(passthroughSetting)] }, t('player.error.passthrough'));
    adjust.configure({ normalize: normalize === true, sound: parseSoundMode(soundSetting, night), fit: parseFit(fit), picture: parsePicture(pictureSetting, legacyLook) });
    pictureQuality = parsePictureQuality(qualitySetting);
    void soft('player_set_quality', { preset: pictureQuality }, t('player.error.picture'));
    previewsOn = previewSetting !== false;
    autoSwitch = switchSetting !== false;
    void soft('player_set_hwdec', { on: hwdec !== 'off' }, t('player.error.hwdec'));
    // Speed isn't saved (see speed.ts), but mpv keeps it from the last player: each one starts at 1×.
    void soft('player_set_speed', { speed: 1 }, t('player.error.speed'));
    void soft('player_set_hdr', { on: hdrSetting === true }, t('player.error.hdr'));
    void soft('player_set_hdr_subtitles', { on: hdrSubtitlesSetting !== false }, t('player.error.hdr-subtitles'));
    // Per profile; mpv outlives the player, so it's set (on or off) every time it opens.
    void profileSetting(SMOOTH_MOTION_PREFIX)
      .catch(() => ({ value: null }))
      // Closed meanwhile: mpv now belongs to the next player, which sets this itself.
      .then(({ value }) => closed || soft('player_set_smooth_motion', { on: value === true }, t('player.error.smooth-motion')));
    seekStep = parseSeekStep(stepSetting);
    transport.setSeekStep(seekStep);
    boostKey = boostLevelSetting.key;
    maxVolume = boostSetting === true ? parseVolumeBoost(boostLevelSetting.value ?? true) : 100;
    transport.setVolumeMax(maxVolume);
    limitApplied = soft('player_set_volume_boost_level', { level: maxVolume }, t('player.error.volume-boost'));
    panels.newTitle();
    skip.newTitle(request.title, request.episode);
    load(request);
  });

  return view;
}
