/**
 * Skip intro in the player: keeps the playing file's chapters, TheIntroDB's
 * times and (for anime, when turned on) AniSkip's, and shows the Skip button (or skips, or does nothing,
 * as Settings → Playback says for each kind) while a segment plays. Credits
 * that run to the end offer the next episode instead. The timing rules live
 * in skip.ts.
 *
 * It also learns where intros are from the person's own skips in a series,
 * and offers Skip intro there in later episodes that have no intro from
 * either source (see learned-skips.ts).
 *
 * For a few seconds after a skip (automatic or pressed), the same button
 * offers "Back to 1:23"; going back plays that segment rather than skipping
 * it again. A button up for a while steps back while the controls are
 * hidden, and returns with them (it stays focusable throughout).
 *
 * Settings → Playback → Skipping also decides how a skip looks (a short fade,
 * see skip-transition.ts), how long the button waits into a segment, and how
 * far before a segment's end a skip lands (see skip-tuning.ts).
 */
import { invoke } from '@tauri-apps/api/core';
import type { Title } from '../../catalog/titles';
import { toast } from '../../components/toast';
import { animeIdentity } from '../../library/anilist-rules';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { isAndroid } from '../../lib/platform';
import type { EpisodeRef } from '../detail/title-actions';
import { reducedMotion } from '../../theme/appearance';
import './graduated.css';
import { addSeek, learnedSkips, offeredIntro, RUN_GAP_MS, skippedIntro, type SeekRun } from './learned-skips';
import { formatTime } from './format';
import { createSkipTransition } from './skip-transition';
import { ANISKIP_KEY, aniSkipSegments, buttonDue, landing, parseAniSkip, parseSkipButtonDelay, parseSkipLanding, parseSmoothSkip, SKIP_BUTTON_DELAY_KEY, SKIP_LANDING_KEY, SMOOTH_SKIP_KEY } from './skip-tuning';
import { activeSegment, AUTO_SKIP_DELAY_KEY, autoSkipLeft, chapterSegments, merge, normalize, parseAutoSkipDelay, parseSkipModes, runsToEnd, skipProminence, SKIP_LABELS, tucked, UNDO_MS, undoOffered, type Chapter, type LooseSegment, type Segment, type SkipModes, type SkipUndo } from './skip';

export interface SkipHost {
  /** Where playback is; nothing shows until the file has started. */
  position(): { timePos: number | null; duration: number | null; started: boolean };
  /** True when the Next Up card handles the credits (there's an episode to go to). */
  creditsHandedOff(): boolean;
  seek(seconds: number): void;
  /** What plays next, named for the button ("Next episode"), if anything does. */
  next(): string | null;
  playNext(): void;
  /** Where focus goes if the Skip button disappears while focused. */
  focusFallback(): void;
}

const SKIPPED = {
  intro: 'player.skip.skipped-intro',
  recap: 'player.skip.skipped-recap',
  credits: 'playerplus.skip.skipped-credits',
  preview: 'playerplus.skip.skipped-preview',
} as const;

export function createSkipController(host: SkipHost) {
  let chapters: Chapter[] = [];
  let online: LooseSegment[] = [];
  /** AniSkip's times for the anime episode playing (see skip-tuning.ts). */
  let anime: LooseSegment[] = [];
  let autoSkipped = new Set<string>();
  let shown: Segment | undefined;
  let lookup = true;
  let modes: SkipModes = parseSkipModes(undefined, undefined);
  let asked = 0;
  /** The button plays what's next rather than skipping (credits running to the end). */
  let offersNext = false;
  /** The segment the button is up for, and where playback was when it appeared (see `skipProminence`). */
  let shownFor: { key: string; at: number } | undefined;
  /** Settings → Playback → Learn where I skip intros. */
  let learn = true;
  /** The series whose intro is learned and offered: an episode's show (not a special's), else none. */
  let series: string | undefined;
  /** Whether TheIntroDB has answered (or wasn't asked), so a learned intro doesn't show just before its times arrive. */
  let looked = true;
  /** The person's skip in progress (see learned-skips.ts `addSeek`), for `runFor`, noted once it settles. */
  let run: SeekRun | undefined;
  let runFor: string | undefined;
  let settle: number | undefined;
  /** Whether the shown button is for a learned intro. */
  let shownLearned = false;
  /** The last skip, while it can still be taken back. */
  let undo: SkipUndo | undefined;
  let undoTimer: number | undefined;
  /** Settings → Playback → Skipping: seconds an automatic skip waits, read when the player opens. */
  let autoDelay = 0;
  /** Until the delay is read, an automatic segment waits for it rather than skipping at once. */
  let delayKnown = false;
  void settings
    .get(AUTO_SKIP_DELAY_KEY)
    .then((value) => (autoDelay = parseAutoSkipDelay(value)))
    .catch(() => {})
    .finally(() => (delayKnown = true));
  /** Settings → Playback → Skipping: whether to ask AniSkip, how long the button waits, and how far before the end a skip lands. */
  const aniSkipOn = settings
    .get(ANISKIP_KEY)
    .then(parseAniSkip)
    .catch(() => false);
  let buttonDelay = 0;
  let landingOffset = 0;
  const transition = createSkipTransition(() => host.position().timePos);
  void Promise.all([SKIP_BUTTON_DELAY_KEY, SKIP_LANDING_KEY, SMOOTH_SKIP_KEY].map((key) => settings.get(key).catch(() => undefined))).then(([delay, offset, smooth]) => {
    buttonDelay = parseSkipButtonDelay(delay);
    landingOffset = parseSkipLanding(offset);
    transition.configure(parseSmoothSkip(smooth));
  });
  /** The segment playing when it was reached, for the button's wait. */
  let reached: { key: string; at: number } | undefined;
  /** The segment last skipped and where it lands (it may land before the end): the button isn't offered again there. `pending` until the seek is made. */
  let landed: { key: string; at: number; pending: boolean } | undefined;
  /** An automatic skip counting down: its segment, and where playback was when it began. */
  let counting: { key: string; since: number } | undefined;
  /** Any key stops the countdown; the Skip button stays, and the segment plays on. */
  const cancelCountdown = () => {
    if (!counting) return;
    autoSkipped.add(counting.key);
    stopCounting();
    if (shown && !button.hidden) button.textContent = SKIP_LABELS[shown.kind];
  };
  function stopCounting(): void {
    counting = undefined;
    document.removeEventListener('keydown', cancelCountdown, true);
  }

  const button = h('button', { class: 'skip-segment', hidden: true });
  /** Android: the label the player screen's own Skip button has, which stands in for this one there. */
  let mirrored: string | null = null;
  const mirror = (label: string | null) => {
    if (!isAndroid || label === mirrored) return;
    mirrored = label;
    void invoke('player_skip_button', { label }).catch(() => {});
  };
  const keyOf = (segment: Segment) => `${segment.kind}@${segment.start}`;
  /**
   * Skips `segment` from `from`, offering the way back unless it runs to the
   * end (what follows takes over there). It fades out and back when Smooth
   * skip is on, naming what was skipped; without the fade, `announce` says it.
   */
  function skipPast(segment: Segment, from: number | null, announce = false): void {
    const { duration } = host.position();
    const key = keyOf(segment);
    const to = landing(segment, duration, landingOffset);
    clearUndo();
    const mark = { key, at: to, pending: true };
    landed = mark;
    if (announce && !transition.fades()) toast(t(SKIPPED[segment.kind]));
    transition.skip(to, t(SKIPPED[segment.kind]), (seconds) => {
      mark.pending = false;
      if (from !== null && !(duration && runsToEnd(segment, duration))) {
        undo = { key, to: from, landed: seconds, until: Date.now() + UNDO_MS };
        // Paused, no status comes to take it down: the timer does.
        undoTimer = window.setTimeout(() => {
          undo = undefined;
          refresh();
        }, UNDO_MS);
      }
      host.seek(seconds);
    });
  }
  function clearUndo(): void {
    window.clearTimeout(undoTimer);
    undo = undefined;
  }
  /** Plays the segment just skipped, from where it was skipped, and leaves it to play this time. */
  function takeBack(taken: SkipUndo): void {
    clearUndo();
    landed = undefined;
    autoSkipped.add(taken.key);
    host.seek(taken.to);
  }
  button.addEventListener('click', () => {
    if (undo) takeBack(undo);
    else if (offersNext) host.playNext();
    else if (shown) {
      learnFromButton(shown);
      skipPast(shown, host.position().timePos);
    }
  });

  /** Where the intro, recap and credits are (the file's chapters, then TheIntroDB, then AniSkip: see skip.ts), and the learned intro if that's used. */
  function parts(): { all: Segment[]; learned: Segment | undefined } {
    const duration = host.position().duration ?? 0;
    const known = merge(merge(normalize(chapterSegments(chapters, duration), duration), normalize(online, duration)), aniSkipSegments(anime, duration));
    const intro = learn && series && looked && !known.some((s) => s.kind === 'intro') ? learnedSkips.get(series) : undefined;
    const learned = intro && normalize([offeredIntro(intro)], duration)[0];
    return { all: learned ? merge(known, [learned]) : known, learned };
  }
  const segments = (): Segment[] => parts().all;

  /** Notes the skip in progress, if it passed over an intro. */
  function flush(): void {
    window.clearTimeout(settle);
    const intro = run && skippedIntro(run);
    if (intro && runFor) learnedSkips.learn(runFor, intro);
    run = undefined;
  }

  /** Skip pressed on an intro: that intro is learned (a learned one is confirmed as it is, wherever it was pressed). */
  function learnFromButton(segment: Segment): void {
    if (!learn || !series || segment.kind !== 'intro') return;
    const intro = shownLearned ? learnedSkips.get(series) : skippedIntro({ from: segment.start, to: segment.end });
    if (intro) learnedSkips.learn(series, intro);
  }

  /** Shows the Skip button inside a segment, or skips it, as that kind's setting says. */
  function refresh(): void {
    const { timePos, duration, started } = host.position();
    if (undo && !undoOffered(undo, timePos, Date.now())) clearUndo();
    if (undo) {
      // The way back stands in for any other button while it's offered.
      stopCounting();
      button.hidden = false;
      button.removeAttribute('data-tucked');
      button.textContent = t('pstream.skip.back', { time: formatTime(undo.to) });
      button.dataset.prominence = skipProminence(0, 0, Infinity, reducedMotion());
      mirror(button.textContent);
      return;
    }
    const { all, learned } = parts();
    let segment = started && timePos !== null ? activeSegment(all, timePos) : undefined;
    if ((segment?.kind === 'credits' || segment?.kind === 'preview') && host.creditsHandedOff()) segment = undefined;
    if (segment && modes[segment.kind] === 'off') segment = undefined;
    // Just skipped (and landed before its end, or about to seek): not offered again.
    if (segment && landed?.key === keyOf(segment) && (landed.pending || (timePos !== null && timePos >= landed.at - 0.5))) segment = undefined;
    const next = segment && duration && runsToEnd(segment, duration) ? host.next() : null;
    shownLearned = !!segment && segment === learned;
    /** Seconds the automatic skip still waits, shown on the button. */
    let left = 0;
    // A learned intro is a guess from another episode: it's offered, never skipped without asking.
    if (segment && modes[segment.kind] === 'auto' && !shownLearned && delayKnown) {
      // Once per segment: seeking back into it means the viewer wants to watch.
      const key = keyOf(segment);
      if (!autoSkipped.has(key)) {
        // Counted from where the segment was reached (again, after seeking back before that).
        if (autoDelay > 0 && timePos !== null && (counting?.key !== key || timePos < counting.since)) {
          if (!counting) document.addEventListener('keydown', cancelCountdown, true);
          counting = { key, since: timePos };
        }
        left = counting && timePos !== null ? autoSkipLeft(counting.since, timePos, autoDelay) : 0;
        if (!left) {
          stopCounting();
          autoSkipped.add(key);
          mirror(null);
          // Credits to the end skip to the end too: what follows is then up to autoplay, as always.
          return skipPast(segment, timePos, true);
        }
      }
    }
    if (!left && counting) stopCounting();
    if (segment && timePos !== null) {
      const key = keyOf(segment);
      if (reached?.key !== key) reached = { key, at: timePos };
      // Settings → Skipping: the button waits a moment into the segment (a countdown to an automatic skip doesn't).
      if (!left && !buttonDue(reached.at, timePos, buttonDelay)) segment = undefined;
    } else reached = undefined;
    shown = segment;
    offersNext = !!segment && !!next;
    if (!segment && button === document.activeElement) host.focusFallback();
    button.hidden = !segment;
    if (!segment || timePos === null) {
      mirror(null);
      return void (shownFor = undefined);
    }
    button.textContent = left ? t('playerplus.skip.auto-in', { label: SKIP_LABELS[segment.kind], seconds: left }) : (next ?? SKIP_LABELS[segment.kind]);
    mirror(button.textContent);
    const key = keyOf(segment);
    if (shownFor?.key !== key) shownFor = { key, at: timePos };
    button.dataset.prominence = skipProminence(shownFor.at, timePos, segment.end, reducedMotion());
    // Not while it counts down to an automatic skip: that's worth seeing.
    button.toggleAttribute('data-tucked', !left && tucked(shownFor.at, timePos));
  }

  return {
    element: button,
    /** The smooth skip's black layer, over the video and under the controls. */
    fade: transition.element,
    segments,
    /** The player is closing: a countdown stops listening for keys, the way back's timer stops, and a fade under way ends. */
    dispose(): void {
      stopCounting();
      clearUndo();
      transition.cancel();
    },
    /** Settings → Playback: look times up online; what to do for each kind of segment; learn intros from skips. */
    configure(options: { lookup: boolean; modes: SkipModes; learn: boolean }): void {
      lookup = options.lookup;
      modes = options.modes;
      learn = options.learn;
    },
    /**
     * The person seeked (seek bar, ←/→, number keys): to `to`, or `by`
     * seconds. Forward seeks near the start, alone or in quick succession,
     * teach this series' intro.
     */
    userSeek(seek: { to: number } | { by: number }): void {
      const { timePos, duration, started } = host.position();
      if (!learn || !series || !started || timePos === null) return;
      const now = Date.now();
      // mpv reports the new position a moment later: a press right after another goes on from where that one went.
      const from = run && now - run.at <= RUN_GAP_MS ? run.to : timePos;
      const to = Math.max(0, Math.min(duration ?? Infinity, 'to' in seek ? seek.to : from + seek.by));
      window.clearTimeout(settle);
      run = addSeek(run, from, to, now);
      runFor = series;
      if (run) settle = window.setTimeout(flush, RUN_GAP_MS);
    },
    setChapters(next: Chapter[]): void {
      chapters = next;
    },
    /** A new file is loading: it reports its own chapters. */
    newFile(): void {
      chapters = [];
      // A countdown to skipping the last file's segment stops (and stops listening for keys); the new file counts its own.
      stopCounting();
      clearUndo();
      landed = undefined;
      transition.cancel();
    },
    /** A different movie or episode: forget what was skipped and look up its times. */
    newTitle(title: Title, episode: EpisodeRef | undefined): void {
      // A skip still settling belongs to the episode it was made in.
      flush();
      stopCounting();
      clearUndo();
      autoSkipped = new Set();
      online = [];
      anime = [];
      landed = undefined;
      // Specials rarely share the series' intro.
      series = episode && episode.season > 0 ? title.id : undefined;
      if (series) void learnedSkips.load();
      looked = true;
      const id = ++asked;
      const lookups: Promise<void>[] = [];
      // TheIntroDB knows titles by IMDb id; specials (season 0) aren't numbered like the database's.
      if (lookup && /^tt\d+$/.test(title.id) && episode?.season !== 0) {
        lookups.push(
          invoke<LooseSegment[]>('skip_segments', { imdbId: title.id, season: episode?.season ?? null, episode: episode?.episode.number ?? null })
            .then((found) => {
              if (id === asked) online = found;
            })
            .catch((err: unknown) => console.warn('No skip times', err)),
        );
      }
      // AniSkip knows anime episodes by MyAnimeList id, which Rust finds from the title's IMDb, Kitsu or MAL id.
      const animeId = animeIdentity(title.id);
      if (animeId && episode && episode.season > 0) {
        lookups.push(
          aniSkipOn
            .then((on) => (on ? invoke<LooseSegment[]>('aniskip_segments', { id: animeId, season: episode.season, episode: episode.episode.number }) : []))
            .then((found) => {
              if (id === asked) anime = found;
            })
            .catch((err: unknown) => console.warn('No AniSkip times', err)),
        );
      }
      if (!lookups.length) return;
      looked = false;
      void Promise.all(lookups).finally(() => {
        if (id === asked) looked = true;
      });
    },
    /** Picked in the Chapters view: plays `segment` from its start, without skipping it automatically. */
    watch(segment: Segment): void {
      clearUndo();
      landed = undefined;
      stopCounting();
      autoSkipped.add(keyOf(segment));
      host.seek(segment.start);
    },
    /** Shows the Skip button inside a segment, or skips it, as that kind's setting says. */
    update: refresh,
  };
}
