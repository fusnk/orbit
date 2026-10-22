/**
 * Windows' media controls for the player (see src-tauri/src/media_controls.rs):
 * the media flyout shows what's playing, and its buttons and the keyboard's
 * media keys work the player even while Orbit is in the background.
 *
 * Privacy, as for Discord: while watch history is paused, on a profile with
 * a content limit, and for a file from this PC or a pasted link, the flyout says only "Orbit"
 * (no title, episode or poster). The buttons still work.
 *
 * With Orbit focused, Windows can deliver one key press twice: to the page as
 * a key, and to the media controls as a button. The gate below lets the first
 * of the two through.
 */
import { invoke } from '@tauri-apps/api/core';
import { limited } from '../../catalog/parental';
import { historyPaused } from '../../library/history-pause';

/** The event a button pressed in the flyout (or a media key while Orbit is in the background) arrives as. */
export const MEDIA_BUTTON_EVENT = 'media-controls://button';
export type MediaButton = 'play' | 'pause' | 'next' | 'previous';
/** The player's key for each button: it runs exactly as that media key would (keys.ts). */
export const BUTTON_KEYS: Record<MediaButton, string> = { play: 'MediaPlay', pause: 'MediaPause', next: 'MediaTrackNext', previous: 'MediaTrackPrevious' };

export const isMediaButton = (value: unknown): value is MediaButton => typeof value === 'string' && Object.hasOwn(BUTTON_KEYS, value);

/** A seek asked for by the desktop's media controls (Linux's MPRIS): `{ seconds, relative }`. */
export const MEDIA_SEEK_EVENT = 'media-controls://seek';

/**
 * Runs a media-controls seek through the player's own rules: nothing while
 * the controls are locked, and no jump to a time in Live TV (as for the phone
 * remote); moving by some seconds works as the seek keys do.
 */
export function runMediaSeek(value: unknown, player: { locked: boolean; live: boolean; seekBy(seconds: number): void; seekTo(seconds: number): void }): void {
  if (typeof value !== 'object' || value === null) return;
  const { seconds, relative } = value as { seconds?: unknown; relative?: unknown };
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || typeof relative !== 'boolean' || player.locked) return;
  if (relative) player.seekBy(seconds);
  else if (seconds >= 0 && !player.live) player.seekTo(seconds);
}

/** The brand, not translated: what the flyout says when it says nothing more. */
const GENERIC = 'Orbit';

/** True while the flyout must not name what's playing. */
export const mediaSilenced = (): boolean => historyPaused() || limited();

export interface NowPlaying {
  title: string;
  /** The episode ("S1 · E2 · Pilot"), the channel's programme, or null. */
  detail: string | null;
  poster: string | null;
  /** A file from this PC: its name stays off everything outside the player. */
  local: boolean;
  canNext: boolean;
  canPrevious: boolean;
}

/** What Rust shows on the flyout. */
export interface MediaInfo {
  title: string;
  subtitle: string | null;
  poster: string | null;
  canNext: boolean;
  canPrevious: boolean;
}

/** A file from this PC or a pasted link (named from its address): not named anywhere outside the player. */
export const unnamed = (request: { local?: boolean | undefined; link?: boolean | undefined }): boolean => !!request.local || !!request.link;

export function mediaInfo(now: NowPlaying, silenced: boolean): MediaInfo {
  const { canNext, canPrevious } = now;
  if (silenced || now.local) return { title: GENERIC, subtitle: null, poster: null, canNext, canPrevious };
  return { title: now.title, subtitle: now.detail, poster: now.poster, canNext, canPrevious };
}

export function createMediaSession() {
  /** What was sent last, so Rust only hears about changes. */
  let last: string | undefined;
  return {
    /** Called whenever what's playing (or whether it may be shown) can have changed. */
    update(now: NowPlaying): void {
      const info = mediaInfo(now, mediaSilenced());
      const key = JSON.stringify(info);
      if (key === last) return;
      last = key;
      void invoke('media_controls_set', { playing: info }).catch((err: unknown) => console.warn('Could not update the media controls', err));
    },
    clear(): void {
      if (last === undefined) return;
      last = undefined;
      void invoke('media_controls_clear').catch(() => {});
    },
  };
}

export type MediaGroup = 'playback' | 'next' | 'previous';

/** Which press a media key is, or null for any other key. */
export function mediaGroup(key: string): MediaGroup | null {
  switch (key) {
    case 'MediaPlayPause':
    case 'MediaPlay':
    case 'MediaPause':
    case 'MediaStop':
      return 'playback';
    case 'MediaTrackNext':
      return 'next';
    case 'MediaTrackPrevious':
      return 'previous';
    default:
      return null;
  }
}

/** How close together the same press, arriving both ways, can be (ms). */
export const SAME_PRESS_MS = 400;

/**
 * Lets one of a press's two deliveries through: the same kind of press from
 * the other source within `SAME_PRESS_MS` is the same key press, so it's
 * dropped. Presses from one source are never dropped (pressing twice quickly
 * pauses and plays again).
 */
export function createMediaKeyGate(now: () => number = () => Date.now()) {
  const last = new Map<MediaGroup, { from: 'key' | 'system'; at: number }>();
  return {
    pass(group: MediaGroup, from: 'key' | 'system'): boolean {
      const at = now();
      const before = last.get(group);
      if (before && before.from !== from && at - before.at < SAME_PRESS_MS) {
        last.delete(group);
        return false;
      }
      last.set(group, { from, at });
      return true;
    },
  };
}
