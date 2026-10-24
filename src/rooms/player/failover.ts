/**
 * When a source fails — it won't open, errors while playing, shows no
 * picture within 45 seconds, or stalls for 20 seconds — the player moves to
 * the next best source (Settings → Playback → When a source fails), keeping
 * the viewer's place. A debrid placeholder (a short clip saying the torrent
 * is being downloaded) counts as a failure too. Up to three automatic tries per movie or episode, so a
 * dead title can't cycle through every addon forever. Failed sources are
 * also remembered for a while (see failed-sources.ts), so the next attempt
 * ranks them last, and so are their hosts (see host-health.ts).
 */
import { runtimeMinutes } from '../../catalog/runtime';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { hostHealth, hostOf } from '../../lib/host-health';
import { failedRecently, loadFailures, markFailed, markPlayed, whereKey, type FailureReason } from './failed-sources';
import type { PlayRequest } from './index';
import { nextSource } from './next-up';
import type { PlayableSource } from './panels';
import { isTorrent } from './torrent';

/** No picture this long after asking for a web source counts as a failure. */
const START_TIMEOUT_MS = 45_000;
/** Buffering this long while playing counts as a failure. */
const STALL_MS = 20_000;
export const MAX_AUTO_SWITCHES = 3;

/** Why a source gave way, for the note about the next one. */
const WHY = { failed: 'player.failover.failed', slow: 'player.failover.slow', stalled: 'player.failover.stalled', placeholder: 'player.failover.placeholder' } as const satisfies Record<FailureReason, string>;

/**
 * Whether a file `duration` seconds long is a debrid service's placeholder
 * rather than the movie or episode: they answer a torrent they haven't cached
 * with a clip of a few seconds. Real episodes are longer than a minute and
 * real movies longer than five, unless the title's runtime says it's that short.
 */
export function looksLikePlaceholder(request: Pick<PlayRequest, 'title' | 'episode' | 'live' | 'replay' | 'trailer' | 'local' | 'link'>, duration: number): boolean {
  if (request.live || request.replay || request.trailer || request.local || request.link || !(duration > 0)) return false;
  const shortest = request.episode ? 60 : 300;
  const runtime = runtimeMinutes(request.title.runtime) * 60;
  return duration < shortest && !(runtime > 0 && runtime <= shortest);
}

/**
 * An end this close to a known length (seconds, or this share of it, whichever is more) is the real end.
 * Anything before it is the stream dropping: credits are short, and an episode's last scene can come after
 * 85 % of it (a 21-minute episode's last three minutes).
 */
const END_SLACK_S = 30;
const END_SLACK_SHARE = 0.02;
/** Where the last stretch starts: a file stopping twice at the same moment past here really ends there. */
const LAST_STRETCH = 0.85;
/** Two stops this many seconds apart are at the same moment. */
const SAME_SPOT_S = 5;

/**
 * Whether mpv reaching the end at `timePos` of `duration` is a stream that
 * stopped early (a debrid or streaming-server session dropped mid-file, so
 * mpv's reconnect hit an error and it read that as the end) rather than the
 * movie or episode ending. Once known credits have started (`inCredits`) it's
 * the end. Live TV, catch-up, trailers, files on this PC, pasted links and
 * downloads end where they end.
 */
export function endedEarly(request: Pick<PlayRequest, 'live' | 'replay' | 'trailer' | 'local' | 'link'> & { source: { url: string } }, timePos: number | null, duration: number | null, inCredits = false): boolean {
  if (request.live || request.replay || request.trailer || request.local || request.link || request.source.url.startsWith('orbit-download:')) return false;
  if (inCredits || timePos === null || !duration || !(duration > 0)) return false;
  return timePos < duration - Math.max(END_SLACK_S, duration * END_SLACK_SHARE);
}

/**
 * What mpv reaching the end of a file means: a debrid placeholder clip no
 * other source replaced (`placeholder`, see `looksLikePlaceholder`), a stream
 * that stopped early (see `endedEarly`), or the movie or episode's real end.
 * Only `done` marks it watched or lets anything play next.
 */
export function endOfFile(request: Parameters<typeof endedEarly>[0], placeholder: boolean, timePos: number | null, duration: number | null, inCredits = false): 'placeholder' | 'early' | 'done' {
  if (placeholder) return 'placeholder';
  return endedEarly(request, timePos, duration, inCredits) ? 'early' : 'done';
}

/** Played this far (seconds) past where a stopped stream was reopened, it counts as healthy again. */
export const EARLY_RETRY_RESET_S = 10 * 60;

/**
 * One reopen for a stream that stopped early (see `endedEarly`), per source
 * (by title, episode and address): a second stop soon after gives up on it.
 * A stop after `EARLY_RETRY_RESET_S` of playing on past the reopen (a session
 * dropping again hours later) gets a reopen of its own.
 */
export function createEarlyStopRetry() {
  let last: { key: string; at: number } | null = null;
  return {
    /** The stream `key` stopped early at `at` seconds: true to reopen it there, false to give up. */
    reopen(key: string, at: number): boolean {
      if (last?.key === key && at < last.at + EARLY_RETRY_RESET_S) return false;
      last = { key, at };
      return true;
    },
    /**
     * The stream `key` stopped again in the last stretch of `duration`, at the
     * moment it was reopened from: the file really ends there (its length was
     * overstated), so it's the end rather than a failure.
     */
    endsHere(key: string, at: number, duration: number): boolean {
      return last?.key === key && at >= duration * LAST_STRETCH && Math.abs(at - last.at) <= SAME_SPOT_S;
    },
  };
}

/** Reconnects to a live channel whose stream ended, at most this many within `LIVE_RECONNECT_WINDOW_MS`. */
export const LIVE_RECONNECTS = 3;
export const LIVE_RECONNECT_WINDOW_MS = 5 * 60_000;

/**
 * A live channel has no end: mpv reaching one means the provider's stream dropped (with keep-open
 * it holds the last frame, frozen). It's opened again, a few times per channel (by `key`) within a
 * few minutes; past that it's down, and the error (with Try again) shows instead.
 */
export function createLiveReconnect() {
  let key = '';
  let times: number[] = [];
  return {
    /** The stream `key` ended at `now` (ms): true to open it again, false to give up. */
    reconnect(next: string, now: number): boolean {
      if (next !== key) {
        key = next;
        times = [];
      }
      times = times.filter((at) => now - at < LIVE_RECONNECT_WINDOW_MS);
      if (times.length >= LIVE_RECONNECTS) return false;
      times.push(now);
      return true;
    },
    /** Tried again by hand: it gets its reconnects back. */
    reset(): void {
      times = [];
    },
  };
}

/**
 * Where the movie or episode has got to, for going on from another source (or the same one
 * again) after a failure. From the moment a file is asked for it's where that file was asked
 * to start: a torrent can fail before its file ever reaches the player. Once it plays, it's
 * mpv's position; a file that ends with an error then reports none, and the last one is kept.
 */
export function createPlace() {
  let at: number | undefined;
  return {
    /** A file is being asked for, from `from` (undefined: the start). */
    asked(from: number | undefined): void {
      at = from;
    },
    /** mpv's position while the file plays. */
    played(timePos: number | null): void {
      if (timePos !== null) at = timePos;
    },
    at: () => at,
  };
}

export interface FailoverHost {
  /** Settings → Playback: try the next source (default) or show the error. */
  enabled(): boolean;
  request(): PlayRequest;
  /** Where to pick up: the playing position, or where the failed source was asked to start. */
  position(): number | undefined;
  switchTo(source: PlayableSource, at: number | undefined): void;
  /** A stall no other source could take over from (a live channel has none): the player may reconnect. */
  stalled?(): void;
  /** No first frame in time and no other source to move to: the player says so rather than spin on. */
  slow?(): void;
}

/**
 * A source as failover remembers it: by addon and address, not id, since late
 * sources renumber the list (see late-sources.ts).
 */
const sourceKey = (s: PlayableSource) => `${s.addon}\n${s.url}`;

export function createFailover(host: FailoverHost) {
  let tried = new Set<string>();
  let key = '';
  let switches = 0;
  let startTimer: number | undefined;
  let stallTimer: number | undefined;
  /** This file's stall already counted as a failure: it isn't counted again every 20 s while it stays stalled. */
  let stalledOut = false;
  /** Running while a stalled-out file plays smoothly again: a whole STALL_MS of it ends that stall, so a later one counts. */
  let recoveredTimer: number | undefined;
  /** This file is a debrid placeholder: its clip showing a frame isn't the source playing. */
  let placeholder = false;

  const clear = () => {
    window.clearTimeout(startTimer);
    window.clearTimeout(stallTimer);
    window.clearTimeout(recoveredTimer);
    startTimer = stallTimer = recoveredTimer = undefined;
  };

  const where = (request: PlayRequest) => whereKey(request.title.id, request.episode?.episode.id);
  /** Live channels, catch-up, trailers, files from this PC and pasted links have no other sources to rank. */
  const remembers = (request: PlayRequest) => !request.live && !request.replay && !request.trailer && !request.local && !request.link;

  /** Moves to the next source; false if switching is off, used up, or there's nowhere to go. */
  function recover(why: keyof typeof WHY): boolean {
    const request = host.request();
    if (why === 'placeholder') placeholder = true;
    if (remembers(request)) {
      markFailed(where(request), request.source, why);
      hostHealth.failed(hostOf(request.source.url, request.source.addon));
    }
    // Counted once: a source that stays on screen with its error mustn't also fail as slow or stalled later
    // (a second failure would mark its host unhealthy, see host-health.ts).
    clear();
    if (!host.enabled() || request.live || request.replay || request.local || request.link || switches >= MAX_AUTO_SWITCHES) return false;
    const triedIds = new Set(request.sources.filter((s) => tried.has(sourceKey(s))).map((s) => s.id));
    const next = nextSource(request.sources, request.source, triedIds, failedRecently(where(request)));
    if (!next) return false;
    switches++;
    const place = request.sources.indexOf(next) + 1;
    toast(t(WHY[why], { addon: next.addon, place, total: request.sources.length }));
    host.switchTo(next, host.position());
    return true;
  }

  return {
    recover,
    /** A source is being opened. A new movie or episode starts a fresh set of tries. */
    opening(): void {
      clear();
      stalledOut = false;
      placeholder = false;
      const { title, episode, source, sources } = host.request();
      const now = `${title.id}/${episode?.episode.id ?? ''}`;
      if (now !== key) {
        key = now;
        tried = new Set();
        switches = 0;
      }
      // As playing, and as listed (picking another file of a torrent changes its address but keeps its id).
      tried.add(sourceKey(source));
      for (const listed of sources) if (listed.id === source.id) tried.add(sourceKey(listed));
      void loadFailures();
    },
    /**
     * The source is being handed to the player: from here, no first frame in time counts as slow. This is
     * separate from `opening` so the clock doesn't run while the resume prompt waits for the person's answer.
     */
    waiting(): void {
      window.clearTimeout(startTimer);
      startTimer = undefined;
      const { source, live, replay, local } = host.request();
      // Torrents wait for peers on their own terms (see torrent.rs).
      if (!live && !replay && !local && !isTorrent(source.url)) startTimer = window.setTimeout(() => recover('slow') || host.slow?.(), START_TIMEOUT_MS);
    },
    /** The first frame showed. */
    started(): void {
      window.clearTimeout(startTimer);
      startTimer = undefined;
      stalledOut = false;
      const request = host.request();
      // A placeholder with nowhere to switch to stays on screen with its error; it stays failed too.
      if (remembers(request) && !placeholder) {
        markPlayed(where(request), request.source);
        hostHealth.succeeded(hostOf(request.source.url, request.source.addon));
      }
    },
    /** Playback status: a long stall (not a pause) counts as a failure. */
    status(started: boolean, buffering: boolean, paused: boolean): void {
      if (!(started && !buffering && !paused)) {
        window.clearTimeout(recoveredTimer);
        recoveredTimer = undefined;
      } else if (stalledOut) {
        recoveredTimer ??= window.setTimeout(() => {
          recoveredTimer = undefined;
          stalledOut = false;
        }, STALL_MS);
      }
      if (started && buffering && !paused) {
        if (stalledOut) return;
        stallTimer ??= window.setTimeout(() => {
          stallTimer = undefined;
          stalledOut = true;
          if (!recover('stalled')) host.stalled?.();
        }, STALL_MS);
      } else if (stallTimer !== undefined) {
        window.clearTimeout(stallTimer);
        stallTimer = undefined;
      }
    },
    stop: clear,
  };
}
