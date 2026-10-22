import type { QueueItem } from '../../library/queue';
import { isJellyfinId } from '../../library/jellyfin';
import { isPlexId } from '../../library/plex';
import { releasedAt } from '../../lib/air-date';
import { infoHashOf } from '../../lib/torrent-files';
import type { EpisodeRef } from '../detail/title-actions';
import type { PlayableSource } from './panels';
import { MAX_VOLUME_BOOST } from './player-settings';

/** Spec default for the Next Up countdown, in seconds (Settings → Playback). */
export const DEFAULT_COUNTDOWN = 10;
/** The Next Up card appears this far into an episode (as in the design's prototype), unless Settings say otherwise. */
export const NEXT_UP_AT = 0.94;

/**
 * Settings → Playback → When Next Up appears, for episodes whose credits
 * aren't known (with known credits it always comes with them): a share of
 * the episode (85–98 %), or a number of minutes before the end (1–10).
 */
export type NextUpAt = { mode: 'percent'; value: number } | { mode: 'before-end'; value: number };
export const NEXT_UP_PERCENT = { min: 85, max: 98 } as const;
export const NEXT_UP_MINUTES = { min: 1, max: 10 } as const;
export const DEFAULT_NEXT_UP_AT: NextUpAt = { mode: 'percent', value: NEXT_UP_AT * 100 };
/** Each mode's starting value when it's picked. */
export const NEXT_UP_START: Record<NextUpAt['mode'], number> = { percent: NEXT_UP_AT * 100, 'before-end': 2 };

const whole = (value: unknown, range: { min: number; max: number }): value is number => typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max;

/** The saved choice, or the default for anything that isn't one. */
export function parseNextUpAt(value: unknown): NextUpAt {
  if (typeof value !== 'object' || value === null) return DEFAULT_NEXT_UP_AT;
  const { mode, value: n } = value as { mode?: unknown; value?: unknown };
  if (mode === 'percent' && whole(n, NEXT_UP_PERCENT)) return { mode, value: n };
  if (mode === 'before-end' && whole(n, NEXT_UP_MINUTES)) return { mode, value: n };
  return DEFAULT_NEXT_UP_AT;
}

/**
 * Whether playback has reached where Next Up appears (credits unknown). "N
 * minutes before the end" never comes before the episode's halfway point, so
 * a short episode or a clip isn't interrupted from its start.
 */
export function reachedNextUp(timePos: number, duration: number, at: NextUpAt): boolean {
  if (!(duration > 0)) return false;
  if (at.mode === 'percent') return timePos / duration >= at.value / 100;
  return timePos >= Math.max(duration - at.value * 60, duration / 2);
}

/** Settings → Playback → Next Up style: the small card in the corner, or a panel docked along the side. */
export const NEXT_UP_STYLES = ['card', 'panel'] as const;
export type NextUpStyle = (typeof NEXT_UP_STYLES)[number];
export const parseNextUpStyle = (value: unknown): NextUpStyle => (value === 'panel' ? 'panel' : 'card');

/**
 * Where an episode left for the next counts as left at. Next Up or the credits
 * handing off (`finished`) means it was watched, even when that happens before
 * the watched threshold (credits that start early, a 95% threshold); pressing
 * Next part-way saves where it really got to.
 */
export const leftAt = (timePos: number, duration: number, finished: boolean) => (finished ? duration : timePos);

/**
 * Whether starting what's next hands off (see `leftAt`): the countdown, the
 * card's or the credits' Play (`finished`), or Next pressed while the card is
 * up. The bar's Next, a key and a remote's Next go the same way as the card,
 * and on Android the card is itself a button that sends Next.
 */
export const handsOff = (finished: boolean, cardShown: boolean) => finished || cardShown;

/**
 * The source to continue with on the next episode, from that episode's
 * sources (ranked best first): the same torrent if this was a season pack
 * that has it too (it keeps downloading from the same people, see
 * torrent.rs), else the same release (binge group) if an addon tagged one,
 * else the same addon's in the same quality from the same release group,
 * then in the same quality, then its best, else the overall best. This
 * keeps quality, language and subtitles consistent across a binge, as
 * Stremio does.
 */
export function pickNextSource(sources: readonly PlayableSource[], current: PlayableSource, failed: (s: PlayableSource) => boolean = () => false): PlayableSource | undefined {
  const hash = infoHashOf(current.url);
  const group = releaseGroup(current.filename);
  const sameAddon = (s: PlayableSource) => s.addon === current.addon;
  const sameQuality = (s: PlayableSource) => sameAddon(s) && s.label === current.label;
  const pick = (list: readonly PlayableSource[]) =>
    (hash ? list.find((s) => infoHashOf(s.url) === hash) : undefined) ??
    (current.bingeGroup ? list.find((s) => s.bingeGroup === current.bingeGroup) : undefined) ??
    (group ? list.find((s) => sameQuality(s) && releaseGroup(s.filename) === group) : undefined) ??
    list.find(sameQuality) ??
    list.find(sameAddon) ??
    list[0];
  // Sources that failed recently for that episode only if nothing else is left.
  return pick(sources.filter((s) => !failed(s))) ?? pick(sources);
}

/** Words after the last dash that are part of a release's format, not its group ("WEB-DL"). */
const NOT_GROUPS = new Set(['dl', 'rip', 'hd', 'sd', 'dts', 'ma', 'audio']);

/**
 * A release's group, from its file name: the tag after the last dash, as in
 * "Show.S01E02.1080p.WEB-DL.x265-GROUP.mkv" (lowercased), or undefined.
 */
export function releaseGroup(filename: string | undefined): string | undefined {
  const tag = /-([A-Za-z0-9]{2,24})(?:\[[^\]]*\])?(?:\.[A-Za-z0-9]{2,4})?$/.exec(filename?.trim() ?? '')?.[1]?.toLowerCase();
  return tag && !NOT_GROUPS.has(tag) ? tag : undefined;
}

/**
 * After a source fails: the best-ranked one that isn't `current` and hasn't
 * been tried, preferring ones that didn't fail lately and fit the autoplay
 * limits. Never an
 * uncached debrid source: switching is automatic, and it would only play the
 * service's "downloading" clip.
 */
export function nextSource(sources: readonly PlayableSource[], current: PlayableSource, tried: ReadonlySet<string>, failed: (s: PlayableSource) => boolean = () => false): PlayableSource | undefined {
  const untried = sources.filter((s) => s.id !== current.id && !tried.has(s.id) && s.autoplay !== 'uncached');
  return untried.find((s) => !failed(s) && !s.autoplay) ?? untried.find((s) => !failed(s)) ?? untried[0];
}

/**
 * Whether an episode may start by itself: only once it has surely aired. A
 * missing, malformed or future air date means it's offered, not started
 * (it may not be out, and its sources may be fakes). With its exact air time
 * known (`exactAt`, see catalog/air-times.ts), that decides instead of the
 * day. An episode from the person's own Jellyfin or Plex server always may:
 * its file is there.
 */
export function airedForAutoplay(episode: { id?: string | undefined; released?: string | undefined; airs?: string | undefined }, now: number, exactAt?: number): boolean {
  if (episode.id && (isJellyfinId(episode.id) || isPlexId(episode.id))) return true;
  if (exactAt !== undefined) return exactAt <= now;
  if (episode.airs || !episode.released || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(episode.released)) return false;
  const at = releasedAt(episode.released);
  return !Number.isNaN(at) && at <= now;
}

/** What plays after the current movie or episode: the queue's first item, or the series' next episode. */
export type UpNext = { kind: 'queue'; item: QueueItem } | { kind: 'episode'; episode: EpisodeRef };

/**
 * The queue comes first, for movies and episodes alike; with nothing queued,
 * a series goes on to its next episode as before. Live channels, catch-up and
 * trailers don't lead into the queue.
 */
export function chooseUpNext(head: QueueItem | undefined, following: EpisodeRef | undefined, playing: { live?: boolean | undefined; replay?: boolean | undefined; trailer?: boolean | undefined }): UpNext | undefined {
  if (head && !playing.live && !playing.replay && !playing.trailer) return { kind: 'queue', item: head };
  return following ? { kind: 'episode', episode: following } : undefined;
}

/** Whether two choices are the same thing to play. */
export function sameUpNext(a: UpNext | undefined, b: UpNext | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'queue') return b.kind === 'queue' && a.item.id === b.item.id;
  return b.kind === 'episode' && a.episode.episode.id === b.episode.episode.id;
}

/**
 * A saved volume (0 up to the loudest volume boost preset, above 100 only
 * saved with a boost on) and mute, or null if it's missing or invalid. The player clamps it to what's allowed now.
 */
export function parseVolume(value: unknown): { volume: number; muted: boolean } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { volume, muted } = value as Record<string, unknown>;
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > MAX_VOLUME_BOOST) return null;
  return { volume, muted: muted === true };
}

/** The countdown setting as seconds; 0 means off (the card still shows, without counting down). */
export function countdownSeconds(value: unknown): number {
  return typeof value === 'number' && [0, 5, 10, 15].includes(value) ? value : DEFAULT_COUNTDOWN;
}

/** Settings → Playback → Autoplay next episode: count down and play, wait for the viewer, or no Next Up card. */
export type AutoplayMode = 'always' | 'ask' | 'never';

/** The saved choice; the older on/off switch saved true (Always) or false (Never). */
export function parseAutoplayMode(value: unknown): AutoplayMode {
  if (value === false || value === 'never') return 'never';
  return value === 'ask' ? 'ask' : 'always';
}

/**
 * Whether the Next Up countdown holds for now: while a panel is open, or
 * while paused, but not once the episode has ended: mpv pauses on the last
 * frame by itself then (keep-open), and the next one should still start.
 * With the credits unknown (`untilEnd`: seconds left of the episode), it also
 * holds until it would run out at the end: the card comes at a guess (94 %),
 * which can fall before a sitcom's last scene.
 */
export function countdownWaits(state: { paused: boolean; ended: boolean; panelOpen: boolean; untilEnd?: number | undefined; remaining?: number }): boolean {
  if (state.panelOpen || (state.paused && !state.ended)) return true;
  return !state.ended && state.untilEnd !== undefined && state.remaining !== undefined && state.untilEnd > state.remaining;
}

/** "Stop after N episodes": how many autoplayed episodes in a row before "Still watching?"; 0 is off. */
export const AUTOPLAY_LIMITS = [0, 2, 3, 4, 5] as const;
export const DEFAULT_AUTOPLAY_LIMIT = 3;
export function parseAutoplayLimit(value: unknown): number {
  // 6 was offered before 5; it keeps asking at the nearest choice still offered.
  if (value === 6) return 5;
  return AUTOPLAY_LIMITS.find((n) => n === value) ?? DEFAULT_AUTOPLAY_LIMIT;
}

/** Whether to ask "Still watching?" instead of playing on, after `chain` episodes autoplayed in a row. */
export const askStillWatching = (chain: number, limit: number) => limit > 0 && chain >= limit;

/**
 * Counts episodes started by the countdown in a row. Starting one by hand,
 * or any key or click in the player, starts the count again.
 */
export function createAutoplayChain() {
  let chain = 0;
  return {
    /** An episode started: by the countdown (`automatic`) or by the viewer. */
    played(automatic: boolean): void {
      chain = automatic ? chain + 1 : 0;
    },
    interacted(): void {
      chain = 0;
    },
    count: () => chain,
    /** Whether the countdown's end should ask "Still watching?" instead of playing on. */
    shouldAsk: (limit: number) => askStillWatching(chain, limit),
  };
}

/** Settings → Playback keys the player reads. */
export const PLAYBACK_SETTINGS = {
  /** 'always' (default), 'start-over' or 'ask'. */
  resume: 'playback.resume',
  /** 'always' (default), 'ask' or 'never' (see `parseAutoplayMode`; older saves hold true or false). */
  autoplay: 'playback.autoplay',
  /** Autoplayed episodes in a row before asking "Still watching?": 0 (off), 2, 3 (default), 4 or 5. */
  autoplayLimit: 'playback.autoplay-limit',
  /** Seconds before the next episode starts: 0 (off), 5, 10 (default) or 15. */
  countdown: 'playback.next-up-countdown',
  /** When Next Up appears without known credits (see `parseNextUpAt`). */
  nextUpAt: 'playback.next-up-at',
  /** 'card' (default) or 'panel' (see `parseNextUpStyle`). */
  nextUpStyle: 'playback.next-up-style',
  /** Whether to ask TheIntroDB for skip times (default true). */
  skipLookup: 'playback.skip-lookup',
  /** Skip intros and recaps without asking (default false). */
  autoSkip: 'playback.auto-skip',
  /** What Play does: 'best' (default) starts the best-ranked source, 'choose' opens the picker. */
  play: 'playback.play',
  /** Pause when Orbit is minimised (default true). */
  pauseOnMinimize: 'playback.pause-minimized',
  /** When a source fails, try the next one (default true) or show the error. */
  autoSwitch: 'playback.auto-switch',
  /** The next episode keeps to the same source and release when it has one (default true), or plays the best-ranked. */
  sameSource: 'playback.same-source',
  /** Closing the player leaves full screen (default) or stays in it (true). */
  keepFullscreen: 'playback.keep-fullscreen',
} as const;

/** Settings → Video → Hardware decoding: 'auto' (default) or 'off'. */
export const HWDEC_KEY = 'video.hwdec';
