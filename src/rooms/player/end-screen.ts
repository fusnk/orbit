/**
 * A film's end screen, in every player layout (Settings → Playback → When a
 * film ends). Once the credits start (or the film ends, when their time isn't
 * known), the credits shrink into a small card at the top left (mpv draws
 * them there: player_set_corner's "card" spot) with the film's name and a
 * "How did you like it?" rating, and the rest of the screen becomes one film
 * TMDB recommends for it: its backdrop, logo, details and synopsis, Play,
 * My Library and Details, and (with banner trailers on) its trailer after a
 * short countdown. A row of other picks below swaps in for it.
 *
 * Series keep Next Up, and so does a film with something queued after it.
 * Without TMDB (or with nothing left to suggest) only the card shows.
 *
 * The rating is the profile's own stars (library/ratings.ts), the same ones
 * a title page sets: a whole star per button here, refined to half stars on
 * the title page.
 *
 * Nothing here records watching: rating is something the person does by hand,
 * which "Pause watch history" leaves alone.
 */
import { invoke } from '@tauri-apps/api/core';
import { loadMeta } from '../../catalog/service';
import { recommendationsFor, titleCollection } from '../../catalog/tmdb';
import type { Title } from '../../catalog/titles';
import { ageRatingSlot } from '../../components/age-rating';
import { backdropImage } from '../../components/cards';
import { icon } from '../../components/icons';
import { titleHeading } from '../../components/title-logo';
import { toast } from '../../components/toast';
import { isRtl, locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { inLibrary, toggleLibrary } from '../../library/library';
import { onRatingsChange, setUserRating, starFill, userRating } from '../../library/ratings';
import { continueWatching, isWatched } from '../../library/watch';
import { createHeroTrailer, trailersAllowed } from '../detail/hero-trailer';
import { BANNER_TRAILER_KEY } from '../detail/trailer-settings';
import { infoMeta } from './cinema-info';
import { afterEnd, endPicks, endScreenDue, isFilm, nextInFranchise, type FilmEnd } from './end-screen-rules';
import type { Segment } from './skip';
import './end-screen.css';
import { isAndroid } from '../../lib/platform';

/** Seconds counted down before the featured title's trailer starts. */
const TRAILER_COUNTDOWN = 8;
/** How long "Rating saved" stays. */
const SAVED_MS = 2500;

export interface EndScreenHost {
  /** The player root: it gets `end-screen-on` while the screen is up. */
  view: HTMLElement;
  request(): { title: Title; episode?: unknown; live?: boolean | undefined; replay?: boolean | undefined; trailer?: boolean | undefined; local?: boolean | undefined };
  status(): { timePos: number | null; duration: number | null; paused: boolean };
  started(): boolean;
  /** Whether something plays next (the queue): then Next Up has the end. */
  hasUpNext(): boolean;
  segments(): readonly Segment[];
  /** Picture in picture is on: the screen waits until it's off. */
  pip(): boolean;
  /** Pauses the credits (a trailer is playing with its sound). */
  pause(): void;
  /** Plays `title` as Play does on its page. */
  play(title: Title): void;
  /** Leaves the player for `title`'s page. */
  details(title: Title): void;
  /** Leaves the player. */
  back(): void;
  showControls(): void;
  /** Focus for when the screen hides with focus in it (the play/pause button), so keys still have a place to start. */
  focusFallback(): void;
}

export function createEndScreen(host: EndScreenHost) {
  let mode: FilmEnd = 'next';
  let shown = false;
  /** "Watch credits" was chosen: before the film's end (the screen comes back then), or after it. */
  let dismissed: 'credits' | 'end' | null = null;
  /** The film has played to its end. */
  let ended = false;
  /** The picks for the playing film: null until TMDB answers (empty without a token). `next`: the franchise's next film, first among them. */
  let picks: { for: string; titles: Title[] | null; next?: { id: string; collection: string } } | null = null;
  let featured = 0;
  /** Full details looked up for the picks (genres, runtime, synopsis), by id. */
  const details = new Map<string, Title>();
  let cornered = false;
  let countdown: number | undefined;
  let remaining = 0;
  /** Banner trailers on (and motion allowed), read as the screen opens. */
  let trailersOn = false;
  let savedTimer: number | undefined;
  /** A star being pointed at, shown in place of the saved rating. */
  let pointed: number | null = null;

  const trailer = createHeroTrailer({ setting: BANNER_TRAILER_KEY, className: 'end-trailer' });
  const [trailerVideo, trailerAudio] = trailer.media;

  // ── The finished film: its card, name and rating ──
  const back = h('button', { class: 'button glass end-back' }, icon('back'), h('span', {}, t('playerlook.end.back')));
  back.addEventListener('click', () => host.back());
  // Over the picture in the corner: clicking it watches the credits. Not a button, so the arrows skip it: "Watch credits" below is the one for keys.
  const hole = h('div', { class: 'end-hole', 'aria-hidden': 'true' });
  hole.addEventListener('click', () => dismiss());
  const filmName = h('span', { class: 'end-film-name' });
  const stars = [1, 2, 3, 4, 5].map((n) => {
    const star = h('button', { class: 'end-star', 'aria-label': t('ratings.value', { rating: String(n) }) }, icon('star'), h('span', { class: 'end-star-fill' }, icon('star', { filled: true })));
    star.addEventListener('click', () => rate(n));
    star.addEventListener('pointerenter', () => {
      pointed = n;
      renderStars();
    });
    return star;
  });
  const starRow = h('div', { class: 'end-stars', role: 'group', 'aria-label': t('playerlook.end.how') }, ...stars);
  starRow.addEventListener('pointerleave', () => {
    pointed = null;
    renderStars();
  });
  const savedNote = h('span', { class: 'end-rate-note', role: 'status' });
  const watchCredits = h('button', { class: 'button glass end-credits' }, t('player.next-up.watch-credits'));
  /** Where focus rests when nothing plays next: Watch credits, or on Android (where the video has already gone) Back to browse. */
  const idleFocus = (): HTMLElement => (isAndroid ? back : watchCredits);
  watchCredits.addEventListener('click', () => dismiss());
  const card = h(
    'div',
    { class: 'end-finished' },
    hole,
    filmName,
    h('span', { class: 'end-how' }, t('playerlook.end.how')),
    h('div', { class: 'end-rate' }, starRow, savedNote),
    watchCredits,
  );

  // ── The featured pick ──
  const art = h('div', { class: 'end-art', 'aria-hidden': 'true' });
  const shade = h('div', { class: 'end-shade' });
  const backdrop = h('div', { class: 'end-backdrop' }, art, ...trailer.media, shade);
  const eyebrow = h('span', { class: 'end-eyebrow' });
  const heading = h('div', { class: 'end-heading' });
  const meta = h('div', { class: 'end-meta' });
  const synopsis = h('p', { class: 'end-synopsis' });
  const play = h('button', { class: 'button large primary end-play', 'data-autofocus': true }, icon('play', { filled: true }), h('span', {}, t('titles.actions.play')));
  play.addEventListener('click', () => {
    const title = current();
    if (title) host.play(title);
  });
  const library = h('button', { class: 'button large glass end-library' });
  library.addEventListener('click', () => {
    const title = current();
    if (!title) return;
    const adding = !inLibrary(title.id);
    void toggleLibrary(title).then((ok) => {
      if (ok) toast(t(adding ? 'titles.actions.added-library' : 'titles.actions.removed-library', { name: title.name }));
      renderLibrary();
    });
    renderLibrary();
  });
  const detailsButton = h('button', { class: 'button large glass end-details' }, icon('info'), h('span', {}, t('titles.detail.details')));
  detailsButton.addEventListener('click', () => {
    const title = current();
    if (title) host.details(title);
  });
  const countdownLabel = h('span', { class: 'end-countdown', hidden: true });
  trailer.button.classList.add('end-trailer-sound');
  // A <section>: when the trailer's speaker button hides while focused, focus goes to Play (see hero-trailer.ts).
  const feature = h(
    'section',
    { class: 'end-feature' },
    eyebrow,
    heading,
    meta,
    synopsis,
    h('div', { class: 'end-actions' }, play, library, detailsButton, trailer.button, countdownLabel),
  );
  const others = h('div', { class: 'end-others', role: 'group', 'aria-label': t('titles.detail.more-like-this') });

  const element = h('div', { class: 'end-screen', role: 'region', 'data-nav-region': true, 'aria-label': t('playerlook.end.label'), hidden: true }, backdrop, h('div', { class: 'end-top' }, back), card, feature, others);
  // The screen keeps mpv's credits card at the top left in every language; its text follows the language (end-screen.css).
  for (const part of [card, feature, others]) part.dir = isRtl() ? 'rtl' : 'ltr';

  /** The picks for the playing film, once known. */
  const known = () => (picks?.for === host.request().title.id ? (picks.titles ?? []) : []);
  /** The featured pick, with its full details once loaded. */
  const current = (): Title | undefined => {
    const pick = known()[featured];
    return pick && { ...pick, ...details.get(pick.id), poster: details.get(pick.id)?.poster ?? pick.poster, background: pick.background ?? details.get(pick.id)?.background };
  };

  // ── Rating ──
  const filmId = () => host.request().title.id;

  function renderStars(): void {
    const value = pointed ?? userRating(filmId())?.rating ?? null;
    const saved = userRating(filmId())?.rating ?? null;
    stars.forEach((star, i) => {
      star.dataset.fill = starFill(value, i);
      star.setAttribute('aria-pressed', String(saved === i + 1));
    });
  }

  function rate(n: number): void {
    // The rating already set, chosen again, takes it away (as on a title page).
    const next = userRating(filmId())?.rating === n ? null : n;
    void setUserRating(filmId(), { rating: next })
      .then(() => {
        savedNote.textContent = t(next ? 'playerlook.end.saved' : 'playerlook.end.cleared');
        window.clearTimeout(savedTimer);
        savedTimer = window.setTimeout(() => (savedNote.textContent = ''), SAVED_MS);
      })
      .catch((err: unknown) => {
        console.error('Could not save the rating', err);
        toast(t('ratings.failed'));
      });
  }
  const stopListening = onRatingsChange(() => {
    if (shown) renderStars();
  });

  // ── The featured pick ──
  function renderLibrary(): void {
    const title = current();
    const saved = !!title && inLibrary(title.id);
    library.replaceChildren(icon(saved ? 'check' : 'plus'), h('span', {}, saved ? t('titles.detail.in-library') : t('playerlook.end.my-library')));
    library.setAttribute('aria-pressed', String(saved));
    library.title = saved ? t('titles.actions.remove-library') : t('titles.actions.add-library');
  }

  function renderMeta(title: Title): void {
    const parts = infoMeta(title, locale());
    meta.replaceChildren(...parts.flatMap((part, i) => [i ? h('span', { class: 'meta-dot', 'aria-hidden': 'true' }, '·') : '', h('span', {}, part)]), ageRatingSlot(title, { dot: parts.length > 0 }));
    synopsis.textContent = title.description?.trim() ?? '';
    synopsis.hidden = !synopsis.textContent;
  }

  function renderFeature(): void {
    const title = current();
    element.dataset.picks = title ? 'some' : picks?.for === host.request().title.id && picks.titles === null ? 'loading' : 'none';
    stopTrailer();
    if (!title) {
      art.replaceChildren();
      others.replaceChildren();
      return;
    }
    art.replaceChildren(backdropImage(title, 'end-art-image', true));
    eyebrow.textContent = picks?.next?.id === title.id ? t('movix.end.next-in', { name: picks.next.collection }) : t('playerlook.end.because', { name: host.request().title.name });
    heading.replaceChildren(titleHeading('h2', 'end-title', title));
    renderMeta(title);
    renderLibrary();
    renderOthers();
    startCountdown(title);
    // TMDB's picks have no genres or runtime: the addons' details (cached) add them.
    if (!details.has(title.id)) {
      loadMeta(title.type, title.id)
        .then((full) => {
          if (!full) return;
          details.set(title.id, full);
          const now = current();
          if (shown && now?.id === title.id) renderMeta(now);
        })
        .catch(() => {});
    }
  }

  /** The other picks: choosing one swaps it with the featured title, in place, so focus stays put. */
  function renderOthers(): void {
    const titles = known();
    others.replaceChildren(
      ...titles.map((title, i) => {
        if (i === featured) return '';
        const choice = h(
          'button',
          { class: 'end-other', 'data-index': String(i), title: title.name },
          h('span', { class: 'end-other-frame' }, h('span', { class: 'end-other-fallback', 'aria-hidden': 'true' }, title.name), backdropImage(title, 'end-other-art')),
          h('span', { class: 'end-other-name' }, title.name),
        );
        choice.addEventListener('click', () => choose(i));
        return choice;
      }),
    );
  }

  function choose(index: number): void {
    const titles = known();
    if (!titles[index] || index === featured) return;
    // The featured title takes the chosen one's place in the row.
    const was = featured;
    const swapped = [...titles];
    [swapped[was], swapped[index]] = [swapped[index]!, swapped[was]!];
    if (picks) picks.titles = swapped;
    featured = was;
    renderFeature();
    others.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus({ preventScroll: true });
  }

  // ── The trailer, after a countdown ──
  function stopTrailer(): void {
    window.clearInterval(countdown);
    countdown = undefined;
    countdownLabel.hidden = true;
    trailer.stop();
  }

  function startCountdown(title: Title): void {
    if (!trailersOn || !trailersAllowed()) return;
    remaining = TRAILER_COUNTDOWN;
    const label = () => (countdownLabel.textContent = t('playerlook.end.trailer-in', { seconds: remaining }));
    label();
    countdownLabel.hidden = false;
    countdown = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) return void label();
      window.clearInterval(countdown);
      countdown = undefined;
      countdownLabel.hidden = true;
      // TMDB's picks don't name trailers: the title's details (cached) do.
      trailer.start(title.id, async () => title.trailers?.[0] ?? details.get(title.id)?.trailers?.[0] ?? (await loadMeta(title.type, title.id).catch(() => null))?.trailers?.[0]);
    }, 1000);
  }

  // The credits and a trailer with its sound shouldn't play over each other: the credits pause.
  const hush = () => {
    if (shown && ((!trailerVideo.muted && !trailerVideo.paused) || !trailerAudio.paused)) host.pause();
  };
  trailerVideo.addEventListener('playing', hush);
  trailerVideo.addEventListener('volumechange', hush);
  trailerAudio.addEventListener('playing', hush);

  // ── Showing and hiding ──
  function setCorner(on: boolean): void {
    if (on === cornered) return;
    cornered = on;
    void invoke('player_set_corner', on ? { on, spot: 'card' } : { on }).catch((err: unknown) => console.error('Could not move the picture', err));
  }

  /** Asks TMDB once per film for what to suggest (cached with Home's and Cinema's asks). */
  function lookUp(): void {
    const request = host.request();
    const { title } = request;
    if (mode !== 'next' || !isFilm(request) || picks?.for === title.id) return;
    picks = { for: title.id, titles: null };
    featured = 0;
    const continuing = new Set(continueWatching().map((entry) => entry.title.id));
    const recommended = recommendationsFor(title)
      .then((found) => found ?? [])
      .catch((err: unknown) => {
        console.warn('No recommendations for the end screen', err);
        return [];
      });
    // Part 1 of a franchise leads to part 2 (once it's out), before anything TMDB recommends.
    const franchise = titleCollection(title).catch((err: unknown) => {
      console.warn('No franchise for the end screen', err);
      return undefined;
    });
    void Promise.all([recommended, franchise])
      .then(([found, collection]) => {
        if (picks?.for !== title.id) return;
        const next = collection ? nextInFranchise(collection.parts, title.id, isWatched, Date.now()) : undefined;
        if (next && collection) picks.next = { id: next.id, collection: collection.name };
        picks.titles = endPicks(found, title.id, (pick) => isWatched(pick) || continuing.has(pick.id), undefined, next);
        if (!shown) return;
        // Focus moves to Play only if it's still where the screen put it.
        const waiting = document.activeElement === idleFocus();
        renderFeature();
        if (waiting && current()) play.focus({ preventScroll: true });
      });
  }

  function show(): void {
    shown = true;
    pointed = null;
    filmName.textContent = host.request().title.name;
    savedNote.textContent = '';
    renderStars();
    element.hidden = false;
    host.view.classList.add('end-screen-on');
    setCorner(true);
    host.showControls();
    trailersOn = false;
    renderFeature();
    (current() ? play : idleFocus()).focus({ preventScroll: true });
    void settings
      .get(BANNER_TRAILER_KEY)
      .catch(() => null)
      .then((on) => {
        trailersOn = on === true;
        const title = current();
        if (shown && title && countdown === undefined) startCountdown(title);
      });
  }

  function hide(): void {
    if (!shown) return;
    shown = false;
    stopTrailer();
    element.hidden = true;
    host.view.classList.remove('end-screen-on');
    setCorner(false);
  }

  /** "Watch credits": the picture gets the window back. */
  function dismiss(): void {
    dismissed = ended ? 'end' : 'credits';
    const hadFocus = element.contains(document.activeElement);
    hide();
    host.showControls();
    if (hadFocus) host.focusFallback();
  }

  return {
    element,
    /** Settings → Playback → When a film ends. */
    configure(next: FilmEnd): void {
      mode = next;
      if (mode === 'stop') hide();
    },
    /** After each status, and with `ended` once the film ends: shows the screen when it's due. */
    update(atEnd = false): void {
      lookUp();
      if (atEnd && !ended) {
        ended = true;
        // The credits watched to the very end: what's next comes back.
        if (dismissed === 'credits') dismissed = null;
      } else if (!atEnd && !shown) {
        // Gone back from the end and playing again: the screen comes back at the credits or the end.
        const { paused, timePos, duration } = host.status();
        const inCredits = host.segments().some((s) => s.kind === 'credits' && timePos !== null && timePos >= s.start);
        ({ ended, dismissed } = afterEnd({ ended, dismissed, paused, timePos, duration, inCredits }));
      }
      if (shown || dismissed || mode !== 'next' || host.pip()) return;
      if (endScreenDue({ film: isFilm(host.request()), upNext: host.hasUpNext(), started: host.started(), ended, timePos: host.status().timePos, segments: host.segments() })) show();
    },
    /** Whether the screen is up (Next Up, "Skip credits" and the pause screen stand aside). */
    shown: () => shown,
    /** Esc or Back while it's up leaves the player, as "Back to browse" does. */
    dismiss(): boolean {
      if (!shown) return false;
      host.back();
      return true;
    },
    /** Another file is starting: the screen may come again for it. */
    newFile(): void {
      hide();
      dismissed = null;
      ended = false;
    },
    dispose(): void {
      hide();
      stopListening();
      window.clearTimeout(savedTimer);
    },
  };
}
