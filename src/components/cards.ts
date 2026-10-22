import { locale, t } from '../i18n';
import { stars } from '../catalog/letterboxd';
import { guardCard, settleCards } from '../catalog/parental';
import { isNewRelease, metaValues, upcomingRelease, type Title } from '../catalog/titles';
import { h } from '../lib/dom';
import { classify, errorText, fixButton, isOffline, retryWhenOnline, rowErrorHidden } from './state-message';
import { withHoverInfo } from './hover-info';
import { ratingBadge } from './rating-badge';
import { scrollFade, scrollRow } from './scroll-fade';
import type { ContinueEntry } from '../library/watch';
import { icon } from './icons';
import { splitTopTen } from '../lib/top-ten';
import { markWatched } from './watched-marks';
import { withQuickActions } from './card-actions';
import { findLogo, knownLogo, logoImage } from './title-logo';
import { appearance } from '../theme/appearance';
import { isAndroid } from '../lib/platform';
import { nearObserver } from '../lib/near-view';
import { rpdbPoster } from '../catalog/rpdb';
import { describeScores, scoresFor, scoresOverlay } from './poster-scores';

/**
 * Remote artwork. It fades in once loaded; if it fails the fallback underneath
 * shows instead of a broken-image icon (see `artFailed`).
 */
export function artImage(src: string, className: string, eager = false): HTMLImageElement {
  const img = h('img', { class: className, src, alt: '', decoding: 'async', loading: eager ? 'eager' : 'lazy' });
  img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
  img.addEventListener('error', () => artFailed(img));
  if (!eager && className.split(' ').includes('art')) loadAhead(img);
  return img;
}

/**
 * Android: a lazy picture is asked for once it's within a screen of view in
 * the outlet. The browser's own lazy loading watches only the window, which
 * the outlet clips (lib/near-view.ts), so a TV's next row of pictures waited
 * until it was on screen. The scroll margin reaches past a rail's own edge, to
 * the next few cards along. Elsewhere (and outside the outlet) the browser's
 * lazy loading stays as it was.
 */
let ahead: IntersectionObserver | null = null;
function loadAhead(img: HTMLImageElement): void {
  if (!isAndroid) return;
  ahead ??= nearObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        ahead!.unobserve(entry.target);
        (entry.target as HTMLImageElement).loading = 'eager';
      }
    },
    '100% 0px',
    '0px 50%',
  );
  ahead.observe(img);
}

/**
 * A title's poster: RPDB's when that's the poster provider (catalog/rpdb.ts),
 * falling back to the addon's poster if RPDB has none or fails, so the card
 * shows Orbit's own scores again.
 */
function posterArt(title: Title): HTMLImageElement | '' {
  const rpdb = rpdbPoster(title);
  if (!rpdb) return title.poster ? artImage(title.poster, 'art') : '';
  const img = h('img', { class: 'art rpdb-art', src: rpdb, alt: '', decoding: 'async', loading: 'lazy' });
  loadAhead(img);
  img.addEventListener('load', () => img.classList.add('loaded'));
  img.addEventListener('error', () => {
    if (title.poster && img.classList.contains('rpdb-art')) {
      img.classList.remove('rpdb-art');
      img.src = title.poster;
    } else artFailed(img);
  });
  return img;
}

/** Pictures that failed while offline, asked for again once the connection is back. */
const waitingArt = new Set<HTMLImageElement>();
const MAX_WAITING_ART = 1000;

/**
 * A picture that didn't load. Offline it stays (hidden, so the fallback shows) and is asked for again when the
 * connection comes back, since nothing redraws the hero or Continue Watching then. Otherwise (a 404, a dead
 * CDN) it's removed for good.
 */
function artFailed(img: HTMLImageElement): void {
  if (navigator.onLine) return img.remove();
  img.hidden = true;
  if (waitingArt.size >= MAX_WAITING_ART) for (const old of waitingArt) if (!old.isConnected) waitingArt.delete(old);
  if (waitingArt.size < MAX_WAITING_ART) waitingArt.add(img);
}

if (typeof window !== 'undefined')
  window.addEventListener('online', () => {
    for (const img of waitingArt) {
      if (!img.isConnected) continue;
      img.hidden = false;
      // Setting src, even unchanged, asks for the picture again.
      img.src = img.getAttribute('src') ?? '';
    }
    waitingArt.clear();
  });

/** Landscape art for a title, or its poster blurred into a backdrop when it has none. */
export function backdropImage(title: Title, className: string, eager = false): HTMLImageElement | '' {
  if (title.background) return artImage(title.background, className, eager);
  return title.poster ? artImage(title.poster, `${className} art-blurred`, eager) : '';
}

/** Sets the artwork hue used by glows and art placeholders (CSSOM, so CSP-safe). */
export function withHue<T extends HTMLElement>(el: T, hue: number): T {
  el.style.setProperty('--hue', String(hue));
  return el;
}

const dot = () => h('span', { class: 'meta-dot', 'aria-hidden': 'true' }, '·');

/** "IMDb 7.4 · 2010 · 15 min · Animation, Fantasy" — missing fields are left out; `genres: false` drops the genres. */
export function titleMeta(title: Title, options: { genres?: boolean } = {}): (Node | string)[] {
  const parts: (Node | string)[] = [];
  const rating = title.rating?.trim();
  if (rating) parts.push(ratingBadge('imdb', rating));
  for (const value of metaValues(title, options)) {
    if (parts.length) parts.push(dot());
    // Each value keeps its own direction: an addon's English "111 min" in an Arabic line stays in order.
    parts.push(h('span', { dir: 'auto' }, value));
  }
  return parts;
}

/**
 * What a page adds to a title's card, in either shape.
 * `badge`: a short label in the artwork's corner, in place of "New".
 * `rating`: the person's own rating from elsewhere (e.g. Letterboxd stars), shown under the card.
 * `ownRating`: their stars in Orbit (library/ratings.ts), shown there in Orbit's colour.
 */
export interface CardOptions {
  watched?: boolean;
  progress?: number;
  badge?: string;
  rating?: string;
  ownRating?: number;
}

export function posterCard(title: Title, onOpen: () => void, options: CardOptions = {}): HTMLElement {
  const frame = h(
    'span',
    { class: 'frame poster-frame' },
    // Visible until the artwork loads, and permanently if there is none. Hidden from screen readers: the card's own text names it.
    h('span', { class: 'no-art', 'aria-hidden': 'true' }, h('span', { class: 'no-art-title' }, title.name), h('span', { class: 'no-art-label' }, t('browse.cards.no-artwork'))),
    posterArt(title),
  );
  frameMarks(frame, title, options, 'poster-progress');
  const scores = scoresFor(title);
  frame.append(scoresOverlay(scores));
  const card = h(
    'button',
    // Lets focus find the same card again after its row or grid redraws (router.ts, library).
    { class: 'card poster-card', title: title.name, 'data-focus-id': `poster:${title.id}` },
    frame,
    cardText(title, options),
  );
  describeScores(card, scores);
  return finishCard(card, title, onOpen, options);
}

/** The watched check, progress bar and corner badge ("New", or "Recently added" on a logo card, when nothing else claims the corner). */
function frameMarks(frame: HTMLElement, title: Title, options: CardOptions, progressClass: string, recent = false): void {
  if (options.watched) frame.append(h('span', { class: 'watched-mark', role: 'img', 'aria-label': t('browse.cards.watched'), title: t('browse.cards.watched') }, icon('check')));
  if (options.progress) frame.append(progressBar(options.progress, progressClass));
  const coming = options.badge ? null : upcomingRelease(title);
  if (options.badge) frame.append(h('span', { class: 'poster-badge page-tag' }, options.badge));
  // Not out yet: said, but the card opens as usual (an addon may have it already).
  else if (coming !== null) frame.append(h('span', { class: 'poster-badge coming-tag' }, coming === 'soon' ? t('pages.coming.soon') : t('pages.coming.on', { date: comingDate(coming) })));
  else if (isNewRelease(title)) frame.append(recent ? h('span', { class: 'poster-badge new-tag', title: t('explore.new-tag-label') }, t('browse.cards.recently-added')) : newTag());
}

let comingDates: Intl.DateTimeFormat | null = null;
/** "Dec 18": release dates are calendar days kept as UTC midnight. */
const comingDate = (at: number) => (comingDates ??= new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', timeZone: 'UTC' })).format(at);

/** The name, then year and genre (the artwork already says whether it's a film or a show) and any ratings. Logo cards say year and genre only to screen readers (styles.css). */
function cardText(title: Title, options: CardOptions): HTMLElement {
  const sub = [title.year, title.genres[0]].filter(Boolean).join(' · ');
  return h(
    'span',
    { class: 'card-text' },
    h('span', { class: 'card-title' }, title.name),
    h(
      'span',
      { class: 'card-sub' },
      sub ? h('span', { class: 'card-meta' }, sub) : '',
      options.rating ? h('span', { class: 'card-rating' }, options.rating) : '',
      options.ownRating ? ownStars(options.ownRating) : '',
    ),
  );
}

/** Their own stars: read as "Your rating: 3.5", not as star characters. */
function ownStars(rating: number): HTMLElement {
  const label = t('ratings.card', { rating: rating.toLocaleString(locale(), { maximumFractionDigits: 1 }) });
  return h('span', { class: 'card-rating mine', role: 'img', 'aria-label': label, title: label }, stars(rating));
}

function finishCard(card: HTMLElement, title: Title, onOpen: () => void, options: CardOptions): HTMLElement {
  card.addEventListener('click', onOpen);
  // A card that already says Watched (My Library's Watched tab) doesn't need it twice.
  if (!options.watched) markWatched(card, title);
  withQuickActions(card, title);
  // Hidden unless the profile's content limit allows the title.
  return guardCard(withHoverInfo(card, title), title);
}

/** "New" on a poster released in the last 30 days (only when its release date is known). */
export function newTag(): HTMLElement {
  return h('span', { class: 'poster-badge new-tag', title: t('explore.new-tag-label') }, t('explore.new-tag'));
}

function progressBar(progress: number, className: string): HTMLElement {
  const bar = h('span', { class: className }, h('span', { class: 'progress-fill' }));
  bar.style.setProperty('--progress', String(progress));
  return bar;
}

/** The play button's icon in its lit colours, crossfaded over the resting one (styles.css .still-play). */
function litPlayIcon(): SVGSVGElement {
  const lit = icon('play', { filled: true });
  lit.classList.add('still-play-lit');
  return lit;
}

export function continueCard(entry: ContinueEntry, onPlay: () => void): HTMLElement {
  const frame = h(
    'span',
    { class: `frame still-frame${entry.spoiler ? ' spoiler-art' : ''}` },
    entry.still ? artImage(entry.still, 'art') : backdropImage(entry.title, 'art'),
    // No landscape art: the blurred poster fills the frame, and the poster itself sits on top, sharp.
    !entry.still && !entry.title.background && entry.title.poster ? artImage(entry.title.poster, 'art still-poster') : '',
    h('span', { class: 'still-shade' }),
    entry.badge ? h('span', { class: 'still-badge' }, entry.badge) : '',
    h('span', { class: 'still-play', 'aria-hidden': 'true' }, icon('play', { filled: true }), litPlayIcon()),
    entry.left ? h('span', { class: 'still-left' }, entry.left) : '',
    entry.progress > 0 ? progressBar(entry.progress, 'still-progress') : '',
  );
  const card = h(
    'button',
    { class: 'card continue-card', 'data-focus-id': `continue:${entry.title.id}`, 'aria-label': entry.left || entry.badge ? t('browse.cards.resume-detail', { name: entry.title.name, detail: (entry.left || entry.badge)! }) : t('browse.cards.resume', { name: entry.title.name }) },
    frame,
    h('span', { class: 'card-text' }, h('span', { class: 'card-title large' }, entry.title.name), h('span', { class: 'card-sub' }, entry.sub)),
  );
  card.addEventListener('click', onPlay);
  return guardCard(card, entry.title);
}

/** Loads (or looks up) each card's logo once the card nears the screen, so a long rail or grid only asks for the ones seen. */
let nearScreen: IntersectionObserver[] | null = null;
const logoWhenNear = new WeakMap<Element, () => void>();
function onceNear(el: Element, run: () => void): void {
  const seen: IntersectionObserverCallback = (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const observer of nearScreen!) observer.unobserve(entry.target);
      logoWhenNear.get(entry.target)?.();
      logoWhenNear.delete(entry.target);
    }
  };
  // The window, and the outlet pages scroll in (lib/near-view.ts); the scroll margin reaches past a rail's own edge.
  nearScreen ??= [new IntersectionObserver(seen, { rootMargin: '0px 400px' }), nearObserver(seen, '0px 400px', '0px 400px')];
  logoWhenNear.set(el, run);
  for (const observer of nearScreen) observer.observe(el);
}

/**
 * A logo card (Settings → Appearance → Card shape: Landscape): the title's
 * 16:9 backdrop under a shade that deepens towards the bottom, with its logo
 * set large on the bottom corner, or its name in the display face while
 * there's no logo (and with logos off). Nothing else is written on or under
 * it: name, year and genre are said only to screen readers, and a corner
 * badge ("New episode", "New season", "Recently added") is the one label.
 * Without a backdrop the poster, blurred, fills the frame with the poster
 * itself on top.
 *
 * `lookUpLogo`: when the title carries no logo, look one up (its full
 * details, cached) once the card nears the screen. Rails that always did
 * (Home's, a title page's More like this) ask for it; 'in-rail' asks only
 * when the card is in a rail by then (rooms/title-card.ts), so grids don't,
 * and scrolling a long one doesn't ask for every title's details.
 */
export function landscapeCard(title: Title, onOpen: () => void, options: CardOptions & { lookUpLogo?: boolean | 'in-rail' } = {}): HTMLElement {
  const logo = h('span', { class: 'landscape-logo', 'aria-hidden': 'true' }, h('span', { class: 'landscape-logo-name' }, title.name));
  const frame = h(
    'span',
    { class: 'frame still-frame' },
    h('span', { class: 'no-art', 'aria-hidden': 'true' }),
    backdropImage(title, 'art'),
    !title.background && title.poster ? artImage(title.poster, 'art still-poster') : '',
    h('span', { class: 'still-shade' }),
    logo,
  );
  frameMarks(frame, title, options, 'still-progress', true);
  const scores = scoresFor(title);
  frame.append(scoresOverlay(scores));
  const card = h('button', { class: 'card landscape-card', title: title.name, 'data-focus-id': `poster:${title.id}` }, frame, cardText(title, options));
  describeScores(card, scores);
  const showLogo = (src: string) => {
    // Not the browser's lazy loading: the image stays hidden until it loads (styles.css), and a hidden lazy image never would.
    const img = logoImage(src, 'landscape-logo-img');
    img.addEventListener('load', () => card.classList.add('has-logo'), { once: true });
    img.addEventListener(
      'error',
      () => {
        card.classList.remove('has-logo');
        img.remove();
      },
      { once: true },
    );
    logo.append(img);
  };
  const known = knownLogo(title);
  if (known) onceNear(card, () => showLogo(known));
  else if (options.lookUpLogo)
    onceNear(card, () => {
      if (options.lookUpLogo === 'in-rail' && !card.closest('.rail-track')) return;
      void findLogo(title).then((src) => src && showLogo(src));
    });
  return finishCard(card, title, onOpen, options);
}

/** Placeholders shaped like a grid's cards in the card shape, while a page of them loads. */
export function gridSkeletons(count: number): HTMLElement[] {
  return Array.from({ length: count }, () => (appearance().rowStyle === 'landscape' ? landscapeSkeleton() : h('div', { class: 'poster-skeleton', 'aria-hidden': 'true' }, h('div', { class: 'skeleton poster-frame' }), h('div', { class: 'skeleton line' }))));
}

const landscapeSkeleton = () => h('div', { class: 'poster-skeleton landscape-skeleton', 'aria-hidden': 'true' }, h('div', { class: 'skeleton still-frame' }), h('div', { class: 'skeleton line short' }));

export function rankedCard(title: Title, rank: number, onOpen: () => void): HTMLElement {
  const card = h(
    'button',
    // No title: the name shows whole on the poster, so a tooltip only repeated it over the next card.
    { class: 'card ranked-card', 'aria-label': t('browse.cards.ranked', { rank, name: title.name }), 'data-focus-id': `ranked:${title.id}` },
    h('span', { class: 'rank', 'aria-hidden': 'true', 'data-rank': String(rank) }, String(rank)),
    h(
      'span',
      // The rank badge some themes show in the corner (styles.css, data-theme-style); hidden otherwise.
      { class: 'frame ranked-frame', 'data-rank-badge': t('browse.cards.top-badge', { rank }) },
      title.poster ? artImage(title.poster, 'art') : '',
      h('span', { class: 'ranked-title' }, title.name),
    ),
  );
  card.addEventListener('click', onOpen);
  markWatched(card, title);
  return guardCard(withHoverInfo(card, title), title);
}

export function genreTile(genre: { name: string; hue: number }, onOpen: () => void): HTMLElement {
  const tile = withHue(h('button', { class: 'genre-tile' }, h('span', { class: 'genre-name' }, genre.name)), genre.hue);
  tile.addEventListener('click', onOpen);
  return tile;
}

interface RailOptions {
  title: string;
  source?: string | undefined;
  onSeeAll?: (() => void) | undefined;
  variant?: string;
  /** Lets a failed row offer "Fix in Settings" when a saved sign-in or key (TMDB's) stopped working. */
  go?: ((room: string) => void) | undefined;
}

/**
 * A Top 10 row's heading, with a leading "Top 10" in a span of its own so a
 * theme can set it apart (styles.css, data-theme-style); the text reads the
 * same. Headings that don't start that way stay one piece.
 */
function headingParts(options: RailOptions): (string | HTMLElement)[] {
  const top = options.variant === 'ranked' ? splitTopTen(options.title) : null;
  return top ? [h('span', { class: 'rail-heading-top' }, top[0]), ' ', h('span', { class: 'rail-heading-rest' }, top[1])] : [options.title];
}

function railShell(options: RailOptions, track: HTMLElement): HTMLElement {
  const scrollButton = (dir: 1 | -1) => {
    const button = h('button', { class: 'rail-scroll', title: dir > 0 ? t('browse.cards.scroll-right') : t('browse.cards.scroll-left'), tabindex: '-1' }, icon(dir > 0 ? 'chevronRight' : 'chevronLeft'));
    button.addEventListener('click', () => scrollRow(track, dir));
    return button;
  };
  const controls = h('div', { class: 'rail-controls' });
  if (options.onSeeAll) {
    const seeAll = h('button', { class: 'see-all', 'data-nav-axis': 'horizontal' }, t('browse.cards.see-all'));
    seeAll.addEventListener('click', options.onSeeAll);
    controls.append(seeAll);
  }
  controls.append(h('span', { class: 'rail-arrows', 'data-nav-skip': true }, scrollButton(-1), scrollButton(1)));

  return h(
    'section',
    // Back finds a card redrawn meanwhile in the same rail, not the same title in another (app/router.ts).
    { class: 'rail', 'data-focus-scope': `rail:${options.title}` },
    h(
      'div',
      { class: 'rail-header' },
      h('div', { class: 'rail-titles' }, h('h2', { class: 'rail-heading' }, ...headingParts(options)), options.source ? h('span', { class: 'rail-source' }, options.source) : ''),
      controls,
    ),
    track,
  );
}

/**
 * "See all" as the rail's last tile, shaped like its cards, so a remote or a
 * controller reaching the end of a row goes on to it instead of back up to
 * the heading's button. Only for rails with "See all" and something in them.
 */
function seeAllTile(options: RailOptions, cards: readonly HTMLElement[]): HTMLElement[] {
  const seeAll = options.onSeeAll;
  const first = cards[0];
  if (!seeAll || !first) return [];
  const shape = first.matches('.landscape-card, .continue-card') ? 'landscape' : first.matches('.ranked-card') ? 'ranked' : first.matches('.poster-card') ? 'poster' : null;
  if (!shape) return [];
  // Prefixed: a bare `poster` class picked up the detail page's `.poster` rule (width: 100%), which made the tile as wide as the row and, at 2:3, the row thousands of pixels tall.
  const tile = h(
    'button',
    { class: `see-all-tile see-all-${shape}`, 'aria-label': t('pages.see-all.label', { name: options.title }), 'data-focus-id': `see-all:${options.title}` },
    h('span', { class: 'see-all-tile-frame' }, h('span', { class: 'see-all-tile-icon', 'aria-hidden': 'true' }, icon('chevronRight')), h('span', { class: 'see-all-tile-text' }, t('browse.cards.see-all'))),
  );
  tile.addEventListener('click', seeAll);
  return [tile];
}

/**
 * A titled rail. The scroll arrows are a pointer convenience; keyboard and
 * controller users move along the rail with the arrow keys.
 */
export function rail(options: RailOptions & { cards: HTMLElement[] }): HTMLElement {
  return railShell(options, scrollFade(h('div', { class: `rail-track ${options.variant ?? ''}`.trim() }, ...options.cards, ...seeAllTile(options, options.cards))));
}

/**
 * A rail whose cards load asynchronously. Shows skeletons shaped like the
 * final cards, hides itself if the catalog comes back empty (or, with `empty`,
 * says so: a row the person just asked for mustn't vanish without a word), and
 * on failure shows an inline error with Retry that doesn't affect other rails.
 */
export function asyncRail(options: RailOptions & { load: () => Promise<HTMLElement[]>; empty?: { title: string; detail?: string } | undefined }): HTMLElement {
  const track = scrollFade(h('div', { class: `rail-track ${options.variant ?? ''}`.trim(), 'aria-busy': 'true' }));
  const section = railShell(options, track);

  function run(): void {
    // Shown again for a row that stayed hidden while offline.
    section.hidden = false;
    track.setAttribute('aria-busy', 'true');
    placeholders();
    options
      .load()
      // Rows wait briefly for the profile's content limit, so they don't shrink as ratings arrive.
      .then((cards) => settleCards(cards))
      .then((cards) => {
        const { empty } = options;
        if (!cards.length && empty) {
          const box = h('div', { class: 'rail-error rail-empty' }, h('span', { class: 'rail-error-title' }, empty.title), empty.detail ? h('span', { class: 'muted' }, empty.detail) : '');
          loaded(() => track.replaceChildren(box));
          return;
        }
        section.hidden = cards.length === 0;
        loaded(() => track.replaceChildren(...cards, ...seeAllTile(options, cards)));
      })
      .catch((err: unknown) => {
        const found = classify(err);
        if (rowErrorHidden(found)) {
          // The offline banner says it once for every row: this one stays empty until the connection is back.
          loaded(() => track.replaceChildren());
          section.hidden = true;
          retryWhenOnline(section, run);
          return;
        }
        const signedOut = found.cause === 'signed-out';
        // Retry can't renew a key TMDB stopped accepting: Settings can (as `errorState` offers).
        let action: HTMLElement;
        if (signedOut && found.service && options.go) action = fixButton(found.service, options.go);
        else {
          action = h('button', { class: 'button' }, t('browse.search.retry'));
          action.addEventListener('click', run);
        }
        // Offline, every rail fails together: "Other rails aren't affected" would be wrong.
        const reason = errorText(err);
        const box = h('div', { class: 'rail-error' }, h('span', { class: 'rail-error-title' }, t('browse.service.failed', { name: options.title })), h('span', { class: 'muted' }, isOffline() ? reason : t('browse.cards.rail-error', { reason })), action);
        loaded(() => track.replaceChildren(box));
        // The message, not the track: once a retry replaces it, a pending automatic one is dropped.
        // An expired sign-in won't fix itself, so it isn't retried on a timer.
        if (!signedOut) retryWhenOnline(box, run);
      })
      .finally(() => track.removeAttribute('aria-busy'));
  }
  /**
   * Skeletons while the row loads. The row is a stop for the arrows meanwhile (spatial.ts `data-nav-stop`;
   * not for Tab), so holding Down waits there rather than skipping every row still loading.
   */
  function placeholders(): void {
    track.replaceChildren(...Array.from({ length: 8 }, () => skeletonCard(options.variant)));
    track.dataset.navStop = '';
    track.tabIndex = -1;
  }
  /** Fills the row; if it held focus while loading, focus goes on to its first card (or the Retry), where the ring was. */
  function loaded(fill: () => void): void {
    const focused = document.activeElement === track;
    delete track.dataset.navStop;
    track.removeAttribute('tabindex');
    fill();
    if (focused && !section.hidden) track.querySelector<HTMLElement>('button, a[href]')?.focus({ preventScroll: true });
  }
  run();
  return section;
}

/** A rail's placeholder: shaped by its variant, or by the card shape for rails of browsing cards ('posters' keeps posters). */
function skeletonCard(variant?: string): HTMLElement {
  if (variant === 'ranked') return h('div', { class: 'skeleton ranked-skeleton', 'aria-hidden': 'true' });
  if (variant === 'continue' || (variant === undefined && appearance().rowStyle === 'landscape')) return landscapeSkeleton();
  return h('div', { class: 'poster-skeleton', 'aria-hidden': 'true' }, h('div', { class: 'skeleton poster-frame' }), h('div', { class: 'skeleton line' }), h('div', { class: 'skeleton line short' }));
}
