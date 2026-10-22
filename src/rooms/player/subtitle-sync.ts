/**
 * "Sync automatically" for an added subtitle: Rust re-times it against the
 * video's own subtitles (or, for a video on this PC, its soundtrack) and
 * shows the result as a new track (see src-tauri/src/player/subsync). This
 * keeps the state the Tracks panel shows, and syncs by itself when Settings
 * says so. The original subtitle stays in the list.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { t } from '../../i18n';
import { formatNumber } from './format';
import { formatDelay } from './panels';
import type { TrackInfo } from './tracks';

export interface SyncResult {
  /** Seconds the lines moved (typically); positive is later. */
  shift: number;
  reference: 'subtitle' | 'speech';
  framerate: boolean;
  split: boolean;
  /** The re-timed track now showing; null when it was already in time. */
  track: number | null;
}

type Stage = 'reading' | 'listening' | 'aligning';
export type SyncState = { kind: 'idle' } | { kind: 'running'; stage: Stage; progress: number | null };

const ERRORS = {
  'no-subtitle': 'player.sync.error.no-subtitle',
  embedded: 'player.sync.error.embedded',
  unreadable: 'player.sync.error.unreadable',
  unsupported: 'player.sync.error.unsupported',
  'no-reference': 'player.sync.error.no-reference',
  uncertain: 'player.sync.error.uncertain',
} as const;

/** "Shifted by +1.4 s · frame rate corrected", or "Already in sync". */
export function resultMessage(result: SyncResult): string {
  if (result.track === null) return t('player.sync.in-sync');
  const shifted = t('player.sync.shifted', { delay: formatDelay(Math.round(result.shift * 10) / 10) });
  if (result.framerate) return `${shifted} · ${t('player.sync.framerate')}`;
  if (result.split) return `${shifted} · ${t('player.sync.split')}`;
  return shifted;
}

/** What went wrong, from Rust's error code; null when it was cancelled (nothing to say). */
export function errorMessage(code: unknown): string | null {
  if (code === 'cancelled') return null;
  return typeof code === 'string' && code in ERRORS ? t(ERRORS[code as keyof typeof ERRORS]) : t('player.sync.error.failed');
}

/** The running sync's step, for the Tracks panel. */
export function stageText(stage: Stage, progress: number | null): string {
  if (stage === 'reading') return t('player.sync.reading');
  if (stage === 'aligning') return t('player.sync.aligning');
  return t('player.sync.listening', { percent: progress === null ? '' : `${formatNumber(Math.round(progress * 100), 0)}%` }).trim();
}

/**
 * The subtitle to sync by itself, if any: the one showing, when it was added
 * (from an addon or a file, not the video's own), isn't a sync result, and
 * hasn't been tried in this file.
 */
export function autoSyncCandidate(tracks: readonly TrackInfo[], tried: ReadonlySet<number>): number | null {
  const shown = tracks.find((track) => track.kind === 'sub' && track.selected);
  return shown?.external && !tried.has(shown.id) ? shown.id : null;
}

export function createSubtitleSync(host: {
  /** The state changed: the Tracks panel redraws. */
  changed(): void;
  /** A re-timed copy is showing (the manual subtitle delay no longer applies). */
  applied(): void;
  /** Says something briefly (a toast). */
  say(text: string): void;
}) {
  let state: SyncState = { kind: 'idle' };
  let auto = false;
  /** Subtitles synced or tried in this file, and the copies made by syncing: not synced again by themselves. */
  const tried = new Set<number>();
  let selected: number | null = null;
  /** The subtitle the running sync is for, and whether it was asked for. */
  let syncing: { track: number; manual: boolean } | null = null;
  /** Bumped by each sync and by another file: a reply for an older one is dropped. */
  let generation = 0;
  let lastMessage: { track: number; text: string } | null = null;
  /** mpv's latest track list, for a subtitle picked while a sync ran. */
  let listed: readonly TrackInfo[] = [];

  // Each run's events carry the ticket it was started with: a cancelled or overtaken run (the file
  // before's, say) may still report a step, which isn't this one's.
  const unlisten = listen<{ ticket: number; stage: Stage; progress: number | null }>('player://sync', (e) => {
    if (state.kind !== 'running' || e.payload.ticket !== generation) return;
    state = { kind: 'running', stage: e.payload.stage, progress: e.payload.progress };
    host.changed();
  });

  async function run(manual: boolean): Promise<void> {
    if (selected === null) return;
    const subtitle = selected;
    const mine = ++generation;
    tried.add(subtitle);
    syncing = { track: subtitle, manual };
    state = { kind: 'running', stage: 'reading', progress: null };
    host.changed();
    try {
      // The soundtrack only when asked: it means decoding the whole file (Rust uses it only for files on this PC).
      const result = await invoke<SyncResult>('player_sync_subtitle', { audio: manual, label: t('player.sync.label'), ticket: mine });
      if (mine !== generation) return;
      const message = resultMessage(result);
      if (result.track !== null) {
        tried.add(result.track);
        host.applied();
        lastMessage = { track: result.track, text: message };
      } else lastMessage = { track: subtitle, text: message };
      state = { kind: 'idle' };
      if (manual || result.track !== null) host.say(manual ? message : t('player.sync.auto-done', { result: message }));
    } catch (err) {
      if (mine !== generation) return;
      state = { kind: 'idle' };
      const message = errorMessage(err);
      // Syncing by itself stays quiet when it can't: the subtitle shows as it was.
      if (message && manual) {
        lastMessage = { track: subtitle, text: message };
        host.say(message);
      }
    }
    host.changed();
    // A subtitle picked while this ran wasn't synced by itself then: it is now.
    autoSync();
  }

  function autoSync(): void {
    if (auto && state.kind !== 'running' && autoSyncCandidate(listed, tried) !== null) void run(false);
  }

  function cancel(): void {
    if (state.kind !== 'running') return;
    generation++;
    state = { kind: 'idle' };
    void invoke('player_sync_cancel').catch(() => {});
    host.changed();
  }

  return {
    state: () => state,
    /** The note for the subtitle showing: its last sync's result, if any. */
    note: () => (lastMessage && lastMessage.track === selected ? lastMessage.text : null),
    /** Whether the subtitle showing can be synced (it was added, not the video's own). */
    available: () => selected !== null,
    /** "Sync automatically" in the Tracks panel; while running, it cancels. */
    toggle(): void {
      if (state.kind === 'running') return cancel();
      void run(true);
    },
    /** Settings → Sync subtitles automatically. */
    setAuto(on: boolean): void {
      auto = on;
    },
    /**
     * A track already in time (a translation keeps its source's timing): not synced by itself.
     * mpv may list it before its maker hears back, so a sync it started on it by itself stops.
     */
    skip(track: number): void {
      tried.add(track);
      if (state.kind === 'running' && syncing?.track === track && !syncing.manual) cancel();
    },
    /** mpv's track list changed: notes the subtitle showing, and syncs it by itself if wanted. */
    tracks(list: readonly TrackInfo[]): void {
      listed = list;
      const shown = list.find((track) => track.kind === 'sub' && track.selected);
      selected = shown?.external ? shown.id : null;
      autoSync();
    },
    /** Another file: nothing carries over (its tracks are numbered anew). */
    newFile(): void {
      if (state.kind === 'running') void invoke('player_sync_cancel').catch(() => {});
      generation++;
      state = { kind: 'idle' };
      tried.clear();
      listed = [];
      selected = null;
      lastMessage = null;
    },
    dispose(): void {
      generation++;
      void unlisten.then((fn) => fn());
    },
  };
}
