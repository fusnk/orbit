import { pageUnseen } from '../../app/window-activity';
import { t, tn } from '../../i18n';
import { loadMeta } from '../../catalog/service';
import { displayYear, fallbackHue, isShowType, type Title } from '../../catalog/titles';
import { ageRatingSlot } from '../../components/age-rating';
import { whereToWatchSlot } from '../../components/where-to-watch';
import { backdropImage, titleMeta } from '../../components/cards';
import { icon } from '../../components/icons';
import { findLogo, logoImage } from '../../components/title-logo';
import { artHue } from '../../lib/art-hue';
import { h } from '../../lib/dom';
import { isShown } from '../../lib/shown';
import { DEFAULT_AMBIENT_HUE, setAmbientHue } from '../../theme/ambient';
import { appearance, reducedMotion } from '../../theme/appearance';
import { createHeroTrailer } from '../detail/hero-trailer';
import { BANNER_TRAILER_KEY } from '../detail/trailer-settings';

const ROTATE_MS = 8000;
/** How often the time shown is counted: the Arc bar's ring timer eases between counts (home.css). */
const TICK_MS = 250;
/** Gives each banner's list of picks its own heading id. */
let heroCount = 0;

interface HeroActions {
  primaryLabel(title: Title): string;
  play(title: Title): void;
  details(title: Title): void;
  inLibrary(title: Title): boolean;
  /** Where the title stands in its popular list (1 = top). */
  rank(title: Title): number | undefined;
  /** Why a title that isn't ranked is featured ("Because you watched Ronin"), shown in place of the rank. */
  reason?(title: Title): string | undefined;
  /** Resolves once saved (or rolled back). */
  toggleLibrary(title: Title): Promise<unknown>;
  /** Badges for the banner's "what's next" form (Home builder): the picture quality, when known. The age rating has its own badge. */
  badges(title: Title): string[];
  /** Whether title logos are shown (Settings → Library & Metadata). */
  logos(): boolean;
}

/** What another page (Discover) adds to the banner. */
export interface HeroExtras {
  /** The eyebrow badge's text, in place of the title's rank or "Trending". */
  eyebrow?(title: Title, index: number, count: number): string;
  /** More buttons after My Library (e.g. thumbs up and down), given the title shown. */
  actions?(current: () => Title): HTMLElement[];
  /** Called each time a title is shown, so those buttons can follow it. */
  onShow?(title: Title): void;
  /** The slide to start on. */
  start?: number;
}

const dot = () => h('span', { class: 'meta-dot', 'aria-hidden': 'true' }, '·');

/** A show's seasons, specials left out; 0 when its details aren't known. */
const seasonCount = (title: Title): number => title.seasons?.filter((season) => season.number > 0).length ?? 0;

/**
 * The Spotlight banner's line of facts: "Show · Drama · 2019 · 3 seasons",
 * then the age rating once it's known. Blanks are left out, so no
 * separator dangles.
 */
function factsLine(title: Title): (Node | string)[] {
  const kind = title.type === 'movie' ? t('search.kind.movie') : isShowType(title.type) ? t('search.kind.series') : '';
  const seasons = seasonCount(title);
  const words = [kind, title.genres[0], displayYear(title.year), seasons ? tn('browse.hero.seasons', seasons) : ''].map((word) => word?.trim() ?? '').filter(Boolean);
  const parts: (Node | string)[] = words.flatMap((word, i) => (i ? [dot(), h('span', {}, word)] : [h('span', {}, word)]));
  parts.push(ageRatingSlot(title, { dot: parts.length > 0 }), whereToWatchSlot(title));
  return parts;
}

/** The hero frame while catalogs load: a skeleton of the text block. */
export function heroSkeleton(): HTMLElement {
  return h(
    'section',
    { class: 'hero', 'aria-busy': 'true', 'aria-label': t('browse.hero.featured'), 'data-nav-banner': true },
    h(
      'div',
      { class: 'hero-content hero-skeleton', 'aria-hidden': 'true' },
      h('div', { class: 'skeleton eyebrow-bar' }),
      h('div', { class: 'skeleton title-bar' }),
      h('div', { class: 'skeleton meta-bar' }),
      h('div', { class: 'skeleton desc-bar' }),
      h('div', { class: 'hero-actions' }, h('div', { class: 'skeleton pill' }), h('div', { class: 'skeleton pill' })),
    ),
  );
}

/**
 * Rotating featured banner. Crossfades after 8 s on screen, the count
 * paused while hovered or while it holds keyboard focus (so it never changes
 * under the user), while the title's trailer plays (Settings → Video) or the
 * page is out of sight (app/window-activity.ts), and not at all with reduced
 * motion. Its artwork hue drives the page's ambient glow. The Arc bar shows
 * the count as a ring with "2 / 5" and arrows in place of the dots (home.css).
 */
export function createHero(items: Title[], actions: HeroActions, extras: HeroExtras = {}): HTMLElement {
  let index = 0;
  /** How long the slide has been on screen and watchable, toward ROTATE_MS. */
  let elapsed = 0;
  const hues = new Map<string, number>();
  const slides = items.map((title, i) => backdropImage(title, 'hero-art', i === 0));
  const badge = h('span', { class: 'hero-badge' });
  const nameText = h('span', { class: 'hero-name' });
  const name = h('h1', { class: 'hero-title' }, nameText);
  const meta = h('div', { class: 'hero-meta' });
  // The Spotlight style's line in place of `meta` (home.css shows one or the other).
  const facts = h('div', { class: 'hero-meta hero-facts' });
  const qualities = h('span', { class: 'hero-badges' });
  const logos = new Map<string, HTMLImageElement>();
  const description = h('p', { class: 'hero-desc' });
  const trailer = createHeroTrailer({ setting: BANNER_TRAILER_KEY, className: 'hero-trailer' });
  trailer.button.dataset.navAxis = 'horizontal';

  const play = h('button', { class: 'button large primary', 'data-autofocus': true });
  const details = h('button', { class: 'button large glass' }, icon('info'), t('browse.hero.details'));
  const library = h('button', { class: 'button large glass icon-only' });
  play.addEventListener('click', () => actions.play(items[index]!));
  details.addEventListener('click', () => actions.details(items[index]!));
  library.addEventListener('click', () => {
    void actions.toggleLibrary(items[index]!).then(renderLibrary);
    renderLibrary();
  });

  // The Carousel's peeking slides show their title when clicked (the dots do the same for the keyboard).
  slides.forEach((slide, i) => {
    if (!slide) return;
    slide.addEventListener('click', () => {
      if (appearance().heroStyle === 'carousel' && !slide.classList.contains('active')) show(i);
    });
  });

  const dots = items.map((title, i) => {
    const dot = h('button', { class: 'hero-dot', title: title.name, 'aria-label': t('browse.hero.show', { name: title.name }), 'data-nav-axis': 'horizontal' });
    dot.addEventListener('click', () => show(i));
    return dot;
  });

  // The Arc bar's controls (home.css shows them in place of the dots): previous and next, which
  // slide this is, and a ring that fills as the slide's time passes (--hero-elapsed, 0 to 1).
  const step = (by: number, label: string, glyph: 'chevronLeft' | 'chevronRight') => {
    const button = h('button', { class: 'hero-step', title: label, 'aria-label': label, 'data-nav-axis': 'horizontal' }, icon(glyph));
    button.addEventListener('click', () => show(index + by));
    return button;
  };
  const countText = h('span', { class: 'hero-count-text', dir: 'ltr', 'aria-hidden': 'true' });
  const countLabel = h('span', { class: 'hero-count-label' });
  const timer = h('span', { class: 'hero-timer' }, step(-1, t('orbitlook.hero.previous'), 'chevronLeft'), step(1, t('orbitlook.hero.next'), 'chevronRight'), h('span', { class: 'hero-count' }, countText, countLabel), h('span', { class: 'hero-ring', 'aria-hidden': 'true' }));

  // "Show what's next" (Home builder): the featured titles as a list beside the text, in place of the dots.
  // Hidden otherwise (home.css), and its lazy artwork isn't fetched while it is.
  const upNext = items.map((title, i) => {
    const button = h(
      'button',
      { class: 'hero-queue-item', 'aria-label': t('browse.hero.show', { name: title.name }), 'data-focus-id': `hero-queue:${title.id}` },
      h('span', { class: 'hero-queue-num', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
      h('span', { class: 'hero-queue-thumb' }, h('span', { class: 'hero-queue-thumb-name', dir: 'auto', 'aria-hidden': 'true' }, title.name), backdropImage(title, 'art')),
      h('span', { class: 'hero-queue-text' }, h('span', { class: 'hero-queue-name', dir: 'auto' }, title.name), title.year ? h('span', { class: 'hero-queue-year' }, title.year) : ''),
    );
    button.addEventListener('click', () => show(i));
    return button;
  });

  // Scrolls on its own when the picks don't all fit beside the banner (data-nav-scroller: see spatial.ts).
  const queue = h('div', { class: 'hero-queue-list', 'data-nav-scroller': true }, ...upNext);
  const queueId = `hero-queue-${++heroCount}`;

  const hero = h(
    'section',
    { class: 'hero', 'aria-roledescription': t('browse.hero.carousel'), 'aria-label': t('browse.hero.featured'), 'data-nav-banner': true },
    // One layer for the picture, so a banner that fades into the page can fade it as a whole (home.css).
    h('div', { class: 'hero-media' }, ...slides, ...trailer.media, h('div', { class: 'hero-shade title-shade', 'aria-hidden': 'true' })),
    h(
      'div',
      { class: 'hero-content' },
      h('div', { class: 'hero-eyebrow' }, badge),
      name,
      meta,
      facts,
      description,
      h('div', { class: 'hero-actions' }, play, details, library, ...(extras.actions?.(() => items[index]!) ?? [])),
    ),
    items.length > 1 ? h('div', { class: 'hero-dots' }, ...dots, timer) : '',
    items.length > 1 ? h('div', { class: 'hero-queue', role: 'group', 'aria-labelledby': `${queueId}-head` }, h('h2', { class: 'hero-queue-head', id: `${queueId}-head` }, t('homerows.hero.next')), queue) : '',
    trailer.button,
  );

  function renderLibrary(): void {
    const on = actions.inLibrary(items[index]!);
    const label = on ? t('browse.hero.remove-library') : t('browse.hero.add-library');
    library.title = label;
    library.setAttribute('aria-label', label);
    library.replaceChildren(icon(on ? 'check' : 'plus'));
  }

  /**
   * The title's logo in place of its name, when it has one (looked up for the
   * featured title only, and dropped if the slide has moved on meanwhile). The
   * name stays in the heading for screen readers, and comes back if the logo fails.
   */
  function renderLogo(title: Title): void {
    name.querySelector('.hero-logo')?.remove();
    name.classList.remove('has-logo');
    if (!actions.logos()) return;
    const known = logos.get(title.id);
    if (known) return placeLogo(known);
    void findLogo(title).then((src) => {
      if (!src || items[index] !== title || logos.has(title.id)) return;
      const img = logoImage(src, 'hero-logo', true);
      img.addEventListener('load', () => name.classList.toggle('has-logo', items[index] === title));
      img.addEventListener('error', () => {
        logos.delete(title.id);
        img.remove();
        if (items[index] === title) name.classList.remove('has-logo');
      });
      logos.set(title.id, img);
      placeLogo(img);
    });
  }

  /** Kept once loaded, so coming round again swaps straight to it, without the name showing for a moment. */
  function placeLogo(logo: HTMLImageElement): void {
    name.classList.toggle('has-logo', logo.complete && logo.naturalWidth > 0);
    name.append(logo);
  }

  /**
   * Spotlight's facts. A show from a catalog rarely says how many seasons it
   * has, so its details (cached; the trailer and logo look them up too) fill
   * that in, only while Spotlight is the style and the slide hasn't moved on.
   */
  function renderFacts(title: Title): void {
    facts.replaceChildren(...factsLine(title));
    if (appearance().heroStyle !== 'spotlight' || title.type !== 'series' || seasonCount(title)) return;
    void loadMeta(title.type, title.id)
      .then((full) => {
        if (full?.seasons && items[index] === title) facts.replaceChildren(...factsLine({ ...title, seasons: full.seasons }));
      })
      .catch(() => {});
  }

  /** Scrolls the list of picks (only it, never the page) so the one shown is in view. */
  function revealInQueue(item: HTMLElement | undefined): void {
    if (!item || !queue.clientHeight) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    const to = top < queue.scrollTop ? top : bottom > queue.scrollTop + queue.clientHeight ? bottom - queue.clientHeight : null;
    if (to !== null) queue.scrollTo({ top: to, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  /** The page's ambient glow follows the featured artwork. */
  function applyHue(title: Title): void {
    const hue = hues.get(title.id) ?? fallbackHue(title.id);
    // The router re-applies the page's data-hue whenever Home is shown again.
    const page = hero.closest<HTMLElement>('.home');
    if (page) page.dataset.hue = String(hue);
    if (isShown(hero)) setAmbientHue(hue);
  }

  function show(i: number): void {
    index = (i + items.length) % items.length;
    const title = items[index]!;
    // The Carousel banner shows the slides either side of this one peeking in at the edges (home.css).
    const after = items.length > 1 ? (index + 1) % items.length : -1;
    const before = items.length > 2 ? (index - 1 + items.length) % items.length : -1;
    slides.forEach((slide, j) => {
      if (!slide) return;
      slide.classList.toggle('active', j === index);
      slide.classList.toggle('next', j === after);
      slide.classList.toggle('prev', j === before);
    });
    dots.forEach((dot, j) => dot.setAttribute('aria-current', String(j === index)));
    upNext.forEach((item, j) => item.setAttribute('aria-current', String(j === index)));
    countText.textContent = `${index + 1} / ${items.length}`;
    countLabel.textContent = t('orbitlook.hero.position', { index: index + 1, count: items.length });
    elapsed = 0;
    // A new slide's ring starts empty at once rather than winding back.
    hero.classList.add('hero-timer-reset');
    hero.style.setProperty('--hero-elapsed', '0');
    revealInQueue(upNext[index]);
    const rank = actions.rank(title);
    const reason = actions.reason?.(title);
    badge.textContent = extras.eyebrow
      ? extras.eyebrow(title, index, items.length)
      : reason
        ? reason
        : rank
        ? t(title.type === 'movie' ? 'browse.hero.rank-movies' : 'browse.hero.rank-shows', { rank })
        : t('browse.hero.trending');
    nameText.textContent = title.name;
    renderLogo(title);
    qualities.replaceChildren(...actions.badges(title).map((text) => h('span', { class: 'hero-quality' }, text)));
    const known = titleMeta(title);
    meta.replaceChildren(...known, ageRatingSlot(title, { dot: known.length > 0 }), whereToWatchSlot(title), qualities);
    renderFacts(title);
    description.textContent = title.description ?? '';
    play.replaceChildren(icon('play', { filled: true }), actions.primaryLabel(title));
    renderLibrary();
    extras.onShow?.(title);
    applyHue(title);
    // Catalog entries don't name trailers: the title's details (cached) are looked up once its delay is over.
    trailer.start(title.id, async () => title.trailers?.[0] ?? (await loadMeta(title.type, title.id).catch(() => null))?.trailers?.[0]);
    // Fetch and decode the next slide's art now, so the crossfade doesn't stall on it.
    const upcoming = slides[(index + 1) % slides.length];
    if (upcoming) {
      upcoming.loading = 'eager';
      void upcoming.decode().catch(() => {});
    }
  }
  show(extras.start ?? 0);
  // The list has no size until the banner is on the page and the window is wide enough to show it.
  new ResizeObserver(() => revealInQueue(upNext[index])).observe(queue);

  // Sample each backdrop's hue once; black-and-white art keeps the warm default.
  for (const title of items) {
    if (!title.background) continue;
    void artHue(title.background).then((hue) => {
      hues.set(title.id, hue ?? DEFAULT_AMBIENT_HUE);
      if (items[index] === title) applyHue(title);
    });
  }

  if (!reducedMotion() && items.length > 1) {
    const timer = setInterval(() => {
      // Taken out of Home's banner slot (Home loading again after a failure): this banner is gone for good,
      // and the timer would otherwise keep it, its artwork and its trailer for the rest of the session.
      if (!hero.parentNode) {
        clearInterval(timer);
        trailer.stop();
        return;
      }
      hero.classList.remove('hero-timer-reset');
      // Not while nobody can see it (another page, or the window minimised or in the tray) or is looking (another window has focus, or ambient mode covers it).
      if (pageUnseen() || !isShown(hero) || hero.matches(':hover') || hero.contains(document.activeElement) || trailer.busy()) return;
      elapsed += TICK_MS;
      if (elapsed >= ROTATE_MS) return show(index + 1);
      // Drawn only by the Arc bar's ring: elsewhere nothing restyles the banner four times a second.
      if (document.documentElement.dataset.nav === 'arc') hero.style.setProperty('--hero-elapsed', String(elapsed / ROTATE_MS));
    }, TICK_MS);
  }
  return hero;
}
