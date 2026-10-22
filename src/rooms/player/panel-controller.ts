/**
 * The player's floating panel (the settings hub and its views, source,
 * episodes, queue, stream info) and the buttons that open it. Views opened
 * from the hub stack on it: Back (or Esc) goes up one level. Also keeps the subtitle tracks
 * mpv reports and the addons' subtitle offers the Tracks panel lists. The
 * panels' contents are drawn by panels.ts.
 */
import { invoke } from '@tauri-apps/api/core';
import type { RoomContext } from '../../app/router';
import { loadSubtitles } from '../../catalog/service';
import { icon, type IconName } from '../../components/icons';
import { editingAt, resumeEditing } from '../../components/text-field';
import { toast } from '../../components/toast';
import { isRtl, language, t } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { languageKey, languageName, UNKNOWN_LANGUAGE } from '../../lib/languages';
import { availableLanguage } from './preferred-language';
import { addonFilter, addonGroups } from '../../lib/source-filter';
import { baseName, episodeHint, episodeOfFile, isMain, matchesHint, withFile, type TorrentFile, type TorrentFiles } from '../../lib/torrent-files';
import { dequeue, moveQueued, queueItems } from '../../library/queue';
import { playQueued } from '../detail/queue-actions';
import { onWatchChange } from '../../library/watch';
import { playTitle } from '../detail/streams';
import type { createAdjustments } from './adjustments';
import { failureOf, whereKey } from './failed-sources';
import { createFilePicker, focusFilePicker } from './file-picker';
import { formatInfo, formatNumber, qualityLabel } from './format';
import { hubFocusId, hubView, type HubValues } from './hub';
import { DEFAULT_LAYOUT, layoutChanged, loadPlayerLayout, PLAYER_LAYOUT_KEY, watchPlayerLayout, withControlScale, type PlayerLayout } from './layout';
import type { PlayRequest } from './index';
import { audioView, chaptersView, controlsSizeView, copyLinkView, episodesPanel, filesPanel, formatDelay, infoPanel, MAX_SUBTITLE_BYTES, PANEL_TITLES, pictureView, QUALITY_NAMES, queuePanel, SLEEP_CHOICES, sleepView, soundView, sourcePanel, speedView, subtitlesView, subtitleStyleView, timingView, type PanelKind, type PictureAndSound, type SleepChoice, type TracksPanel } from './panels';
import { withKey } from './keys';
import { chapterName, currentChapter } from './chapters';
import { COPY_LINK_WARNED_PREFIX, copyableLink, createCopyLink } from './copy-link';
import { profileSetting } from '../../library/profiles';
import { isAndroid } from '../../lib/platform';
import { AUDIO_DEVICE_PREFIX, AUTO_DEVICE, deviceChoices, deviceMissing, listAudioDevices, parseAudioDevice, type AudioOutputs } from './audio-device';
import type { Chapter, Segment } from './skip';
import { createTranscript } from './transcript-view';
import type { PictureQuality } from './picture';
import { isTorrent, torrentFiles } from './torrent';
import { createInfoPoller } from './playback-info';
import { FIX_CAPS_KEY, parseVolumeBoost, SDH_KEEP_LYRICS_KEY, STRIP_SDH_KEY, type VolumeBoostLevel } from './player-settings';
import { openPasteSubtitles } from './paste-subtitles';
import { choiceForAudio, matchAudio, matchSubtitle, playingAudio, remembersTracks, subtitleChoice, trackMemory } from './track-memory';
import { shortReleaseName, videoRelease } from './subtitle-match';
import { createSubtitleSync, stageText } from './subtitle-sync';
import { createSubtitleTranslate, progressText } from './subtitle-translate';
import { DEFAULT_SUBTITLE_STYLE, POSITION_BOTTOM, saveSubtitleStyle, subtitleOverride, type SubtitleStyle } from './subtitle-style';
import { SOUND_NAMES } from './sound';
import { roundSpeed, speedLabel } from './speed';
import { audioLabel, autoSubtitle, bestOffers, forcedFix, groupSubtitles, isSdh, nextOffer, replacementTrack, subtitleToShow, subtitleTrackOption, titleOffers, type AddonSubtitle, type SubtitleOption, type TrackInfo } from './tracks';

export interface PanelHost {
  ctx: RoomContext;
  request(): PlayRequest;
  status(): { subDelay?: number | null; speed: number | null; timePos: number | null; duration: number | null; passthrough: boolean; height: number | null };
  sleep: { choice(): SleepChoice; note(): string; pick(choice: SleepChoice): void };
  /** The panel closed (by the person, or for a new file). Before focus goes back, so the host may move it. */
  closed?(): void;
  /** Starts another source of this title, at a position. */
  load(request: PlayRequest, start?: number): void;
  /** Where another source picks up: where this one got to, or was asked to start (see failover.ts `createPlace`). */
  position(): number | undefined;
  /** Jumps to a position, as the seek bar does. */
  seekTo(seconds: number): void;
  /** Where the intro, recap, credits and preview are (see skip-controller.ts). */
  segments(): readonly Segment[];
  /** Plays a segment from its start (not skipping it automatically this time). */
  playSegment(segment: Segment): void;
  /** Sends a command; on failure, says `message`. */
  soft(cmd: string, args: Record<string, unknown>, message: string): void;
  showControls(): void;
  /** Timing, picture shape and night mode (see adjustments.ts). */
  adjust: ReturnType<typeof createAdjustments>;
  /** Settings → Video → Picture quality, as applied. */
  pictureQuality(): PictureQuality;
  /** Episodes is docked on the right instead (see episode-dock.ts): its button works that. */
  episodesDocked(): boolean;
  /** What the Speed view says under the speeds (holding play/pause for 2×), or ''. */
  speedNote(): string;
  toggleDock(): void;
  shortcuts(): void;
  volumeBoost(): number;
  setVolumeBoost(level: VolumeBoostLevel): void;
}

/** How far "What did they say?" goes back, with subtitles on until it catches up. */
const REPLAY_SECONDS = 10;

/** Languages to list first: the app's language, then English. */
function preferredLanguages(): string[] {
  return [...new Set([languageKey(language()), 'en'])];
}

export function createPanels(host: PanelHost) {
  const preferred = preferredLanguages();
  let kind: PanelKind | null = null;
  /** The views open, the hub first when they were opened from it; the last one shows. */
  let stack: PanelKind[] = [];
  /** Which way the last change went, for the slide. */
  let direction: 'forward' | 'back' | null = null;
  let tracks: TrackInfo[] = [];
  /** The playing file's chapters, and the one the Chapters view last marked as playing. */
  let chapters: Chapter[] = [];
  let shownChapter = -1;
  /** The segment the Chapters view last marked as playing ('' for none). */
  let shownSegment = '';
  let offers: AddonSubtitle[] = [];
  let offerAddons: string[] = [];
  let failedAddons: string[] = [];
  let loadingOffers = false;
  /** Settings → Audio & Subtitles: the subtitle languages, in order, to load from an addon when the file has none. */
  let wantLanguages: string[] = [];
  /** The first of them the file or an addon has subtitles in (preferred-language.ts). */
  const wantSubtitles = () => availableLanguage(wantLanguages, (lang) => tracks.some((t) => t.kind === 'sub' && languageKey(t.lang) === lang) || offers.some((o) => languageKey(o.lang) === lang));
  /** Whether this file has shown its first frame (its track list is complete). */
  let fileStarted = false;
  /** Tracks named with these words aren't picked automatically (e.g. "commentary"). */
  let avoidWords: string[] = [];
  /** Done once per file, so turning subtitles off sticks. */
  let autoPicked = false;
  let memoryApplied = false;
  /** Whether this profile's per-show track memory has been read. */
  let memoryLoaded = false;
  /** Settings: show only forced subtitles when the audio is already in the subtitle language. */
  let forcedOnly = false;
  /** "What did they say?": the position where its temporary subtitles turn off again. */
  let replayUntil: number | null = null;
  /** Whether the replay's subtitle was already picked but hidden: it's hidden again, not turned off. */
  let replayHides = false;
  let offersAbort: AbortController | undefined;
  /** What the offers were asked for (offersKey), so another source of the same title asks again. */
  let offersFor: string | undefined;
  let expandedLanguage: string | null = null;
  let languageFilter = '';
  let episodesSeason = host.request().episode?.season ?? 1;
  let infoRaw: Record<string, string> = {};
  let infoPinned = false;
  let disposed = false;
  let controlLayout: PlayerLayout = { ...DEFAULT_LAYOUT };
  let controlSave: ReturnType<typeof setTimeout> | undefined;
  const infoHud = h('aside', { class: 'player-info-hud', hidden: true, 'aria-label': t('player.panel.info'), dir: isRtl() ? 'rtl' : 'ltr' });
  const infoPoll = createInfoPoller({
    active: () => !disposed && fileStarted && (kind === 'info' || infoPinned),
    read: () => invoke<Record<string, string>>('player_info'),
    render: (raw) => { infoRaw = raw; renderInfoHud(); if (kind === 'info') redraw(); },
  });
  let layoutChanges = 0;
  const stopLayout = watchPlayerLayout((layout) => {
    layoutChanges++;
    if (controlLayout === layout) return;
    controlLayout = layout;
    if (kind === 'controls-size') redraw();
  });
  void loadPlayerLayout().then((layout) => { if (!disposed && !layoutChanges) controlLayout = layout; });
  /** How subtitles look (Settings) and where they sit (set here); null until read. */
  let subtitleStyle: SubtitleStyle | null = null;
  /** The `sub-ass-override` last sent to mpv (see subtitleOverride). */
  let sentOverride: string | undefined;
  let styleSave: number | undefined;
  /** The offer "Try another subtitle" last asked for, until mpv lists it. */
  let cycledTo: string | undefined;
  /** The Speed view's Custom stepper was opened (until the panel closes or a pill is picked). */
  let speedCustom = false;
  /** The playing torrent's files (looked up when the Source panel opens), and their picker once built. */
  let torrentList: { url: string; state: 'loading' | 'failed' | TorrentFiles; picker?: HTMLElement } | null = null;

  // "Sync automatically" for an added subtitle (see subtitle-sync.ts).
  const sync = createSubtitleSync({
    changed: () => (kind === 'timing' || kind === 'hub') && redraw(),
    // The re-timed copy is in time by itself: a manual subtitle delay would move it off again.
    applied: () => host.adjust.setDelay('sub', 0),
    say: (text) => toast(text),
  });

  // "Translate to <language>…" for an added subtitle (see subtitle-translate.ts).
  const translation = createSubtitleTranslate({
    changed: () => (kind === 'subtitles' || kind === 'hub') && redraw(),
    say: (text) => toast(text),
    // A translation keeps its source's timing: syncing it by itself again would only risk moving it off.
    added: (track) => sync.skip(track),
  });

  // Settings → Audio & Subtitles → Remove hearing-impaired text: applied by Rust and mpv to subtitles added from here on.
  void Promise.all([settings.get(STRIP_SDH_KEY).catch(() => undefined), settings.get(SDH_KEEP_LYRICS_KEY).catch(() => undefined)]).then(([on, lyrics]) =>
    host.soft('player_set_sdh_filter', { on: on === true, keepLyrics: lyrics !== false }, t('subs.error.sdh')),
  );

  // Settings → Audio & Subtitles → Fix ALL-CAPS subtitles: applied by Rust to subtitle files added from here on.
  // It can be changed in the Subtitle style view too.
  let capsFix = false;
  void settings
    .get(FIX_CAPS_KEY)
    .catch(() => undefined)
    .then((on) => {
      capsFix = on === true;
      host.soft('player_set_caps_fix', { on: capsFix }, t('playertools.caps.error'));
    });

  // Settings → Audio → Output device (per profile): sent on every open, as mpv outlives the player.
  // The Audio view lists the outputs; mpv's own events keep the list current (setOutputs).
  let outputs: AudioOutputs | null = null;
  let wantedDevice = AUTO_DEVICE;
  let deviceKey: string | null = null;
  if (!isAndroid) {
    void profileSetting(AUDIO_DEVICE_PREFIX)
      .catch(() => ({ key: null, value: null }))
      .then(({ key, value }) => {
        deviceKey = key;
        wantedDevice = parseAudioDevice(value);
        if (disposed) return;
        host.soft('player_set_audio_device', { device: wantedDevice }, t('audiodevice.error'));
        return listAudioDevices().then((listed) => {
          outputs = listed;
          if (kind === 'audio') redraw();
        });
      })
      .catch((err: unknown) => console.warn('Could not list sound outputs', err));
  }

  function pickDevice(name: string): void {
    wantedDevice = name;
    redraw();
    host.soft('player_set_audio_device', { device: name }, t('audiodevice.error'));
    if (deviceKey) void settings.set(deviceKey, name).catch(() => toast(t('settings.common.save-failed')));
  }

  const button = (label: string, iconName: IconName, className = 'player-button') => h('button', { class: className, title: label, 'aria-label': label }, icon(iconName));

  const episodes = button(t('player.controls.episodes'), 'episodes');
  const tracksButton = button(withKey(t('playerplus.hub.title'), 'player.tracks'), 'sliders');
  const speed = button(t('player.controls.speed'), 'speed');
  // The player's tooltip shows this (the speed now, kept by render), not the native title.
  speed.dataset.tooltipLabel = t('player.controls.speed');
  speed.removeAttribute('title');
  const queue = button(t('watching.queue.title'), 'list');
  const source = h('button', { class: 'source-chip', title: t('player.controls.switch-source') });
  const info = button(t('player.controls.info'), 'info');
  const opener: [PanelKind, HTMLElement][] = [
    ['episodes', episodes],
    ['hub', tracksButton],
    ['speed', speed],
    ['queue', queue],
    ['source', source],
    ['info', info],
  ];
  for (const [k, b] of opener) {
    b.addEventListener('click', () => toggle(k));
    b.setAttribute('aria-expanded', 'false');
  }

  const title = h('h2', { class: 'player-panel-title', id: 'player-panel-title' });
  const backButton = button(t('player.controls.back'), 'back', 'player-panel-close player-panel-back');
  backButton.addEventListener('click', () => back());
  const closeButton = button(t('player.controls.close'), 'close', 'player-panel-close');
  closeButton.addEventListener('click', () => close());
  const body = h('div', { class: 'player-panel-body' });
  const panel = h('div', { class: 'player-panel', role: 'dialog', 'aria-labelledby': 'player-panel-title', hidden: true }, h('div', { class: 'player-panel-header' }, backButton, title, closeButton), body);

  const transcript = createTranscript({
    seek: (seconds) => host.soft('player_seek', { seconds, relative: false }, t('player.error.go-back')),
    // Esc with nothing typed: up to the hub when opened from it, like every other view.
    close: back,
    changed: () => { if (kind === 'transcript') transcript.tick(host.status().timePos, host.status().subDelay ?? host.adjust.delays().sub); },
  });

  body.addEventListener('pointerdown', () => { if (kind === 'transcript') transcript.interacted(); });
  body.addEventListener('wheel', () => { if (kind === 'transcript') transcript.interacted(); }, { passive: true });
  body.addEventListener('touchmove', () => { if (kind === 'transcript') transcript.interacted(); }, { passive: true });

  // Stream info → Copy stream link (see copy-link.ts). The link goes only to the clipboard.
  const copyLink = createCopyLink({
    warned: () => profileSetting(COPY_LINK_WARNED_PREFIX).then(({ value }) => value === true),
    setWarned: () => profileSetting(COPY_LINK_WARNED_PREFIX).then(({ key }) => settings.set(key, true)),
    ask: () => openView('copy-link'),
    write: (text) => navigator.clipboard.writeText(text),
    say: (outcome) => toast(t(outcome === 'copied' ? 'player.copy-link.copied' : 'player.copy-link.failed')),
  });

  // Marked watched from the Episodes view (or progress saved meanwhile): it follows.
  const stopWatching = onWatchChange(() => {
    if (kind === 'episodes') redraw();
  });

  /** What had focus when the panel opened: its button, or nothing (a shortcut from the picture). */
  let returnTo: Element | null = null;

  /** Opens `next` on its own (its button or key), or closes it if it's showing on its own already. */
  function toggle(next: PanelKind): void {
    if (next === 'episodes' && host.episodesDocked()) {
      close();
      return host.toggleDock();
    }
    if (kind === next && stack.length === 1) return close();
    if (!kind) returnTo = document.activeElement;
    show([next], null);
  }

  /** Opens `next` on top of what's showing (a view from the hub, or a torrent's files from the Source view). */
  function openView(next: PanelKind): void {
    if (!kind) return toggle(next);
    show([...stack, next], 'forward');
  }

  /** Up one level: from a view back to the hub (focus on the entry it came from), or closed. */
  function back(): void {
    if (stack.length <= 1) return close();
    const left = stack.at(-1)!;
    show(stack.slice(0, -1), 'back');
    body.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(left === 'files' ? 'source-files' : hubFocusId(left))}"]`)?.focus({ preventScroll: false });
  }

  function show(next: PanelKind[], slide: typeof direction): void {
    stack = next;
    direction = slide;
    const top = next.at(-1)!;
    kind = top;
    const { episode } = host.request();
    if (top === 'episodes' && episode) episodesSeason = episode.season;
    if (top === 'info') refreshInfo();
    if (top === 'transcript') void transcript.load(tracks.find((track) => track.kind === 'sub' && track.selected)?.id ?? null, true);
    if (top === 'source' || top === 'files') lookUpFiles();
    panel.hidden = false;
    // Opened from the top-right (source, info), the panel drops down from there.
    panel.classList.toggle('from-top', next[0] === 'source' || next[0] === 'info');
    // Focus is placed below; what had it is being replaced.
    if (panel.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    redraw();
    host.showControls();
    if (slide === 'back') return;
    const picker = top === 'files' ? body.querySelector<HTMLElement>('.file-picker') : null;
    if (picker) focusFilePicker(picker);
    // A view's own default first (the copy-link warning's Cancel), then the selected row (in the Source panel, the source playing rather than the addon chip above it; a favourite heart or watched check isn't a selection).
    // In that order, not page order: a pressed pill (Normal speed) rather than the first pill before it; not the hub's "Info on screen" chip, a switch rather than a selection.
    // A disabled button can't take focus (the transcript's match buttons before a search): its search field does, without editing.
    else
      // `.selected`: the language group holding the subtitle showing (a group row is expanded, not pressed), not the second subtitle's pressed Off further down.
      ['[data-default-focus]', '.panel-row[aria-pressed="true"], .panel-row.selected', '[aria-pressed="true"]:not(.favourite-heart, .watched-toggle, [data-focus-id="hub-info-hud"]), [aria-current="true"]', '[data-focus-id="transcript-search"], button:not(:disabled)']
        .map((selector) => body.querySelector<HTMLElement>(selector))
        .find(Boolean)
        ?.focus({ preventScroll: false });
  }

  function close(): void {
    if (!kind) return;
    kind = null;
    stack = [];
    speedCustom = false;
    if (!infoPinned) infoPoll.reset();
    panel.hidden = true;
    body.replaceChildren();
    for (const [, b] of opener) {
      b.classList.remove('open');
      b.setAttribute('aria-expanded', 'false');
    }
    host.closed?.();
    if (!panel.contains(document.activeElement) && document.activeElement !== document.body) return;
    // Back to where it was opened from (its button, usually); opened by a shortcut from the
    // picture, back to the picture, so the arrows seek (or surf) again rather than move between controls.
    if (returnTo instanceof HTMLElement && returnTo !== document.body && returnTo.isConnected) returnTo.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  /** Redraws the open panel, keeping focus and scroll where they were. */
  function redraw(): void {
    for (const [k, b] of opener) {
      b.classList.toggle('open', k === kind);
      b.setAttribute('aria-expanded', String(k === kind));
    }
    if (!kind) return;
    const active = document.activeElement instanceof HTMLElement && panel.contains(document.activeElement) ? document.activeElement : undefined;
    const focusId = active?.dataset.focusId;
    // A field being typed in (the Subtitles view's language search redraws on each letter) goes on being typed in.
    const typing = active instanceof HTMLInputElement ? editingAt(active) : null;
    // In the queue, the row that had focus: if its button is gone or disabled (moved to an end, removed), focus stays on that row's place.
    const rows = () => [...body.querySelectorAll('.queue-row')];
    const queueRow = active?.closest('.queue-row');
    const rowIndex = queueRow ? rows().indexOf(queueRow) : -1;
    const scroll = body.scrollTop;
    title.textContent = PANEL_TITLES[kind];
    panel.classList.toggle('transcript-panel', kind === 'transcript');
    backButton.hidden = stack.length <= 1;
    const backLabel = kind === 'files' ? t('player.files.back') : t('playerplus.hub.back', { to: PANEL_TITLES[stack.at(-2) ?? kind] });
    backButton.title = backLabel;
    backButton.setAttribute('aria-label', backLabel);
    body.replaceChildren(...content(kind));
    // A new view slides in from the side it comes from; a redraw of the same one keeps its place.
    if (direction) {
      panel.classList.remove('slide-forward', 'slide-back');
      void panel.offsetWidth;
      panel.classList.add(`slide-${direction}`);
      direction = null;
      body.scrollTop = 0;
    } else body.scrollTop = scroll;
    if (focusId) {
      const again = body.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`);
      again?.focus({ preventScroll: true });
      if (typing && again instanceof HTMLInputElement) resumeEditing(again, typing);
    }
    if (rowIndex >= 0 && !panel.contains(document.activeElement)) {
      const all = rows();
      const place = all.find((r) => r.contains(body.querySelector(`[data-focus-id="${CSS.escape(focusId ?? '')}"]`))) ?? all[Math.min(rowIndex, all.length - 1)];
      (place?.querySelector<HTMLElement>('.panel-row') ?? closeButton).focus({ preventScroll: true });
    }
  }

  function content(open: PanelKind): HTMLElement[] {
    const request = host.request();
    switch (open) {
      case 'transcript':
        transcript.tick(host.status().timePos, host.status().subDelay ?? host.adjust.delays().sub);
        return [transcript.element];
      case 'hub':
        return hubView(hubValues(), openView, chapters.length || host.segments().length ? [] : ['chapters'], {
          infoOnScreen: infoPinned,
          toggleInfo: () => {
            setInfoPinned(!infoPinned);
            return infoPinned;
          },
          shortcuts: () => {
            close();
            host.shortcuts();
          },
        });
      case 'controls-size':
        return controlsSizeView(controlLayout, (scale) => {
          controlLayout = withControlScale(controlLayout, scale);
          // Do not redraw a slider during a drag: its activation and pointer capture must survive.
          layoutChanged(controlLayout);
          window.clearTimeout(controlSave);
          controlSave = window.setTimeout(() => {
            controlSave = undefined;
            void settings.set(PLAYER_LAYOUT_KEY, controlLayout).catch(() => toast(t('settings.common.save-failed')));
          }, 200);
        });
      case 'chapters':
        shownChapter = currentChapter(chapters, host.status().timePos);
        shownSegment = segmentPlaying();
        return chaptersView({
          chapters,
          current: shownChapter,
          onPick: (chapter) => {
            close();
            host.seekTo(chapter.time);
          },
          segments: host.segments(),
          duration: host.status().duration ?? 0,
          position: host.status().timePos,
          onSegment: (segment) => {
            close();
            host.playSegment(segment);
          },
        });
      case 'audio':
        return audioView(tracksData());
      case 'subtitles':
        return subtitlesView(tracksData());
      case 'subtitle-style':
        return subtitleStyleView(tracksData());
      case 'timing':
        return timingView(tracksData());
      case 'speed':
        return speedView(
          host.status().speed ?? 1,
          (value, stepped) => {
            // A pill closes Custom; the stepper keeps it open, even on a pill's speed (focus stays on + or −).
            speedCustom = !!stepped;
            host.soft('player_set_speed', { speed: value }, t('player.error.speed'));
          },
          host.speedNote(),
          {
            open: speedCustom,
            onOpen: () => {
              speedCustom = true;
              redraw();
            },
          },
        );
      case 'sleep':
        return sleepView({ choice: host.sleep.choice(), note: host.sleep.note(), onPick: (choice) => host.sleep.pick(choice) });
      case 'picture':
        return pictureView(pictureData());
      case 'sound':
        return soundView(pictureData());
      case 'source': {
        const list = torrentList?.url === request.source.url && typeof torrentList.state === 'object' ? torrentList.state : undefined;
        const videos = list?.files.filter(isMain).length ?? 0;
        return sourcePanel({
          sources: request.sources,
          currentId: request.source.id,
          // Another source loads first (which closes the panel): closing first would bring a failed source's error back for a moment.
          onPick: (picked) => {
            if (picked.id !== request.source.id) host.load({ ...request, source: picked }, host.position());
            close();
          },
          files: videos > 1 ? { count: videos, onOpen: () => openView('files') } : undefined,
          addon: addonFilter.resolve(addonGroups(request.sources), true),
          onAddon: (addon) => {
            addonFilter.choose(addon);
            redraw();
          },
          failure: failureOf(whereKey(request.title.id, request.episode?.episode.id)),
        });
      }
      case 'files': {
        if (!torrentList || torrentList.state === 'loading') return filesPanel(t('player.files.loading'));
        if (torrentList.state === 'failed') return filesPanel(t('player.files.failed'));
        const files = torrentList.state;
        const hint = request.source.fileChosen ? undefined : episodeHint(request.title, request.episode);
        const chosen = files.files.find((f) => f.index === files.chosen);
        torrentList.picker ??= createFilePicker({ list: files, chosenLabel: chosen && matchesHint(chosen, hint) ? t('player.files.this-episode') : t('player.files.default'), onPick: (file) => playFile(file, files) });
        return filesPanel(torrentList.picker);
      }
      case 'episodes':
        return episodesPanel({
          title: request.title,
          seasons: request.title.seasons ?? [],
          season: episodesSeason,
          current: request.episode ? { season: request.episode.season, number: request.episode.episode.number } : undefined,
          onSeason: (n) => {
            episodesSeason = n;
            redraw();
          },
          onPick: (season, episode) => {
            close();
            // Plays here (the best source, or the picker over the player, per Settings).
            void playTitle(request.title, { episode: { season, episode }, ctx: host.ctx });
          },
        });
      case 'queue':
        return queuePanel(queueItems(), {
          play: (item) => {
            close();
            // Plays here (the best source, or the picker over the player, per Settings); it leaves the queue once it starts.
            playQueued(item, host.ctx);
          },
          move: (item, step) => void moveQueued(item.id, step),
          remove: (item) => void dequeue(item.id),
        });
      case 'info':
        return infoPanel(
          formatInfo(infoRaw, { addon: request.source.addon, file: request.source.filename }),
          copyableLink(request.source.url) ? { focusId: hubFocusId('copy-link'), onCopy: () => void copyLink.request(host.request().source.url) } : undefined,
          { on: infoPinned, change: setInfoPinned },
        );
      case 'copy-link':
        return copyLinkView({
          onCopy: () => {
            // The source playing now (another may have started since the warning opened).
            void copyLink.confirmed(host.request().source.url);
            back();
          },
          onCancel: () => back(),
        });
    }
  }

  /** Which segment is playing, as a key ('' for none), to redraw the Chapters view when that changes. */
  function segmentPlaying(): string {
    const at = host.status().timePos;
    const s = at === null ? undefined : host.segments().find((x) => at >= x.start && at < x.end);
    return s ? `${s.kind}@${s.start}` : '';
  }

  /** What the audio, subtitle, position and timing views show, and what they do. */
  function tracksData(): TracksPanel {
    const request = host.request();
    return {
      tracks,
      groups: groupSubtitles(tracks, offers, preferred, bestOffers(offers, playingRelease()), playingRelease()),
      expanded: expandedLanguage,
      filter: languageFilter,
      loadingOffers,
      offerAddons,
      failedAddons,
      onAudio: (id) => chooseAudio(id),
      onSubtitle: (option) => chooseSubtitle(option),
      onExpand: (key) => {
        expandedLanguage = key;
        redraw();
      },
      onFilter: (text) => {
        languageFilter = text;
        redraw();
      },
      onUpload: (file) => void uploadSubtitle(file),
      // Pasted subtitles are another file, like an upload: the last one's timing goes back to 0.
      onPaste: () => openPasteSubtitles(() => body.querySelector<HTMLElement>('[data-focus-id="sub-paste"]')?.focus({ preventScroll: true }), timingForNewFile),
      ...anotherRow(),
      delays: host.adjust.delays(),
      onDelay: (which, seconds) => {
        host.adjust.setDelay(which, seconds);
        redraw();
      },
      onSecondary: (id) => host.soft('player_select_track', { kind: 'sub2', id }, t('player.error.second-subtitle')),
      ...(sync.available() ? { sync: syncRow() } : {}),
      ...(translation.available() ? { translate: translateRow() } : {}),
      position: {
        lift: POSITION_BOTTOM - (subtitleStyle ?? DEFAULT_SUBTITLE_STYLE).position,
        keepBottom: (subtitleStyle ?? DEFAULT_SUBTITLE_STYLE).keepBottom,
        // Applied at once; no redraw, so a slider being dragged keeps its place.
        onLift: (lift) => {
          if (changeStyle({ position: POSITION_BOTTOM - lift })) host.soft('player_set_subtitle_style', { style: subtitleStyle }, t('player.error.subtitle-style'));
        },
        onKeepBottom: (on) => {
          if (!changeStyle({ keepBottom: on })) return;
          // Rust takes placement tags out of subtitle files added from now on.
          host.soft('player_set_subtitle_style', { style: subtitleStyle }, t('player.error.subtitle-style'));
          applyOverride();
        },
      },
      say: (message) => toast(message),
      look: {
        style: subtitleStyle ?? DEFAULT_SUBTITLE_STYLE,
        onStyle: (patch) => {
          if (!changeStyle(patch)) return;
          host.soft('player_set_subtitle_style', { style: subtitleStyle }, t('player.error.subtitle-style'));
          // The size slider keeps its place; chips and switches show what's now pressed.
          if (!('size' in patch)) redraw();
        },
        caps: capsFix,
        onCaps: (on) => {
          capsFix = on;
          host.soft('player_set_caps_fix', { on }, t('playertools.caps.error'));
          void settings.set(FIX_CAPS_KEY, on).catch(() => toast(t('settings.common.save-failed')));
        },
      },
      ...(outputs ? { output: { choices: deviceChoices(outputs.devices, t('audiodevice.default')), wanted: wantedDevice, missing: deviceMissing(wantedDevice, outputs.devices), onPick: pickDevice } } : {}),
      ...(memory().audio || memory().sub ? { forget: { label: request.title.type === 'series' ? t('watching.tracks.forget-show') : t('watching.tracks.forget-movie'), onForget: forget } } : {}),
    };
  }

  /** What the picture and sound views show, and what they do. */
  function pictureData(): PictureAndSound {
    return {
      aspect: host.adjust.aspect(),
      fit: host.adjust.fit(),
      picture: host.adjust.picture(),
      quality: host.pictureQuality(),
      sound: host.adjust.sound(),
      boost: { level: parseVolumeBoost(host.volumeBoost()), onPick: host.setVolumeBoost },
      passthrough: host.status().passthrough,
      onAspect: (aspect) => {
        host.adjust.setAspect(aspect);
        redraw();
      },
      onFit: (fit) => {
        host.adjust.setFit(fit);
        redraw();
      },
      // Applied at once; no redraw, so a slider being dragged keeps its place.
      onPicture: (picture) => host.adjust.setPicture(picture),
      onSound: (mode) => {
        host.adjust.setSound(mode);
        redraw();
      },
    };
  }

  /** Each hub entry's current value. */
  function hubValues(): HubValues {
    const { source: playing } = host.request();
    const audio = tracks.find((t) => t.kind === 'audio' && t.selected);
    const sub = tracks.find((t) => t.kind === 'sub' && t.selected);
    const speedNow = host.status().speed ?? 1;
    const boost = host.volumeBoost();
    const lift = POSITION_BOTTOM - (subtitleStyle ?? DEFAULT_SUBTITLE_STYLE).position;
    const delays = host.adjust.delays();
    const chapter = currentChapter(chapters, host.status().timePos);
    const timing = [delays.sub ? t('playerplus.hub.timing-sub', { delay: formatDelay(delays.sub) }) : '', delays.audio ? t('playerplus.hub.timing-audio', { delay: formatDelay(delays.audio) }) : ''].filter(Boolean).join(' · ');
    const subLanguage = sub ? languageKey(sub.lang) : UNKNOWN_LANGUAGE;
    return {
      picture: [qualityLabel(host.status().height), t(QUALITY_NAMES[host.pictureQuality()])].filter(Boolean).join(' · '),
      source: playing.addon || t('player.source.unnamed'),
      subtitles: !sub ? t('player.tracks.off') : subLanguage !== UNKNOWN_LANGUAGE ? languageName(subLanguage) : (sub.title ?? t('player.tracks.added')),
      audio: audio ? audioLabel(audio).label : '',
      speed: Math.abs(speedNow - 1) < 0.01 ? t('player.speed.normal') : speedLabel(speedNow),
      'subtitle-style': lift === 0 ? t('player.subtitle-style.bottom') : t('subs.player.raised', { value: formatNumber(lift) }),
      timing: timing || t('playerplus.hub.timing-none'),
      sound: boost > 100 ? `${t(SOUND_NAMES[host.adjust.sound()])} · ${t('trybox.controls.percent', { percent: formatNumber(boost) })}` : t(SOUND_NAMES[host.adjust.sound()]),
      chapters: chapter >= 0 ? chapterName(chapters[chapter]!, chapter) : '',
      sleep: SLEEP_CHOICES.find(([value]) => value === host.sleep.choice())?.[1] ?? '',
    };
  }

  /** The Tracks panel's sync row: start, or (while running) its progress and cancel. */
  function syncRow(): { label: string; detail: string; onToggle(): void } {
    const state = sync.state();
    if (state.kind === 'running') return { label: t('player.sync.cancel'), detail: stageText(state.stage, state.progress), onToggle: () => sync.toggle() };
    return { label: t('player.sync.action'), detail: sync.note() ?? t('player.sync.detail'), onToggle: () => sync.toggle() };
  }

  /** The Subtitles view's translate row: start, its progress and cancel, or what went wrong (picking it tries again). */
  function translateRow(): { label: string; detail: string; onToggle(): void } {
    const state = translation.state();
    const onToggle = () => translation.toggle();
    if (state.kind === 'running') return { label: t('subtrans.player.cancel'), detail: progressText(state.done, state.total), onToggle };
    if (state.kind === 'failed') return { label: t('subtrans.player.retry'), detail: state.message, onToggle };
    return { label: t('subtrans.player.action', { language: translation.targetName() }), detail: t('subtrans.player.detail'), onToggle };
  }

  /** Changes the subtitle style and saves it once the changes settle; false before it's been read. */
  function changeStyle(patch: Partial<SubtitleStyle>): boolean {
    if (!subtitleStyle) return false;
    subtitleStyle = { ...subtitleStyle, ...patch };
    window.clearTimeout(styleSave);
    styleSave = window.setTimeout(saveStyle, 400);
    return true;
  }

  function saveStyle(): void {
    styleSave = undefined;
    if (!subtitleStyle) return;
    saveSubtitleStyle(subtitleStyle).catch((err: unknown) => {
      console.error('Could not save subtitle style', err);
      toast(t('settings.common.save-failed'));
    });
  }

  /** "Keep at the bottom" for the subtitle showing: plain text ones inside the video lose their tags (see subtitleOverride). */
  function applyOverride(): void {
    if (!subtitleStyle) return;
    const mode = subtitleOverride(subtitleStyle.keepBottom, tracks.find((t) => t.kind === 'sub' && t.selected));
    if (mode === sentOverride) return;
    sentOverride = mode;
    host.soft('player_set_subtitle_override', { mode }, t('subs.error.override'));
  }

  /** Asks for the playing torrent's files, once per source, to offer them in the Source panel. */
  function lookUpFiles(): void {
    const request = host.request();
    const { url } = request.source;
    if (!isTorrent(url)) return void (torrentList = null);
    // Asked once per source; a failed lookup is tried again the next time the panel opens.
    if (torrentList?.url === url && torrentList.state !== 'failed') return;
    const entry: NonNullable<typeof torrentList> = { url, state: 'loading' };
    torrentList = entry;
    const settle = (state: 'failed' | TorrentFiles) => {
      if (torrentList !== entry) return;
      entry.state = state;
      if (kind !== 'source' && kind !== 'files') return;
      const waiting = kind === 'files' && document.activeElement === backButton;
      redraw();
      const picker = body.querySelector<HTMLElement>('.file-picker');
      if (waiting && picker) focusFilePicker(picker);
    };
    torrentFiles(url, request.source.fileChosen ? undefined : episodeHint(request.title, request.episode)).then(settle, () => settle('failed'));
  }

  /**
   * Plays another file of the torrent playing. A file named for another
   * episode of this series plays as that episode (so its progress lands
   * there); another file of the same episode keeps the place.
   */
  function playFile(file: TorrentFile, list: TorrentFiles): void {
    close();
    if (file.index === list.playing) return;
    const request = host.request();
    const episode = request.episode ? episodeOfFile(request.title, file) : undefined;
    const sameEpisode = !!episode && episode.episode.id === request.episode?.episode.id;
    const source = { ...request.source, url: withFile(request.source.url, file.index), filename: baseName(file.name), videoSize: file.size, videoHash: undefined, fileChosen: true };
    // The sources listed (and those still coming) are this episode's: another episode's file has only itself to switch to.
    const sources = !episode || sameEpisode ? { sources: request.sources } : { sources: [source], moreSources: undefined };
    host.load({ ...request, ...sources, episode: episode ?? request.episode, source }, sameEpisode ? (host.status().timePos ?? undefined) : undefined);
  }

  function refreshInfo(): void {
    infoPoll.refresh();
  }
  /** The playback info pinned on screen (the Info view's switch, the hub's chip). */
  function setInfoPinned(on: boolean): void {
    infoPinned = on;
    infoHud.hidden = !on;
    renderInfoHud();
    infoPoll.reset();
  }
  function renderInfoHud(): void {
    if (!infoPinned) return;
    const request = host.request();
    const shown = [t('player.info.source'), t('player.info.video'), t('player.info.bitrate'), t('player.info.buffered'), t('trybox.info.dropped'), t('trybox.info.fps')];
    const rows = formatInfo(infoRaw, { addon: request.source.addon }).filter(([label]) => shown.includes(label));
    infoHud.replaceChildren(h('dl', { class: 'info-list' }, ...rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])));
  }

  // ── Subtitles ──
  /** Notes a pick made by hand ('' if its language is unknown), for later episodes of this title. */
  function remember(which: 'audio' | 'sub', choice: string): void {
    const request = host.request();
    if (choice && remembersTracks(request)) trackMemory.remember(request.title.id, which, choice);
  }

  /** "Forget for this show": later episodes follow the preferred languages again. */
  function forget(): void {
    trackMemory.forget(host.request().title.id);
    toast(t('watching.tracks.forgotten'));
    redraw();
    body.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  const selectSub = (id: number | null) => host.soft('player_select_track', { kind: 'sub', id }, t('player.error.subtitles'));

  /**
   * Another subtitle file was picked (an addon's, another added one, an upload, pasted ones): a timing set
   * for the last file rarely fits it, so it goes back to 0. Turning subtitles off and on, or
   * picking the file's own tracks, keeps it. Returns the note to show, or '' if it was 0 already.
   */
  function timingForNewFile(): string {
    if (!host.adjust.delays().sub) return '';
    host.adjust.setDelay('sub', 0);
    return t('pstream.timing.reset');
  }
  /** `message`, and the timing note when there is one. */
  const withNote = (message: string, note: string) => (note ? `${message} · ${note}` : message);

  function chooseAudio(id: number): void {
    const lang = languageKey(tracks.find((t) => t.id === id && t.kind === 'audio')?.lang);
    remember('audio', lang === UNKNOWN_LANGUAGE ? '' : lang);
    host.soft('player_select_track', { kind: 'audio', id }, t('player.error.audio-track'));
  }

  function chooseSubtitle(option: SubtitleOption | null): void {
    replayUntil = null;
    // An addon's SDH mark isn't in the name mpv knows its subtitle by: the option's flag carries it.
    remember('sub', !option ? 'off' : option.kind === 'track' ? subtitleChoice(option.track.lang, option.track.forced, option.track.title, option.sdh) : subtitleChoice(option.sub.lang, false, null, option.sdh));
    if (!option) return host.soft('player_select_track', { kind: 'sub', id: null }, t('player.error.subtitles-off'));
    if (option.kind === 'track') {
      const showing = tracks.find((t) => t.kind === 'sub' && t.selected);
      if (option.track.external && showing && showing.id !== option.track.id) {
        const note = timingForNewFile();
        if (note) toast(note);
      }
      return host.soft('player_select_track', { kind: 'sub', id: option.track.id }, t('player.error.subtitles'));
    }
    // mpv downloads the file itself and selects it once added.
    toast(withNote(t('player.tracks.loading-subtitle', { name: option.sub.title }), timingForNewFile()));
    host.soft('player_add_subtitle', { url: option.sub.url, title: option.sub.title, lang: option.sub.lang }, t('player.error.subtitle-load'));
  }

  /** The next offer "Try another subtitle" switches to (see `nextOffer`). */
  function another(): ReturnType<typeof nextOffer> {
    // Asked for but not listed by mpv yet: quick presses move on from it, not from what's still showing.
    const pending = cycledTo !== undefined && !tracks.some((t) => t.kind === 'sub' && t.title === cycledTo) ? cycledTo : undefined;
    const remembered = memoryLanguage();
    return nextOffer(tracks, offers, remembered && remembered !== 'off' ? remembered : wantSubtitles(), playingRelease(), pending);
  }

  function anotherRow(): Pick<TracksPanel, 'another'> {
    const next = another();
    return next ? { another: { detail: t('playertools.subs.try-another-detail', { language: languageName(next.lang) }), onTry: tryAnotherSubtitle } } : {};
  }

  /** "Try another subtitle" (its row, or its key): the next best addon subtitle in the same language, cycling. */
  function tryAnotherSubtitle(): void {
    const next = another();
    if (!next) return toast(t('playertools.subs.no-other'));
    replayUntil = null;
    cycledTo = next.offer.title;
    toast(withNote(t('playertools.subs.cycled', { position: next.position, total: next.total, source: next.offer.addon }), timingForNewFile()));
    if (next.track) selectSub(next.track.id);
    else host.soft('player_add_subtitle', { url: next.offer.url, title: next.offer.title, lang: next.offer.lang }, t('player.error.subtitle-load'));
  }

  async function uploadSubtitle(file: File): Promise<void> {
    if (file.size > MAX_SUBTITLE_BYTES) return toast(t('player.tracks.too-big'));
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Header values must be plain ASCII; the name is only a label.
    const label = file.name.replace(/[^\x20-\x7E]/g, '_').slice(0, 120);
    await invoke('player_upload_subtitle', bytes, { headers: { 'x-file-name': label } }).then(
      () => {
        const note = timingForNewFile();
        if (note) toast(note);
      },
      (err: unknown) => {
        console.error('Could not add subtitle', err);
        toast(t('player.tracks.bad-file'));
      },
    );
  }

  /** Everything the offers depend on: the title, and the source's own subtitles and file hints. */
  function offersKey(): string {
    const { title, episode, source } = host.request();
    return JSON.stringify([title.id, episode?.episode.id, source.filename, source.videoSize, source.videoHash, source.subtitles]);
  }

  function loadOffers(): void {
    offersFor = offersKey();
    offersAbort?.abort();
    const abort = (offersAbort = new AbortController());
    offers = [];
    // Subtitle addons know movies and episodes, not TV channels.
    // Nor files from this PC: their names stay on this PC. Nor pasted links: they aren't a title.
    if (host.request().live || host.request().replay || host.request().trailer || host.request().local || host.request().link) {
      offerAddons = [];
      failedAddons = [];
      loadingOffers = false;
      return;
    }
    offerAddons = [];
    failedAddons = [];
    loadingOffers = true;
    const { title, episode, source: playing } = host.request();
    void loadSubtitles(title, episode ? { season: episode.season, number: episode.episode.number, id: episode.episode.id } : undefined, { filename: playing.filename, videoSize: playing.videoSize, videoHash: playing.videoHash }, abort.signal, playing.subtitles)
      .then(({ subtitles, failed }) => {
        if (abort.signal.aborted) return;
        offers = titleOffers(
          subtitles.map((s) => ({
            url: s.item.url,
            lang: s.item.lang,
            addon: s.origins[0]?.name ?? t('player.tracks.addon'),
            release: { name: s.item.subtitleFileName ?? s.item.url, group: s.item.releaseGroup, fps: s.item.fpsMilli ? s.item.fpsMilli / 1000 : undefined },
            // Shown only from the file name the addon gave, never from the address (it can carry a key).
            name: shortReleaseName(s.item.subtitleFileName),
            sdh: isSdh(s.item.subtitleFileName, s.item.lang),
          })),
        );
        offerAddons = [...new Set(subtitles.map((s) => s.origins[0]?.name ?? t('player.tracks.addon')))];
        failedAddons = failed;
      })
      .catch(() => {
        if (!abort.signal.aborted) failedAddons = [t('player.tracks.subtitle-addons')];
      })
      .finally(() => {
        if (abort.signal.aborted) return;
        loadingOffers = false;
        if (kind === 'subtitles' || kind === 'hub') redraw();
        pickAutomatically();
      });
  }

  /** The release playing, to match subtitles to (its file name, or a debrid link's last part). */
  const playingRelease = () => {
    const { source: playing } = host.request();
    return videoRelease(playing.filename ?? playing.url.split(/[?#]/)[0]);
  };

  /** The language of the audio playing (or of `picked`, about to be). */
  const audioLanguage = (picked?: TrackInfo) => languageKey((picked ?? tracks.find((t) => t.kind === 'audio' && t.selected))?.lang);

  /** Tracks picked by hand for this title (on an earlier episode, or before); none for what the memory leaves alone. */
  const memory = (): { audio?: string; sub?: string } => (remembersTracks(host.request()) ? trackMemory.get(host.request().title.id) : {});
  /** The remembered subtitle's language ('off' stays 'off'). */
  const memoryLanguage = (): string | undefined => memory().sub?.split(':')[0];

  /** On a new episode, picks the audio and subtitles chosen by hand for this title, over the preferred languages. */
  function applyMemory(): void {
    if (memoryApplied || !fileStarted || !memoryLoaded) return;
    memoryApplied = true;
    const { audio, sub } = memory();
    const audioTrack = audio ? matchAudio(tracks, audio, avoidWords) : undefined;
    if (audioTrack && !audioTrack.selected) host.soft('player_select_track', { kind: 'audio', id: audioTrack.id }, t('player.error.audio-track'));
    if (sub === 'off') {
      if (tracks.some((t) => t.kind === 'sub' && t.selected)) selectSub(null);
    } else if (sub) {
      const choice = choiceForAudio(sub, audioLanguage(audioTrack));
      const subTrack = matchSubtitle(tracks, choice);
      if (subTrack && !subTrack.selected) selectSub(subTrack.id);
      // Forced subtitles were chosen and this file has none: nothing shows, not the full ones.
      else if (!subTrack && choice.endsWith(':forced') && tracks.some((t) => t.kind === 'sub' && t.selected)) selectSub(null);
    }
    // mpv picks by language and default flags, so it may land on a commentary track.
    const betterAudio = audioTrack ? undefined : replacementTrack(tracks, 'audio', avoidWords);
    if (betterAudio) host.soft('player_select_track', { kind: 'audio', id: betterAudio.id }, t('player.error.audio-track'));
    const betterSub = sub ? undefined : replacementTrack(tracks, 'sub', avoidWords);
    if (betterSub) selectSub(betterSub.id);
  }

  /** Loads an addon subtitle in the wanted language if the file has none (once both are known). */
  function pickAutomatically(): void {
    if (autoPicked || !fileStarted || loadingOffers || !memoryLoaded) return;
    autoPicked = true;
    const remembered = memory();
    // The remembered audio only if this file has it: an episode without it plays another language.
    const audio = playingAudio(tracks, remembered.audio, avoidWords);
    // Addons don't mark forced subtitles, so a remembered forced choice only uses the file's own
    // (while it suits the audio; over a dub it stands for that language's full subtitles).
    if (remembered.sub && choiceForAudio(remembered.sub, audio).endsWith(':forced')) return;
    const chosen = memoryLanguage();
    const want = chosen ?? wantSubtitles();
    if (want === 'off') return;
    // Only forced subtitles when the audio is already in that language: an addon's full ones aren't wanted
    // (unless they were picked by hand for this title).
    if (forcedOnly && !chosen && audio === want) return;
    // A choice for this title outranks the subtitle mpv picked by the preferred language.
    const considered = chosen ? tracks.map((t) => (t.kind === 'sub' && t.selected && languageKey(t.lang) !== want ? { ...t, selected: false } : t)) : tracks;
    const sub = autoSubtitle(considered, offers, want, audio, playingRelease());
    if (sub) return host.soft('player_add_subtitle', { url: sub.url, title: sub.title, lang: sub.lang }, t('player.error.subtitle-load'));
    // mpv picks by language, so it may show forced lines meant for other audio: the full track, or nothing.
    const fix = forcedFix(considered, audio);
    if (fix) selectSub(fix.id);
  }

  return {
    element: panel,
    infoHud,
    refresh: () => { if (kind) redraw(); },
    buttons: { episodes, tracks: tracksButton, speed, queue, source, info },
    kind: () => kind,
    toggle,
    /** Opens a view on top of what's showing (the hub's views). */
    open: openView,
    /** Up one level (Esc, Back): to the hub, or closed. */
    back,
    keyBack: () => kind === 'transcript' ? transcript.escape() : back(),
    close,
    redraw,
    /** Picks an audio track as the Audio view does (the phone remote). */
    chooseAudio,
    /** Picks one of the file's subtitle tracks, or none, as the Subtitles view does (the phone remote). */
    chooseSubtitleTrack(id: number | null): void {
      // The view's own option, so an SDH pick is remembered as SDH for later episodes.
      const option = id === null ? undefined : subtitleTrackOption(tracks, offers, id);
      if (id !== null && !option) return;
      chooseSubtitle(option ?? null);
    },
    setTracks(next: TrackInfo[]): void {
      tracks = next;
      if (kind === 'transcript') void transcript.load(next.find((track) => track.kind === 'sub' && track.selected)?.id ?? null);
      sync.tracks(next);
      translation.tracks(next);
      // Another subtitle may be plain text or styled.
      applyOverride();
      if (kind === 'audio' || kind === 'subtitles' || kind === 'timing' || kind === 'hub') redraw();
    },
    /** The playing file's chapters (mpv lists them again for each file). */
    setChapters(next: Chapter[]): void {
      chapters = next;
      if (kind === 'chapters' || kind === 'hub') redraw();
    },
    /** mpv's sound outputs changed (one plugged in or removed), or the one it plays on. */
    setOutputs(next: AudioOutputs): void {
      outputs = next;
      if (kind === 'audio') redraw();
    },
    /** A different movie or episode: its own tracks and subtitle offers. */
    newTitle(): void {
      tracks = [];
      expandedLanguage = null;
      cycledTo = undefined;
      autoPicked = false;
      memoryApplied = false;
      host.adjust.newTitle(host.request().title.id);
      // Already asked by newFile when the player moved to this title.
      if (offersKey() !== offersFor) loadOffers();
      if (!memoryLoaded) {
        void trackMemory.load().then(() => {
          memoryLoaded = true;
          applyMemory();
          pickAutomatically();
        });
      }
    },
    /** The preferred subtitle language from Settings, or '' for none. */
    subtitlePreference: () => wantSubtitles(),
    preferSubtitles(languages: readonly string[], onlyForced: boolean): void {
      wantLanguages = [...languages];
      forcedOnly = onlyForced;
    },
    /** Settings → Audio & Subtitles → Sync subtitles automatically. */
    autoSync(on: boolean): void {
      sync.setAuto(on);
    },
    /** The subtitle style as applied when the player opened (its position is changed here). */
    setSubtitleStyle(style: SubtitleStyle): void {
      subtitleStyle = style;
      applyOverride();
    },
    /** Settings → Audio & Subtitles → Skip tracks named. */
    avoidTracks(words: string[]): void {
      avoidWords = words;
    },
    /** Another file is loading; its tracks aren't known until it starts. */
    newFile(): void {
      fileStarted = false;
      infoRaw = {};
      renderInfoHud();
      infoPoll.reset();
      // Another source (a failover, the Source panel) has its own tracks, and none of the subtitles
      // added to the last one: the title's remembered picks and the automatic subtitle apply to it again.
      tracks = [];
      autoPicked = false;
      memoryApplied = false;
      // An offer "Try another subtitle" asked for on the last file is never listed on this one.
      cycledTo = undefined;
      transcript.reset();
      // Another source, or another file of it: its file list is asked for again.
      torrentList = null;
      replayUntil = null;
      sync.newFile();
      translation.newFile();
      // Another source brings its own subtitles, and the addons match theirs to its file: the last
      // source's offers would be cut for another release.
      if (offersFor !== undefined && offersKey() !== offersFor) loadOffers();
    },
    /** The file showed its first frame. */
    started(): void {
      fileStarted = true;
      infoPoll.refresh();
      applyMemory();
      pickAutomatically();
    },
    tryAnotherSubtitle,
    /** "What did they say?" (R): back 10 seconds, with subtitles on until playback catches up. */
    whatDidTheySay(): void {
      const from = host.status().timePos ?? 0;
      host.soft('player_seek', { seconds: -REPLAY_SECONDS, relative: true }, t('player.error.go-back'));
      const subs = tracks.filter((t) => t.kind === 'sub');
      if (subs.some((t) => t.selected)) {
        // Hidden with the Subtitles key: shown for the replay, hidden again once it catches up.
        void invoke<boolean>('player_set_subtitles_visible', { visible: true })
          .then((was) => {
            if (was) return;
            replayUntil = from;
            replayHides = true;
          })
          .catch((err: unknown) => console.error('Could not show subtitles', err));
        return;
      }
      const remembered = memoryLanguage();
      const wanted = [remembered && remembered !== 'off' ? remembered : '', ...wantLanguages, ...preferred].filter(Boolean);
      const pick = subtitleToShow(subs, [], wanted, avoidWords);
      if (!pick || !('track' in pick)) return toast(t('player.tracks.none-to-show'));
      selectSub(pick.track.id);
      replayUntil = from;
      replayHides = false;
    },
    /** Whether a subtitle track is selected (shown, or hidden by the Subtitles key). */
    subtitleSelected: () => tracks.some((t) => t.kind === 'sub' && t.selected),
    /** The language codes of the audio and subtitle tracks playing (for "Continue on…", see app/connect-ui.ts). */
    selectedLanguages: () => ({ audio: tracks.find((t) => t.kind === 'audio' && t.selected)?.lang ?? null, subtitle: tracks.find((t) => t.kind === 'sub' && t.selected)?.lang ?? null }),
    /**
     * The Subtitles key with no subtitle selected: the remembered, preferred or
     * interface-language subtitle (see `subtitleToShow`): the file's full
     * subtitles before an addon's in each language, a forced track only when
     * there's neither, else the file's first. False when there's nothing to show.
     */
    showSomeSubtitle(): boolean {
      const remembered = memoryLanguage();
      const wanted = [...new Set([remembered && remembered !== 'off' ? remembered : '', ...wantLanguages, ...preferred].filter(Boolean))];
      const pick = subtitleToShow(tracks, offers, wanted, avoidWords, playingRelease());
      if (!pick) return false;
      replayUntil = null;
      if ('track' in pick) selectSub(pick.track.id);
      else host.soft('player_add_subtitle', { url: pick.offer.url, title: pick.offer.title, lang: pick.offer.lang }, t('player.error.subtitle-load'));
      return true;
    },
    /** Playback moved on: turns the replay's subtitles off once it's past where it started. */
    tick(position: number | null): void {
      if (kind === 'transcript') transcript.tick(position, host.status().subDelay ?? host.adjust.delays().sub);
      // The Chapters view moves its mark when playback reaches the next chapter.
      if (kind === 'chapters' && (currentChapter(chapters, position) !== shownChapter || segmentPlaying() !== shownSegment)) redraw();
      if (replayUntil === null || position === null || position < replayUntil) return;
      replayUntil = null;
      if (replayHides) host.soft('player_set_subtitles_visible', { visible: false }, t('player.error.subtitles-toggle'));
      else selectSub(null);
    },
    /** The buttons that depend on what's playing. */
    renderRequest(): void {
      const { title: playing, source: from } = host.request();
      episodes.hidden = !playing.seasons?.length;
      queue.hidden = !queueItems().length && kind !== 'queue';
      source.replaceChildren(h('span', { class: 'source-chip-label' }, t('player.controls.source')), h('span', {}, from.addon), icon('chevronDown'));
    },
    /** More sources arrived: an open Source panel redraws. */
    sourcesChanged(): void {
      if (kind === 'source') redraw();
    },
    /** The queue changed: its button shows while there's something queued, and an open Queue panel redraws. */
    queueChanged(): void {
      queue.hidden = !queueItems().length && kind !== 'queue';
      if (kind === 'queue') redraw();
    },
    /** Marks the speed button while the speed or a sleep timer is changed. */
    render(): void {
      const value = host.status().speed ?? 1;
      speed.classList.toggle('active', Math.abs(value - 1) > 0.01 || host.sleep.choice() !== 'off');
      speed.dataset.tooltipLabel = Math.abs(value - 1) > 0.01 ? t('player.controls.speed-value', { speed: roundSpeed(value) }) : t('player.controls.speed');
    },
    dispose(): void {
      disposed = true;
      infoPoll.dispose();
      stopLayout();
      window.clearTimeout(controlSave);
      if (controlSave !== undefined) void settings.set(PLAYER_LAYOUT_KEY, controlLayout).catch(() => {});
      infoHud.remove();
      // A position change still waiting to be saved.
      if (styleSave !== undefined) {
        window.clearTimeout(styleSave);
        saveStyle();
      }
      stopWatching();
      transcript.dispose();
      sync.dispose();
      translation.dispose();
      offersAbort?.abort();
    },
  };
}
