/**
 * Next Up (design): near the end of an episode, a card with the next one and
 * a countdown, while that episode's sources are found. Once the end credits
 * start (when their time is known), the picture shrinks into the top-right
 * corner and the card takes over the rest of the screen, until the next
 * episode plays or the viewer chooses to watch the credits.
 *
 * Settings → Playback → Autoplay: Always counts down, Ask waits for the
 * viewer. "Stop after N episodes": once that many episodes have started on
 * their own in a row, the countdown's end pauses instead and a full-screen
 * "Still watching <show>?" asks before the next one starts; any key or click
 * in the player starts the count again. An episode whose air date is
 * missing, malformed or still to come is offered without a countdown.
 *
 * In a shuffle (see shuffle.ts) the card offers the drawn episode, labelled
 * "Shuffle".
 *
 * With something queued, the card offers the queue's first item instead
 * (a movie or an episode of any title), found and played the same way.
 *
 * The next episode's sources are found well before the card appears (see
 * next-prefetch.ts), so it can start at once.
 */
import { invoke } from '@tauri-apps/api/core';
import type { RoomContext } from '../../app/router';
import { artImage } from '../../components/cards';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { autoCandidates } from '../../lib/autoplay';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import type { Title } from '../../catalog/titles';
import { queueTarget } from '../detail/queue-actions';
import { openStreams, resolveSources } from '../detail/streams';
import type { EpisodeRef } from '../detail/title-actions';
import type { PlayRequest } from './index';
import { failedRecently, whereKey } from './failed-sources';
import { airedForAutoplay, countdownWaits, createAutoplayChain, DEFAULT_AUTOPLAY_LIMIT, DEFAULT_COUNTDOWN, DEFAULT_NEXT_UP_AT, handsOff, pickNextSource, PLAYBACK_SETTINGS, reachedNextUp, sameUpNext, type AutoplayMode, type NextUpAt, type NextUpStyle, type UpNext } from './next-up';
import { createPrefetch } from './next-prefetch';
import { episodeStill } from './next-up-bridge';
import { upNextName, type PlayableSource } from './panels';
import { skipProminence, type Segment } from './skip';
import { reducedMotion } from '../../theme/appearance';
import { isAndroid } from '../../lib/platform';
import { exactAirTime, loadAirTimes } from '../../catalog/air-times';
import './next-up-panel.css';

export interface NextUpHost {
  ctx: RoomContext;
  request(): PlayRequest;
  status(): { timePos: number | null; duration: number | null; paused: boolean };
  /** False until this file shows its first frame (older position updates can still arrive). */
  started(): boolean;
  closed(): boolean;
  /** What plays next: the queue's first item, or the episode after the playing one (see `chooseUpNext`). */
  upNext(): UpNext | undefined;
  segments(): Segment[];
  /** The countdown waits while a panel is open. */
  panelOpen(): boolean;
  /** True when nothing should play next: autoplay is off, or the sleep timer stops at the end. */
  blocked(): boolean;
  /** `finished`: Next Up or the credits handed off, so the episode left counts as watched (see `leftAt`). */
  play(request: PlayRequest, finished: boolean): void;
  /** Whether the next episode is a shuffled one (the card says "Shuffle"). */
  shuffling(): boolean;
  /** Pauses playback, for "Still watching?". */
  pause(): void;
  /** Leaves the player ("Still watching?" → Back). */
  back(): void;
}

interface Prepared {
  title: Title;
  episode?: EpisodeRef | undefined;
  sources: PlayableSource[];
}

export function createNextUp(host: NextUpHost) {
  let countdown = DEFAULT_COUNTDOWN;
  let mode: AutoplayMode = 'always';
  /** The autoplay setting has been read: until then, nothing is looked up early (it may be off). */
  let modeKnown = false;
  let limit = DEFAULT_AUTOPLAY_LIMIT;
  /** Settings → Playback → Keep the same source on the next episode. */
  let sameSource = true;
  /** Settings → Playback → When Next Up appears (credits unknown). */
  let nextUpAt: NextUpAt = DEFAULT_NEXT_UP_AT;
  /** Episodes started by the countdown in a row, with no key or click since. */
  const chain = createAutoplayChain();
  /** "Still watching?" is showing (the countdown ran out at the limit). */
  let asking = false;
  /** Left from "Still watching?" (Back): the countdown had run out, so the episode counts as watched, as its hand-off would have. */
  let leftAsked = false;
  let shown = false;
  let dismissed = false;
  let starting = false;
  let corner = false;
  /** The episode played to its end (mpv then holds the last frame, paused) and hasn't been played on from since. */
  let ended = false;
  /** Where playback was when the card appeared: its Play button starts quiet (see `skipProminence`). */
  let shownAt = 0;
  let remaining = 0;
  /** The countdown waits for the end (credits unknown): the card says what's next, without a number yet. */
  let heldForEnd = false;
  let timer: number | undefined;
  /** What the card offers, and (once found) the title, episode and sources to play it with. */
  let offered: UpNext | undefined;
  let prepared: Promise<Prepared> | undefined;
  let abort: AbortController | undefined;
  /** The title whose air times were asked for. */
  let airTimesFor: string | undefined;
  /** Bumped by `reset`: a Play Next still finding sources when another file starts gives up. */
  let epoch = 0;
  /** The next episode's sources, found early (see next-prefetch.ts). */
  const early = createPrefetch<Prepared>((next, signal) => prepare(next, signal));

  const art = h('span', { class: 'next-up-art' });
  const label = h('span', { class: 'next-up-label' });
  const name = h('span', { class: 'next-up-title' });
  const play = h('button', { class: 'button primary small' }, t('player.next-up.play'));
  play.addEventListener('click', () => void playNext(false, true));
  const cancel = h('button', { class: 'button glass small' }, t('player.next-up.cancel'));
  cancel.addEventListener('click', () => dismiss());
  const card = h('div', { class: 'next-up', role: 'status', hidden: true }, art, h('div', { class: 'next-up-text' }, label, name, h('div', { class: 'next-up-actions' }, play, cancel)));

  // "Still watching?": calm and full screen, over the paused picture.
  const askTitle = h('h2', { class: 'still-watching-title', id: 'still-watching-title' });
  const askNext = h('p', { class: 'still-watching-next' });
  const keepOn = h('button', { class: 'button large primary' }, t('watching.still.continue'));
  keepOn.addEventListener('click', () => {
    hideAsk();
    // The card says it's finding the next one meanwhile.
    shown = true;
    card.hidden = false;
    void playNext(false, true);
  });
  const leave = h('button', { class: 'button large glass' }, t('watching.still.back'));
  leave.addEventListener('click', () => {
    hideAsk();
    leftAsked = true;
    host.back();
  });
  const ask = h(
    'div',
    { class: 'still-watching', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'still-watching-title', hidden: true },
    h('div', { class: 'still-watching-box' }, askTitle, askNext, h('div', { class: 'hero-actions' }, keepOn, leave)),
  );

  function hideAsk(): void {
    asking = false;
    ask.hidden = true;
  }

  /** The countdown ran out with the limit reached: pause, and ask before going on. */
  function askStillWatching(next: UpNext): void {
    // Dismissed, so the card doesn't come back and count down again under the prompt.
    dismiss();
    host.pause();
    asking = true;
    askTitle.textContent = t('watching.still.title', { name: host.request().title.name });
    askNext.textContent = t('watching.still.next', { name: upNextName(next) });
    ask.hidden = false;
    keepOn.focus({ preventScroll: true });
    // Android's player screen steps aside so the question is seen; going on opens it again.
    if (isAndroid) void invoke('player_stop').catch(() => {});
  }

  /** Shrinks the picture into the corner for the credits, or gives it the whole window back. */
  function setCorner(on: boolean): void {
    if (on === corner) return;
    corner = on;
    card.classList.toggle('takeover', on);
    cancel.textContent = on ? t('player.next-up.watch-credits') : t('player.next-up.cancel');
    if (on) play.focus({ preventScroll: true });
    void invoke('player_set_corner', { on }).catch((err: unknown) => console.error('Could not move the picture', err));
  }

  function hide(): void {
    window.clearInterval(timer);
    // Android: the player screen's own Next up button goes too.
    if (isAndroid && shown) void invoke('player_next_up', { label: null }).catch(() => {});
    shown = false;
    card.hidden = true;
    setCorner(false);
  }

  function dismiss(): void {
    dismissed = true;
    hide();
  }

  /** The Play button: quiet when the card appears, prominent after a few seconds or near the end. */
  function graduate(): void {
    const { timePos, duration } = host.status();
    play.dataset.prominence = timePos === null || !duration ? 'prominent' : skipProminence(shownAt, timePos, duration, reducedMotion());
  }

  function renderLabel(): void {
    if (starting) {
      label.textContent = t('player.next-up.finding');
      return;
    }
    const unaired = mode === 'always' && countdown > 0 && !mayAutoplay(offered);
    const text = counting() && !heldForEnd ? t('player.next-up.countdown', { seconds: Math.max(0, remaining) }) : unaired ? t('sources.next-up.unaired') : t('player.next-up.label');
    // A shuffled episode says so, and so does a queued title: it comes before the series' next episode.
    const from = offered?.kind === 'queue' ? t('watching.queue.from-queue') : offered?.kind === 'episode' && host.shuffling() ? t('watching.shuffle.label') : '';
    label.textContent = from ? `${from} · ${text}` : text;
  }

  /**
   * Finds the sources for `next`. A queued item first loads its title's
   * details (episode list included); an episode is of the playing title.
   * With `choose`, only the title: the picker finds the sources.
   */
  function prepare(next: UpNext, signal: AbortSignal, choose = false): Promise<Prepared> {
    if (next.kind === 'episode') {
      const { title } = host.request();
      return resolveSources(title, next.episode, signal)
        .catch(() => [])
        .then((sources) => ({ title, episode: next.episode, sources }));
    }
    return queueTarget(next.item).then(async ({ title, episode }) => ({ title, episode, sources: choose ? [] : await resolveSources(title, episode, signal).catch(() => []) }));
  }

  /** Finds `next`'s sources, starting from what was found early if that was for `next` (see next-prefetch.ts). */
  function findSources(next: UpNext, choose = false): Promise<Prepared> {
    abort?.abort();
    const ahead = early.take(next);
    const controller = (abort = ahead?.abort ?? new AbortController());
    if (!ahead) return prepare(next, controller.signal, choose);
    // Nothing found early (an addon was down, say): asked once more now, as before.
    return ahead.found.then((p) => (p.sources.length || controller.signal.aborted ? p : prepare(next, controller.signal)));
  }

  /** When the playing series' episode `next` airs, to the minute, if known (catalog/air-times.ts). */
  const exactAt = (next: Extract<UpNext, { kind: 'episode' }>) => exactAirTime(host.request().title.id, next.episode.season, next.episode.episode.number, next.episode.episode.released);

  /** Whether `next` may start by itself: an episode only once it has surely aired (else it's offered, not counted down to). */
  const mayAutoplay = (next: UpNext | undefined) => next?.kind !== 'episode' || airedForAutoplay(next.episode.episode, Date.now(), exactAt(next));

  /** An episode whose exact air time is still to come isn't offered at all: it isn't out. */
  const notOutYet = (next: UpNext | undefined) => {
    const at = next?.kind === 'episode' ? exactAt(next) : undefined;
    return at !== undefined && at > Date.now();
  };

  /** With the credits unknown, the seconds left of the episode (the countdown runs out no earlier than its end). */
  function secondsToEnd(): number | undefined {
    if (host.segments().some((s) => s.kind === 'credits' || s.kind === 'preview')) return undefined;
    const { timePos, duration } = host.status();
    return timePos !== null && !!duration ? duration - timePos : undefined;
  }

  /** Whether the card counts down to playing by itself. */
  const counting = () => mode === 'always' && countdown > 0 && mayAutoplay(offered);

  function show(next: UpNext): void {
    const { title } = host.request();
    shown = true;
    shownAt = host.status().timePos ?? 0;
    graduate();
    offered = next;
    remaining = countdown;
    const untilEnd = secondsToEnd();
    heldForEnd = !ended && untilEnd !== undefined && untilEnd > remaining;
    prepared = findSources(next);
    art.replaceChildren();
    // Spoiler protection: the next episode's own picture may be blurred (the show's backdrop never is).
    const image = next.kind === 'episode' ? episodeStill(title, next.episode) : (next.item.title.background ?? next.item.title.poster);
    if (image) art.append(artImage(image, 'art'));
    name.textContent = upNextName(next, title);
    renderLabel();
    card.hidden = false;
    // Android: this card is behind the player screen, which shows a button for it (Enter plays next).
    if (isAndroid) void invoke('player_next_up', { label: `${t('player.next-up.label')}: ${name.textContent}` }).catch(() => {});
    if (counting()) {
      timer = window.setInterval(() => {
        const untilEnd = secondsToEnd();
        const held = !ended && untilEnd !== undefined && untilEnd > remaining;
        if (held !== heldForEnd) {
          heldForEnd = held;
          renderLabel();
        }
        if (countdownWaits({ paused: host.status().paused, ended, panelOpen: host.panelOpen(), untilEnd, remaining })) return;
        remaining -= 1;
        renderLabel();
        if (remaining > 0) return;
        if (chain.shouldAsk(limit)) {
          const upcoming = host.upNext();
          if (upcoming) askStillWatching(upcoming);
          else hide();
          return;
        }
        void playNext(true);
      }, 1000);
    }
  }

  /**
   * Plays the next episode with a matching source, or the queued item with
   * its best source; falls back to the picker if none. `automatic`: the
   * countdown ran out (counts towards "Still watching?"). `finished`: a
   * hand-off (the countdown, the card, the credits), not Next pressed part-way.
   */
  async function playNext(automatic = false, finished = automatic): Promise<void> {
    const next = host.upNext();
    if (!next || starting || (automatic && !mayAutoplay(next))) return;
    finished = handsOff(finished, shown);
    window.clearInterval(timer);
    chain.played(automatic);
    starting = true;
    renderLabel();
    const { source: current } = host.request();
    const started = epoch;
    // Settings → Playback → "When I press Play" applies to a queued item, as when it's played from a page.
    const choose = next.kind === 'queue' && (await settings.get(PLAYBACK_SETTINGS.play).catch(() => null)) === 'choose';
    if (!prepared || choose || !sameUpNext(offered, next)) {
      offered = next;
      prepared = findSources(next, choose);
    }
    const { title, episode, sources: found } = await prepared;
    // Closed, or another source, episode or queue order meanwhile (whose reset aborted this search).
    if (host.closed() || started !== epoch || !sameUpNext(host.upNext(), next)) {
      // Another file starting (see reset) has already cleared `starting`. A queue edit meanwhile hasn't, and would leave "Finding…" up with Next dead.
      if (started === epoch && !host.closed()) {
        starting = false;
        queueChanged();
      }
      return;
    }
    // Only sources an automatic pick may start: within the autoplay limits if any is, never an uncached one (see autoplay.ts).
    const auto = autoCandidates(found);
    // The next episode keeps to the same release (unless Settings say otherwise); another title starts with its best source (recent failures are already last).
    const source = choose ? undefined : next.kind === 'episode' && sameSource ? pickNextSource(auto.list, current, failedRecently(whereKey(title.id, episode?.episode.id))) : auto.list[0];
    if (source) {
      if (auto.fellBack) toast(t('sources.autoplay.outside-limits'));
      return host.play({ title, episode, source, sources: found }, finished);
    }
    if (!choose && found.length) toast(t('sources.autoplay.only-uncached'));
    // No source found automatically (or the picker is wanted): let the user choose, over the player.
    starting = false;
    dismiss();
    openStreams(title, episode ? { episode, ctx: host.ctx } : { ctx: host.ctx });
  }

  /** The queue changed: a card offering something else now (or nothing) gives way to what's next. */
  function queueChanged(): void {
    if (!shown || starting || sameUpNext(offered, host.upNext())) return;
    abort?.abort();
    abort = undefined;
    prepared = undefined;
    offered = undefined;
    hide();
    update();
  }

  /** Shows the card near the end (once), and moves the picture aside during the credits. */
  function update(atEnd = false): void {
    const { timePos, duration, paused } = host.status();
    // Playing again after seeking back from the end is no longer the end.
    if (atEnd) ended = true;
    else if (!paused && timePos !== null && !!duration && timePos < duration - 1) ended = false;
    // A "next time on…" preview after the credits counts as part of them, as it always has.
    const credits = host.segments().find((s) => s.kind === 'credits' || s.kind === 'preview');
    const inCredits = !!credits && timePos !== null && timePos >= credits.start;
    const { title, episode } = host.request();
    // The series' exact air times, so an episode that isn't out yet isn't offered (looked up once, cached).
    if (airTimesFor !== title.id) {
      airTimesFor = title.id;
      void loadAirTimes(title);
    }
    early.check({ playing: `${title.id}/${episode?.episode.id ?? ''}`, next: host.upNext(), allowed: modeKnown && host.started() && !host.blocked() && !dismissed && !shown, timePos, duration, creditsStart: credits?.start });
    const near = atEnd || inCredits || (!!duration && timePos !== null && reachedNextUp(timePos, duration, nextUpAt));
    if (shown) {
      // Seeking back to before where the card appears: it goes (its countdown would start the next
      // episode mid-scene), and comes back there. Not once the next one is being started.
      if (!near && !starting && timePos !== null && !!duration) return hide();
      graduate();
      // Seeking back out of the credits gives the picture its place back.
      return setCorner(inCredits);
    }
    const next = host.upNext();
    if (!host.started() || host.blocked() || !next || dismissed || !near || notOutYet(next)) return;
    show(next);
    setCorner(inCredits);
  }

  return {
    element: card,
    /** The full-screen "Still watching?" prompt (placed above the controls). */
    prompt: ask,
    /** Whether "Still watching?" is up: keys work its buttons, not the player. */
    asking: () => asking,
    /** Whether the player is being left from "Still watching?" (Back): that counts as finishing the episode (see `leavesFinished`). */
    leftAsked: () => leftAsked,
    playNext,
    /** Whether the card is up (also while it takes over for the credits). */
    shown: () => shown,
    /** Whether the picture is in the corner for the credits. */
    inCorner: () => corner,
    /** True once the viewer cancelled the card for this episode. */
    dismissed: () => dismissed,
    /** Settings → Playback: Always / Ask, seconds to count down (0 for none), "Stop after N episodes" (0 for off), keeping the same source, and when and how the card appears. */
    configure(options: { countdown?: number; mode?: AutoplayMode; limit?: number; sameSource?: boolean; at?: NextUpAt; style?: NextUpStyle }): void {
      countdown = options.countdown ?? countdown;
      nextUpAt = options.at ?? nextUpAt;
      // The panel only changes where the card sits; at the credits it takes over the screen either way.
      if (options.style) card.classList.toggle('docked', options.style === 'panel');
      sameSource = options.sameSource ?? sameSource;
      mode = options.mode ?? mode;
      if (options.mode !== undefined) modeKnown = true;
      limit = options.limit ?? limit;
    },
    /** A key or click in the player: the viewer is there, so the "Still watching?" count starts again. */
    interacted(): void {
      chain.interacted();
    },
    update,
    queueChanged,
    /** Another file is starting: forget this episode's card. `sameEpisode`: another source of the same episode, which keeps the next one's sources found early. */
    reset(sameEpisode = false): void {
      early.newFile(sameEpisode);
      epoch++;
      abort?.abort();
      hide();
      dismissed = false;
      starting = false;
      ended = false;
      hideAsk();
      leftAsked = false;
      remaining = 0;
      prepared = undefined;
      offered = undefined;
      abort = undefined;
    },
    /**
     * The profile's limit turned down what was offered: this file plays on, and the card stays away
     * for it, so it doesn't come back and count down to the same refused title again and again.
     */
    refused(): void {
      this.reset(true);
      dismissed = true;
    },
  };
}
