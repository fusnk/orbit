/**
 * Spatial navigation: arrow keys move focus to the nearest focusable element
 * in that direction, so keyboard (and later gamepad) users can reach
 * everything on screen. Focus only moves; Enter/Space activates.
 *
 * Elements inside `[inert]` (e.g. the page behind an open drawer) or
 * `[data-nav-skip]` (mouse-only affordances like window controls) are ignored.
 * Inside a `[data-nav-region]` (a panel beside the page, like Theme Studio),
 * focus stays in the region while anything in it lies that way. From outside
 * every region, up and down likewise keep out of them while anything else lies
 * that way: a sidebar that stays put while the page scrolls (Settings') is
 * beside the page, not below it. A region stacked above or below the page (the
 * same sidebar in a narrow window) is on the way, so it's reached as usual.
 * Left and right from outside every region go along the row first, then to a
 * region beside the page that way, and never between the page and the title bar.
 * Up and down look in the page before the title bar.
 */
import { reducedMotion } from '../theme/appearance';
import { glide } from './glide';

export type Direction = 'left' | 'right' | 'up' | 'down';

const DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

// The first press is never delayed; only auto-repeat is throttled, so holding
// a key scrolls through a rail at a readable pace.
const REPEAT_INTERVAL = { horizontal: 80, vertical: 110 };
// tabindex="-1" on anything but a control marks a place focus is only put programmatically (a dialog, a step's
// heading), which shows no ring, so arrows don't stop there. Controls keep it for roving focus (the nav's items).
// `data-nav-stop` (with tabindex="-1") is a stop for the arrows only, not Tab: a row still loading (cards.ts),
// so holding Down waits there instead of skipping every row still loading.
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [data-nav-stop]';

/** Whether `el` is a field being typed in, which keeps arrow keys, Backspace and shortcut letters. */
export function isEditing(el: EventTarget | null): boolean {
  if (el instanceof HTMLInputElement) return !el.readOnly && !['button', 'checkbox', 'color', 'radio', 'range'].includes(el.type);
  // A read-only text area (the copy-by-hand diagnostics boxes) takes no typing, so arrows must be able to leave it.
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Whether `el` has a box that shows. `drawn`: and isn't in a part of the page the browser skips drawing
 * (`content-visibility: auto`, Home's rows off screen). Measuring an element in such a part makes the
 * browser lay that part out there and then, for every key press. Nothing there is on screen, nor next to
 * it (Home draws the rows ahead), so arrows leave them out until they're drawn. `visibility: hidden`
 * can't take focus, so it's no place to stop either.
 */
function shows(el: HTMLElement, drawn: boolean): boolean {
  if (typeof el.checkVisibility !== 'function') return el.getClientRects().length > 0;
  return el.checkVisibility({ contentVisibilityAuto: drawn, visibilityProperty: true });
}

/** What can take focus, before asking what shows: kept between key presses until the page's structure changes. */
let structural: HTMLElement[] | null = null;
let structureWatch: MutationObserver | null = null;

/**
 * The page's focusable elements outside `[inert]`, `[data-nav-skip]` and `[hidden]`. Finding them is most
 * of a key press's work on a Home of thousands of elements, and holding a key asks again every 80–110 ms
 * while nothing but the scroll position changes, so the list is kept until something is added, removed,
 * hidden, disabled or made (un)focusable.
 */
function focusables(): HTMLElement[] {
  if (!structureWatch) {
    structureWatch = new MutationObserver(() => (structural = null));
    structureWatch.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'inert', 'tabindex', 'href', 'data-nav-skip', 'data-nav-stop'],
    });
  }
  // Changes made earlier in this same task haven't been reported yet.
  if (structureWatch.takeRecords().length) structural = null;
  structural ??= [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert], [data-nav-skip], [hidden]'));
  return structural;
}

function candidates(drawn = true): HTMLElement[] {
  return focusables().filter((el) => el.isConnected && !(el as HTMLButtonElement).disabled && shows(el, drawn));
}

interface Measure {
  /** Distance along the direction of travel. */
  gap: number;
  /** Distance across it (0 when the two overlap on that axis). */
  crossGap: number;
  /** Distance between centres across the direction of travel. */
  offset: number;
}

/** Rows whose gaps differ by less than this count as the same next row. */
const ROW_SLACK = 24;

/** Measures `b` relative to `a`, or returns null if it doesn't lie in `direction`. */
function measure(a: DOMRect, b: DOMRect, direction: Direction): Measure | null {
  const SLACK = 2;
  if (direction === 'left' || direction === 'right') {
    if (direction === 'right' ? b.left < a.right - SLACK : b.right > a.left + SLACK) return null;
    return {
      gap: Math.max(0, direction === 'right' ? b.left - a.right : a.left - b.right),
      crossGap: Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)),
      offset: Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)),
    };
  }
  if (direction === 'down' ? b.top < a.bottom - SLACK : b.bottom > a.top + SLACK) return null;
  return {
    gap: Math.max(0, direction === 'down' ? b.top - a.bottom : a.top - b.bottom),
    crossGap: Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)),
    offset: Math.abs(a.left + a.width / 2 - (b.left + b.width / 2)),
  };
}

const byCross = (x: Measure, y: Measure) => x.crossGap - y.crossGap || x.offset - y.offset;

/**
 * Picks the next element in `direction`.
 * - Left/right stay in the current row when anything in it lies that way.
 * - Up/down go to the nearest row first, then to the element in that row
 *   closest across. Rows are visited in reading order, so a row of buttons
 *   off to one side (e.g. the welcome card's) isn't skipped just because a
 *   card further down happens to line up.
 * `data-nav-axis="horizontal"` marks secondary controls (a rail's "See all",
 * the hero's dots) that only left/right reach, so up/down go row to row.
 */
export function pickNext<T>(
  origin: DOMRect,
  options: readonly { item: T; rect: DOMRect; horizontalOnly?: boolean }[],
  direction: Direction,
): T | null {
  const vertical = direction === 'up' || direction === 'down';
  const found: (Measure & { item: T })[] = [];
  for (const option of options) {
    if (vertical && option.horizontalOnly) continue;
    const m = measure(origin, option.rect, direction);
    if (m) found.push({ item: option.item, ...m });
  }
  if (!found.length) return null;

  if (vertical) {
    const nextRow = Math.min(...found.map((m) => m.gap)) + ROW_SLACK;
    return found.filter((m) => m.gap <= nextRow).sort(byCross)[0]!.item;
  }
  const sameRow = found.filter((m) => m.crossGap === 0);
  if (sameRow.length) return sameRow.sort((x, y) => x.gap - y.gap || x.offset - y.offset)[0]!.item;
  const loose = (m: Measure) => m.gap + m.crossGap * 3 + m.offset * 0.3;
  return found.sort((x, y) => loose(x) - loose(y))[0]!.item;
}

/**
 * In a list that scrolls on its own (`data-nav-scroller`, e.g. the banner's
 * picks, a row of cards), the entries scrolled out of it still lie beside or
 * under the things around it, so from outside the list only the ones showing
 * in it count. From inside, the next one along is reached as usual (and
 * scrolled to). `boxes` keeps each list's box for one key press.
 */
function scrolledAway(el: HTMLElement, rect: DOMRect, from: HTMLElement, boxes: Map<HTMLElement, DOMRect>): boolean {
  const list = el.closest<HTMLElement>('[data-nav-scroller]');
  if (!list || list.contains(from)) return false;
  let box = boxes.get(list);
  if (!box) boxes.set(list, (box = list.getBoundingClientRect()));
  return !middleWithin(rect, box);
}

/** Whether `region` lies beside `origin` (they share no columns) rather than above or below it. */
export function besideRegion(region: Pick<DOMRect, 'left' | 'right'>, origin: Pick<DOMRect, 'left' | 'right'>): boolean {
  return region.right <= origin.left || region.left >= origin.right;
}

/** A `[data-nav-region]`, or a stand-in for one in tests. */
interface Region {
  getBoundingClientRect(): Pick<DOMRect, 'left' | 'right'>;
}

export interface NavOption<T> {
  item: T;
  rect: DOMRect;
  horizontalOnly?: boolean;
  /** The region it's in, if any. */
  region?: Region | null;
  /** It's in the title bar. */
  titlebar?: boolean;
}

/** Where focus goes from `from` (see the module comment); `nearest` hands it what's on screen. */
export function chooseNext<T>(from: { rect: DOMRect; region: Region | null; titlebar: boolean }, options: readonly NavOption<T>[], direction: Direction): T | null {
  const origin = from.rect;
  if (from.region) {
    const inRegion = pickNext(origin, options.filter((o) => o.region === from.region), direction);
    if (inRegion) return inRegion;
  }
  if (direction === 'up' || direction === 'down') {
    // The page first, then the title bar: a row scrolled up under a floating bar is nearer the one below
    // it than the bar's buttons are, though they show nearer, so Up went to the menu instead of back.
    const page = from.titlebar ? options : options.filter((o) => !o.titlebar);
    const outside = !from.region && pickNext(origin, page.filter((o) => !o.region || !besideRegion(o.region.getBoundingClientRect(), origin)), direction);
    return outside || pickNext(origin, page, direction) || pickNext(origin, options, direction);
  }
  // Left and right never jump from the page up into the title bar (Up reaches it): from the foot of a
  // Settings category, Right would otherwise land on the profile button, the only thing further right.
  // Nor down from it into the page (Down reaches that): Right from its last button landed on a card far
  // down the page, often one scrolled out of sight in a row.
  const usable = options.filter((o) => !!o.titlebar === from.titlebar);
  if (!from.region) {
    // Nothing in the same row: a region beside the page that way (Settings' sidebar) comes before a
    // control in another row of the page, so Left from a switch low in a category reaches the sidebar.
    const sameRow = pickNext(origin, usable.filter((o) => Math.max(o.rect.top, origin.top) <= Math.min(o.rect.bottom, origin.bottom)), direction);
    if (sameRow) return sameRow;
    const thatWay = (box: Pick<DOMRect, 'left' | 'right'>) => (direction === 'left' ? box.right <= origin.left : box.left >= origin.right);
    const region = pickNext(origin, usable.filter((o) => o.region && thatWay(o.region.getBoundingClientRect())), direction);
    if (region) return region;
  }
  return pickNext(origin, usable, direction);
}

/**
 * Whether `el` is part of the title bar. The nav is in the title bar's markup in every layout; the
 * sidebar and rail move it beside the page as a region (nav.ts), where Left and Right must reach it.
 * By markup, not by box: a floating pill and its capsule (Glass) hang below the bar's own strip.
 */
function inTitlebar(el: HTMLElement): boolean {
  const bar = el.closest('.titlebar');
  const region = el.closest('[data-nav-region]');
  // A region inside the bar is the nav moved beside the page; the bar itself may be a region (TV).
  return !!bar && (!region || region === bar || region.contains(bar));
}

function nearest(from: HTMLElement, direction: Direction): HTMLElement | null {
  // Rarely, the next stop up or down is further than the page draws ahead (a very tall section): look again, everywhere.
  // Not from the title bar: what that finds is page scrolled out of sight (Up from the wordmark scrolled the page back to its top).
  return nearestIn(candidates(), from, direction) ?? ((direction === 'up' || direction === 'down') && !inTitlebar(from) ? nearestIn(candidates(false), from, direction) : null);
}

/**
 * From the title bar, page items scrolled up under it or past it (it floats over the page on TV and
 * with the Cinematic bar) are out of sight, not above: Up from the wordmark went to one and scrolled
 * the page back. From the page they're still the next row up.
 */
function behindBar(el: HTMLElement, rect: DOMRect, bar: DOMRect | undefined): boolean {
  return !!bar && !el.closest('.titlebar') && (rect.top + rect.bottom) / 2 < bar.bottom;
}

function nearestIn(pool: readonly HTMLElement[], from: HTMLElement, direction: Direction): HTMLElement | null {
  const boxes = new Map<HTMLElement, DOMRect>();
  const bar = inTitlebar(from) ? document.querySelector<HTMLElement>('#app > .titlebar')?.getBoundingClientRect() : undefined;
  const options = pool
    .filter((el) => el !== from && !el.contains(from) && !from.contains(el))
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ el, rect }) => !scrolledAway(el, rect, from, boxes) && !behindBar(el, rect, bar))
    .map(({ el, rect }) => ({ item: el, rect, horizontalOnly: el.dataset.navAxis === 'horizontal', region: el.closest('[data-nav-region]'), titlebar: inTitlebar(el) }));
  const origin = from.getBoundingClientRect();
  const picked = chooseNext({ rect: origin, region: from.closest('[data-nav-region]'), titlebar: inTitlebar(from) }, options, direction);
  const banner = picked?.closest<HTMLElement>('[data-nav-banner]');
  if (!picked || !banner) return picked;
  const usable = (el: HTMLElement) => options.some((o) => o.item === el && !!measure(origin, o.rect, direction));
  return intoBanner(picked, from, { contains: (el: HTMLElement) => banner.contains(el), primary: banner.querySelector<HTMLElement>('[data-nav-default], [data-autofocus]') }, usable);
}

/**
 * A banner (`data-nav-banner`: Home's, a title page's, Movies'): coming into it from the page around it
 * lands on its main button, whatever of it lies nearest. Up from the first row met the banner's lowest
 * control first (the trailer's speaker in its corner), and the next Up went past its buttons to the menu.
 */
export function intoBanner<T>(picked: T, from: T, banner: { contains(el: T): boolean; primary: T | null } | null, usable: (el: T) => boolean): T {
  if (!banner || banner.contains(from) || !banner.primary || !usable(banner.primary)) return picked;
  return banner.primary;
}

type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;

/** Whether the middle of `rect` lies inside every one of `boxes`. */
export function middleWithin(rect: Box, ...boxes: Box[]): boolean {
  const x = (rect.left + rect.right) / 2;
  const y = (rect.top + rect.bottom) / 2;
  return boxes.every((box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
}

/** Whether `el` shows on screen: in the window and, on a page, in the page's scrolled area. */
export function onScreen(el: HTMLElement): boolean {
  const outlet = el.closest('.outlet');
  const view = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  return middleWithin(el.getBoundingClientRect(), view, ...(outlet ? [outlet.getBoundingClientRect()] : []));
}

/** The option whose middle lies closest to `point` (e.g. where focus was before what had it was removed). */
export function closestTo<T>(point: { x: number; y: number }, options: readonly { item: T; rect: Box }[]): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const { item, rect } of options) {
    const distance = Math.hypot((rect.left + rect.right) / 2 - point.x, (rect.top + rect.bottom) / 2 - point.y);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function entryPoint(): HTMLElement | null {
  const all = candidates();
  // Something on screen first: starting on a control scrolled far away would jump the page.
  const shown = all.filter(onScreen);
  return (
    shown.find((el) => el.matches('[data-autofocus]')) ??
    shown.find((el) => el.closest('.outlet')) ??
    all.find((el) => el.matches('[data-autofocus]')) ??
    all.find((el) => el.closest('.outlet')) ??
    all[0] ??
    null
  );
}

/** The control on screen inside `within` closest to `point`, for focus to land near where it was. */
export function closestOnScreen(within: HTMLElement, point: { x: number; y: number }): HTMLElement | null {
  const shown = candidates().filter((el) => within.contains(el) && onScreen(el));
  return closestTo(point, shown.map((el) => ({ item: el, rect: el.getBoundingClientRect() })));
}

type Span = { start: number; end: number };

/** How far a scroller showing `view` must move to bring `item` in by the least (scrollIntoView's "nearest"). */
export function nearestDelta(item: Span, view: Span): number {
  if (item.start >= view.start && item.end <= view.end) return 0;
  // Bigger than what shows: its start.
  if (item.end - item.start > view.end - view.start || item.start < view.start) return item.start - view.start;
  return item.end - view.end;
}

/** How far a scroller showing `view` must move to put `item`'s middle on its middle (scrollIntoView's "center"). */
export function centerDelta(item: Span, view: Span): number {
  return (item.start + item.end) / 2 - (view.start + view.end) / 2;
}

/** The nearest ancestor of `el` that scrolls along `axis` (has more to show than fits, and may scroll). */
function scrollerOf(el: HTMLElement, axis: 'x' | 'y'): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const overflow = axis === 'x' ? style.overflowX : style.overflowY;
    const more = axis === 'x' ? node.scrollWidth > node.clientWidth : node.scrollHeight > node.clientHeight;
    if (more && (overflow === 'auto' || overflow === 'scroll')) return node;
  }
  return null;
}

/** What shows of `scroller` along `axis`, less its scroll padding (as scrollIntoView counts it). */
function viewOf(scroller: HTMLElement, axis: 'x' | 'y'): Span {
  const box = scroller.getBoundingClientRect();
  const style = getComputedStyle(scroller);
  const pad = (value: string) => (value.endsWith('px') ? parseFloat(value) : 0);
  return axis === 'y'
    ? { start: box.top + pad(style.scrollPaddingTop), end: box.bottom - pad(style.scrollPaddingBottom) }
    : { start: box.left + pad(style.scrollPaddingLeft), end: box.right - pad(style.scrollPaddingRight) };
}

/** Whether a glide following `el` should go on: it's still on the page with a box, and focus is still on it. */
function following(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0 && el.contains(document.activeElement);
}

/**
 * Brings `el` into view as scrollIntoView did (its middle to the page's middle up and down, just in view
 * along a row), but through the one glide per scroller (glide.ts): the browser's smooth scroll restarted
 * from a standstill on every key repeat, so a held arrow made the page lurch, and a second request fought
 * the first. Only the page and the rows in it glide; anything else (a list in a drawer) scrolls as before.
 */
function glideTo(el: HTMLElement, direction: Direction, instant: boolean): boolean {
  const page = scrollerOf(el, 'y');
  if (!page?.classList.contains('outlet')) return false;
  const row = scrollerOf(el, 'x');
  if (row && !page.contains(row)) return false;
  const vertical = direction === 'up' || direction === 'down';
  glide(
    page,
    'y',
    () => {
      if (!following(el)) return null;
      const rect = el.getBoundingClientRect();
      const item = { start: rect.top, end: rect.bottom };
      return vertical ? centerDelta(item, viewOf(page, 'y')) : nearestDelta(item, viewOf(page, 'y'));
    },
    instant,
  );
  if (row) {
    glide(
      row,
      'x',
      () => {
        if (!following(el)) return null;
        const rect = el.getBoundingClientRect();
        return nearestDelta({ start: rect.left, end: rect.right }, viewOf(row, 'x'));
      },
      instant,
    );
  }
  return true;
}

export function focusElement(el: HTMLElement, direction?: Direction): void {
  // Visible, as from a key press: after a mouse click Chromium hides the ring on focus moved by script, and a
  // pad's or the phone remote's keys are synthetic, so moving with them showed nowhere (components' own rings
  // outrank styles.css's [data-input='keys'] fallback).
  el.focus({ preventScroll: true, focusVisible: true });
  if (direction && glideTo(el, direction, reducedMotion())) return;
  el.scrollIntoView({
    behavior: reducedMotion() ? 'auto' : 'smooth',
    block: direction === 'up' || direction === 'down' ? 'center' : 'nearest',
    inline: 'nearest',
  });
}

/**
 * Whether a key press may move focus now. The first press always does; while a key is held, its repeats
 * move it at most once every `interval` ms, so holding a key steps along at a pace the eye can follow.
 * Timed by the events' own time stamps, so repeats that queued up behind a busy frame are dropped rather
 * than all played at once.
 */
export function repeatAllowed(repeat: boolean, timeStamp: number, lastMove: number, interval: number): boolean {
  return !repeat || timeStamp - lastMove >= interval;
}

/** Where focus last was, to pick up there if what had it is taken away (a row redrawn under it). */
let last: { el: HTMLElement; x: number; y: number } | null = null;

/**
 * For a layer that closes with nothing to hand focus back to (first-run setup, opened before anything had
 * focus): the next arrow press starts on the page as at launch, not beside where the layer's last button was.
 */
export function forgetFocus(): void {
  last = null;
}

export function installSpatialNav(): void {
  // A held Enter (a remote's OK held down) repeats. Once the press had opened something (a title page from its
  // card), the repeats went to what took focus there and pressed it too (its Play started the film). A repeat
  // acts only on what the press began on; anywhere else it does nothing, as a fresh press is what's meant.
  let pressedOn: Element | null = null;
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter') return;
      if (!event.repeat) pressedOn = document.activeElement;
      else if (document.activeElement !== pressedOn) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
  document.addEventListener('focusin', (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const rect = event.target.getBoundingClientRect();
    last = { el: event.target, x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
  let lastMove = 0;
  document.addEventListener('keydown', (event) => {
    const direction = DIRECTIONS[event.key];
    if (!direction || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    // `data-nav-arrows` marks a field with no use for arrow keys (the PIN dots), which would otherwise trap them.
    if (active && isEditing(active) && !active.hasAttribute('data-nav-arrows')) return;

    event.preventDefault();
    const interval = direction === 'left' || direction === 'right' ? REPEAT_INTERVAL.horizontal : REPEAT_INTERVAL.vertical;
    if (!repeatAllowed(event.repeat, event.timeStamp, lastMove, interval)) return;
    lastMove = event.timeStamp;

    if (active) {
      const target = nearest(active, direction);
      // A held key stops at the top of the page: Up held through Home ends on the banner, and a fresh press goes on to the menu.
      if (target && event.repeat && inTitlebar(target) && !inTitlebar(active)) return;
      if (target) focusElement(target, direction);
      return;
    }
    // Focus was taken away (what had it was redrawn or removed): the press picks up on what's now nearest
    // where it was, rather than jumping back to the top of the page.
    const lost = last && (!last.el.isConnected || !shows(last.el, false)) ? closestOnScreen(document.body, last) : null;
    const target = lost ?? entryPoint();
    if (target) focusElement(target, lost ? undefined : direction);
  });
}
