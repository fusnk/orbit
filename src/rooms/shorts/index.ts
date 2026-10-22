/**
 * Shorts (Home → Today on Orbit): trailers one per screen, paged up and down
 * with the wheel, the arrow keys, a remote or a controller, snapping to each.
 * The titles are what's trending (movies and shows mixed, from TMDB with a
 * token, else the first addon's popular catalogs) plus the person's
 * favourite genres, minus anything watched or started, marked Not
 * interested or thumbed down, and anything the profile's content limit
 * blocks. Starting with an unwatched title also keeps episodes from being
 * spoiled; with Hide ratings on (Spoilers), ratings stay hidden too.
 *
 * Trailers play the way the banner's do (detail/hero-trailer.ts): Rust finds
 * the video with yt-dlp and hands back only googlevideo.com addresses, which
 * the CSP's media-src allows, in a plain <video>; nothing from YouTube runs
 * on the page. Only the trailer on screen plays; the next one is looked up
 * ahead (Rust keeps the answer), and the rest hold no video, so memory stays
 * flat however far the feed goes. Muted to start; the speaker button's
 * choice is remembered. With Reduce motion (or reduced effects) nothing
 * starts on its own: each title has a Play trailer button, and paging jumps
 * instead of gliding.
 *
 * Titles come from addons and TMDB: text nodes only.
 */
import { invoke } from '@tauri-apps/api/core';
import { VIEW_DISCARDED, type RoomContext } from '../../app/router';
import { isEditing } from '../../app/spatial';
import { favouriteGenres, taste } from '../../catalog/taste';
import { genreOf, type GenreKey } from '../../catalog/explore';
import { allowedTitles } from '../../catalog/parental';
import { loadCatalog, loadMeta, usableAddons } from '../../catalog/service';
import { buildFeed, slideRole, stepTo, trailerId, withoutAt } from '../../catalog/shorts';
import { tmdbList, tmdbRating, tmdbSourcePage } from '../../catalog/tmdb';
import { browsableCatalogs, displayYear, fallbackHue, type CatalogRef, type Title } from '../../catalog/titles';
import { backdropImage, withHue } from '../../components/cards';
import { icon } from '../../components/icons';
import { ratingBadge } from '../../components/rating-badge';
import { formatDecimal, t } from '../../i18n';
import { h } from '../../lib/dom';
import { inLibrary, toggleLibrary } from '../../library/library';
import { spoilers } from '../../library/spoilers';
import { isWatched, lastWatchedAt, tasteWatched } from '../../library/watch';
import { reducedMotion } from '../../theme/appearance';
import { createHeroTrailer, trailersAllowed } from '../detail/hero-trailer';
import { titleHandlers } from '../detail/open';
import { genreTargets } from '../home/genre-targets';
import { hideTitle } from '../explore/state';
import { loadShortsSound, saveShortsSound } from './sound';
import './shorts.css';

/** Favourite genres mixed in, at most. */
const GENRES = 2;
/** Enough votes that a genre's title is known, not just new. */
const KNOWN = 200;
/** Wheel travel that turns the page; smaller nudges add up. */
const WHEEL_STEP = 40;
/** After a page turn, the wheel waits this long since its last movement (a touchpad's glide keeps going). */
const WHEEL_REST_MS = 220;

/** A favourite genre's popular movies and shows on TMDB. */
async function tmdbGenre(key: GenreKey, failures: unknown[]): Promise<Title[][]> {
  const genre = genreOf(key);
  const page = (media: 'movie' | 'tv', id: number) =>
    tmdbSourcePage({ kind: 'discover', media, sort: 'popularity.desc', filters: { withGenres: id, voteCountGte: KNOWN } }, 1)
      .then((found) => found?.titles ?? [])
      .catch((err: unknown) => (failures.push(err), []));
  return Promise.all([page('movie', genre.movie), ...(genre.tv ? [page('tv', genre.tv)] : [])]);
}

/** A catalog's first page, or nothing if it fails (noted in `failures`). */
const catalogTitles = (failures: unknown[], ref: CatalogRef | undefined, extra: [string, string][] = []): Promise<Title[]> =>
  ref ? loadCatalog(ref, extra).catch((err: unknown) => (failures.push(err), [])) : Promise.resolve([]);

/** Without TMDB: the first addon catalogs of popular movies and shows, and the favourite genres from catalogs that have them. */
async function catalogLists(favourites: readonly GenreKey[], failures: unknown[]): Promise<Title[][]> {
  const refs = browsableCatalogs(await usableAddons());
  const popular = (type: string) => refs.find((ref) => ref.catalog.type === type && !ref.extra.length);
  const genres = favourites.flatMap((key) =>
    Object.values(genreTargets(key, refs)).map((target) => catalogTitles(failures, { ...target.ref, extra: target.ref.extra.filter(([name]) => name !== 'genre') }, [['genre', target.genre]])),
  );
  return Promise.all([catalogTitles(failures, popular('movie')), catalogTitles(failures, popular('series')), ...genres]);
}

/** The feed's titles, in order, already past the content limit. */
async function gather(): Promise<Title[]> {
  const favourites = favouriteGenres(tasteWatched()).slice(0, GENRES);
  const [liked, movies, shows] = await Promise.all([taste(), tmdbList('movies-today').catch(() => null), tmdbList('series-today').catch(() => null)]);
  const failures: unknown[] = [];
  const lists = movies || shows ? [movies ?? [], shows ?? [], ...(await Promise.all(favourites.map((key) => tmdbGenre(key, failures)))).flat()] : await catalogLists(favourites, failures);
  const feed = buildFeed(lists, { seen: (title) => isWatched(title) || lastWatchedAt(title.id) > 0, unwanted: new Set([...liked.hidden, ...liked.down]) });
  const allowed = await allowedTitles(feed);
  // Nothing because sources failed is an error to retry, not "nothing popular".
  if (!allowed.length && failures.length) throw failures[0];
  return allowed;
}

interface Slide {
  title: Title;
  el: HTMLElement;
  art: HTMLElement;
  side: HTMLElement;
  status: HTMLElement;
  play: HTMLButtonElement;
  /** Made the first time the slide is on screen. */
  trailer: ReturnType<typeof createHeroTrailer> | null;
  /** Play trailer was pressed (with Reduce motion, nothing starts otherwise). */
  requested: boolean;
}

export function createShortsPage(ctx: RoomContext): HTMLElement {
  const { openDetail } = titleHandlers(ctx);
  let sound = false;
  let slides: Slide[] = [];
  let current = -1;
  /** Each title's YouTube id, looked up once. */
  const keys = new Map<string, Promise<string | undefined>>();

  const feed = h('div', { class: 'shorts-feed', role: 'feed', 'aria-label': t('shorts.title'), 'aria-busy': 'true' });
  const position = h('span', { class: 'shorts-position' });
  const live = h('p', { class: 'shorts-live', role: 'status', 'aria-live': 'polite' });
  const arrow = (step: 1 | -1) => {
    const label = step > 0 ? t('shorts.next') : t('shorts.previous');
    const button = h('button', { class: 'button glass icon-only shorts-arrow', title: label, 'aria-label': label, tabindex: '-1' }, icon(step > 0 ? 'chevronDown' : 'chevronUp'));
    button.addEventListener('click', () => go(step));
    return button;
  };
  const root = h(
    'div',
    { class: 'shorts', tabindex: '-1', 'data-autofocus': true },
    feed,
    h('div', { class: 'shorts-top' }, h('span', { class: 'eyebrow' }, t('shorts.title')), position),
    h('div', { class: 'shorts-arrows', 'data-nav-skip': true }, arrow(-1), arrow(1)),
    live,
  );

  const keyFor = (title: Title): Promise<string | undefined> => {
    let found = keys.get(title.id);
    if (!found) {
      const own = trailerId(title);
      found = own ? Promise.resolve(own) : loadMeta(title.type, title.id).then((full) => (full ? trailerId(full) : undefined)).catch(() => undefined);
      keys.set(title.id, found);
    }
    return found;
  };

  const elementAt = (index: number): HTMLElement | undefined => (index < slides.length ? slides[index]?.el : endCard);

  function trailerOf(slide: Slide): ReturnType<typeof createHeroTrailer> {
    if (!slide.trailer) {
      slide.trailer = createHeroTrailer({
        className: 'shorts-video',
        delayMs: 0,
        loop: true,
        sound: () => sound,
        onSound: (on) => {
          sound = on;
          saveShortsSound(on).catch((err: unknown) => console.warn('Could not remember the Shorts sound', err));
        },
      });
      slide.trailer.button.dataset.shortsAction = 'sound';
      slide.art.append(...slide.trailer.media);
      slide.side.append(slide.trailer.button);
    }
    return slide.trailer;
  }

  function playSlide(slide: Slide): void {
    const auto = trailersAllowed();
    slide.play.hidden = auto || slide.requested;
    if (!auto && !slide.requested) return;
    trailerOf(slide).start(
      slide.title.id,
      () =>
        keyFor(slide.title).then((id) => {
          slide.status.hidden = !!id;
          return id;
        }),
      slide.requested,
    );
  }

  /** Looks the next trailer up ahead; a title without one leaves the feed before it's reached. */
  function warm(slide: Slide): void {
    void keyFor(slide.title).then((id) => {
      // Left while it was looked up: nothing more is fetched or started for a page that's gone.
      if (discarded) return;
      if (!id) return remove(slide);
      if (trailersAllowed()) void invoke('trailer_preview', { id }).catch(() => {});
    });
  }

  /** Puts `index` on screen: its trailer plays, the next gets ready, the rest let go of their video. */
  function activate(index: number, focusAction?: string): void {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const action = focusAction ?? (active && slides.some((s) => s.el.contains(active)) ? active.dataset.shortsAction : undefined);
    current = index;
    slides.forEach((slide, i) => {
      const role = slideRole(i, index);
      if (role === 'play') return playSlide(slide);
      slide.requested = false;
      slide.trailer?.stop();
      if (role === 'preload') warm(slide);
    });
    const slide = slides[index];
    position.textContent = slide ? t('explore.queue.position', { index: index + 1, count: slides.length }) : '';
    live.textContent = slide ? slide.title.name : t('shorts.end-title');
    // Focus follows to the same action on the new title, as the Discovery Queue's does.
    if (action || focusAction) {
      const target = slide ? (slide.el.querySelector<HTMLElement>(`[data-shorts-action="${action}"]:not([hidden])`) ?? slide.el.querySelector<HTMLElement>('[data-shorts-action="open"]')) : endCard.querySelector<HTMLElement>('button');
      target?.focus({ preventScroll: true });
    }
  }

  /** Takes `slide` out of the feed; the next title moves into its place. */
  function remove(slide: Slide, focusAction?: string): void {
    const index = slides.indexOf(slide);
    if (index < 0) return;
    // A title without a trailer is only dropped quietly while it isn't on screen.
    if (index === current && !focusAction) return;
    slide.trailer?.stop();
    observer.unobserve(slide.el);
    const next = withoutAt(slides, index, current);
    slides = next.feed;
    slide.el.remove();
    activate(next.current, focusAction);
  }

  function go(step: number): void {
    const target = elementAt(stepTo(current, step, slides.length + 1));
    target?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'instant' : 'smooth' });
  }

  function meta(title: Title): HTMLElement {
    const parts: (Node | string)[] = [];
    const year = displayYear(title.year);
    if (year) parts.push(h('span', {}, year));
    if (!spoilers().ratings) {
      const imdb = title.rating?.trim();
      const tmdb = tmdbRating(title.id);
      if (imdb) parts.push(ratingBadge('imdb', imdb));
      else if (tmdb !== undefined) parts.push(h('span', {}, t('explore.queue.rating', { rating: formatDecimal(tmdb) })));
    }
    return h('div', { class: 'hero-meta' }, ...parts.flatMap((part, i) => (i ? [h('span', { class: 'meta-dot', 'aria-hidden': 'true' }, '·'), part] : [part])));
  }

  function makeSlide(title: Title): Slide {
    const art = withHue(h('div', { class: 'shorts-art' }, backdropImage(title, 'shorts-backdrop')), fallbackHue(title.id));
    const status = h('p', { class: 'shorts-status', hidden: true }, t('shorts.no-trailer'));
    const action = (id: string, className: string, ...children: (Node | string)[]) => h('button', { class: className, 'data-shorts-action': id }, ...children);
    const play = action('play', 'button primary', icon('play', { filled: true }), t('shorts.play'));
    const open = action('open', 'button glass', icon('info'), t('shorts.open'));
    const save = action('save', 'button glass');
    const hide = action('hide', 'button glass', icon('eyeOff'), t('explore.queue.not-interested'));
    const side = h('div', { class: 'shorts-side' });
    const drawSave = () => {
      const saved = inLibrary(title.id);
      save.setAttribute('aria-pressed', String(saved));
      save.replaceChildren(icon(saved ? 'check' : 'plus'), saved ? t('shorts.saved') : t('shorts.save'));
    };
    drawSave();
    const el = h(
      'article',
      { class: 'shorts-slide', 'aria-label': title.name, 'data-title-id': title.id },
      art,
      h('div', { class: 'shorts-shade', 'aria-hidden': 'true' }),
      h('div', { class: 'shorts-info' }, h('h2', { class: 'shorts-name', dir: 'auto' }, title.name), meta(title), status, h('div', { class: 'shorts-actions' }, play, open, save, hide)),
      side,
    );
    const slide: Slide = { title, el, art, side, status, play, trailer: null, requested: false };
    play.hidden = true;
    play.addEventListener('click', () => {
      slide.requested = true;
      playSlide(slide);
      // The button goes once the trailer starts: focus moves to the next action.
      open.focus({ preventScroll: true });
    });
    open.addEventListener('click', () => openDetail(title));
    save.addEventListener('click', () => void toggleLibrary(title).then(drawSave));
    hide.addEventListener('click', () => {
      hideTitle(title);
      remove(slide, 'hide');
    });
    return slide;
  }

  const endCard = h(
    'section',
    { class: 'shorts-slide shorts-end' },
    h('div', { class: 'shorts-message' }, h('h2', { class: 'home-message-title' }, t('shorts.end-title')), h('p', { class: 'muted' }, t('shorts.end-body')), backButton()),
  );

  function backButton(): HTMLElement {
    const back = h('button', { class: 'button primary' }, t('titles.common.back'));
    back.addEventListener('click', () => ctx.back());
    return back;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue;
        const index = entry.target === endCard ? slides.length : slides.findIndex((s) => s.el === entry.target);
        if (index >= 0 && index !== current) activate(index);
      }
    },
    { root: feed, threshold: 0.6 },
  );

  function message(title: string, body: string, action?: HTMLElement): void {
    feed.replaceChildren(h('div', { class: 'shorts-slide shorts-end' }, h('div', { class: 'shorts-message' }, h('h2', { class: 'home-message-title' }, title), h('p', { class: 'muted' }, body), action ?? '')));
  }

  function load(): void {
    feed.setAttribute('aria-busy', 'true');
    message(t('shorts.loading'), '');
    void Promise.all([gather(), loadShortsSound().catch(() => false)])
      .then(([titles, saved]) => {
        // Left while the titles were gathered: nothing is set up, so no trailer is looked up for a page that's gone.
        if (discarded) return;
        sound = saved;
        slides = titles.map(makeSlide);
        if (!slides.length) return message(t('shorts.empty-title'), t('shorts.empty-body'), backButton());
        feed.replaceChildren(...slides.map((s) => s.el), endCard);
        for (const el of [...slides.map((s) => s.el), endCard]) observer.observe(el);
        activate(0, root === document.activeElement ? 'open' : undefined);
      })
      .catch((err: unknown) => {
        console.warn('Shorts: could not gather titles', err);
        const retry = h('button', { class: 'button' }, t('browse.search.retry'));
        retry.addEventListener('click', load);
        message(t('shorts.failed-title'), t('shorts.failed-body'), retry);
      })
      .finally(() => feed.removeAttribute('aria-busy'));
  }

  root.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isEditing(event.target) || current < 0) return;
    const step = event.key === 'ArrowDown' || event.key === 'PageDown' ? 1 : event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 0;
    if (!step) return;
    // Up and down page the feed; left and right still move between the buttons.
    event.preventDefault();
    go(step);
  });

  let wheelTravel = 0;
  let wheelRestUntil = 0;
  feed.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || current < 0) return;
      event.preventDefault();
      const now = performance.now();
      if (now < wheelRestUntil) {
        wheelRestUntil = now + WHEEL_REST_MS;
        return;
      }
      wheelTravel += event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : event.deltaY * WHEEL_STEP;
      if (Math.abs(wheelTravel) < WHEEL_STEP) return;
      go(Math.sign(wheelTravel));
      wheelTravel = 0;
      wheelRestUntil = now + WHEEL_REST_MS;
    },
    { passive: false },
  );

  let discarded = false;
  root.addEventListener(VIEW_DISCARDED, () => {
    discarded = true;
    observer.disconnect();
    for (const slide of slides) slide.trailer?.stop();
  });

  load();
  return root;
}
