import type { ActionId } from '../lib/keymap';
import { closeLayers } from '../components/layers';
import { reducedMotion } from '../theme/appearance';
import { pageError, reportError } from './errors';
import { SHOWN_VIEW } from '../lib/shown';
import { closestOnScreen, onScreen } from './spatial';

export interface RoomContext {
  /** Pushes a view (e.g. a title's detail page) on top of the current page. */
  open(view: HTMLElement): void;
  /** Returns to where the user came from, if anywhere. */
  back(): void;
  /**
   * Shows another top-level page, e.g. from a call to action. `root`: its main
   * view, not a title page left open on it (e.g. "See all" opening a catalog there).
   */
  go(id: string, options?: { root?: boolean }): void;
}

export interface Room {
  id: string;
  label: string;
  /** Shortcut shown in the nav tooltip, e.g. "Ctrl+K". */
  /** The keyboard shortcut that opens it, named in its tooltip. */
  shortcut?: ActionId;
  render(ctx: RoomContext): HTMLElement;
  /** Called each time the room is chosen (nav, shortcut, link), not when Back returns to it. */
  onShow?(): void;
  /**
   * Its main view stays in the page, hidden, while another view shows, instead of being taken
   * out. Put back into the page, a view is styled and laid out from scratch: on Home or a long
   * grid that was most of the time Back or the nav took to return to it (~150 ms for 600 cards).
   * Hidden in place it keeps its layout, so returning only draws it. Its code must then tell
   * "in the page" from "shown" with `isShown` (lib/shown.ts), not `isConnected`.
   */
  keep?: boolean;
}

interface Entry {
  view: HTMLElement;
  scrollTop: number;
  /**
   * Scrolled areas inside the view (rails, the guide), as [element, left, top].
   * Out of the page an element loses its scroll position, so it's put back on return.
   */
  inner?: [Element, number, number][];
}

interface Location {
  room: string;
  entry: Entry;
  /** What had focus when the user left, restored on Back. */
  focus?: Element | null;
  /** Where it was on screen, when it was in the view: for one beside it on Back, if it's gone by then. */
  at?: { x: number; y: number };
}

export interface RouteState {
  room: string;
  canGoBack: boolean;
  /** The view now shown; it may carry `data-hue` for the ambient glow. */
  view: HTMLElement;
}

/**
 * The control that had focus in `view`, or the one that replaced it when the
 * view redrew meanwhile: found by its `data-focus-id`, first inside the same
 * `data-focus-scope`s it was in (a Home row, a rail), outermost first, so the
 * same title in another row doesn't take its place.
 */
export function findAgain(view: HTMLElement, focus: HTMLElement): HTMLElement | null {
  if (focus.isConnected) return focus;
  const id = focus.dataset.focusId;
  if (!id) return null;
  const scopes: string[] = [];
  for (let at = focus.parentElement?.closest<HTMLElement>('[data-focus-scope]'); at; at = at.parentElement?.closest<HTMLElement>('[data-focus-scope]')) scopes.unshift(at.dataset.focusScope!);
  let within = view;
  for (const scope of scopes) within = within.querySelector<HTMLElement>(`[data-focus-scope="${CSS.escape(scope)}"]`) ?? within;
  const selector = `[data-focus-id="${CSS.escape(id)}"]`;
  return within.querySelector<HTMLElement>(selector) ?? view.querySelector<HTMLElement>(selector);
}

const MAX_HISTORY = 30;
/** Views per page: its own view plus pushed ones (title pages, people, lists). */
const MAX_STACK = 16;

/**
 * Elements scrolled inside each view, noted as they scroll. Leaving a view then
 * reads only these: checking every element's scroll position (thousands on a
 * full grid or Home) took a quarter of a second on each page change.
 */
const scrolledIn = new WeakMap<HTMLElement, Set<Element>>();
function noteScrolling(view: HTMLElement): void {
  if (scrolledIn.has(view)) return;
  const scrolled = new Set<Element>();
  scrolledIn.set(view, scrolled);
  view.addEventListener('scroll', (event) => event.target instanceof Element && scrolled.add(event.target), { capture: true, passive: true });
}

/** Dispatched on the view being left, just before it's taken off the page or hidden (so it can note sizes it will need back). */
export const VIEW_HIDDEN = 'orbit:view-hidden';

/** Dispatched on a view each time the router shows it. */
export const VIEW_SHOWN = 'orbit:view-shown';
/** Dispatched on a pushed view when it's dropped for good (Back past it, or its page reset), so it can let go of subscriptions. */
export const VIEW_DISCARDED = 'orbit:view-discarded';

/**
 * Pages and pushed views with one browser-style history: Back returns to
 * wherever the user came from, across pages. Each page keeps its own stack of
 * pushed views (details → more like this → …); rendered views are kept, so
 * their state and scroll position survive navigation.
 */
export function createRouter(rooms: readonly Room[], outlet: HTMLElement, onChange: (state: RouteState) => void) {
  const stacks = new Map<string, Entry[]>();
  const history: Location[] = [];
  let current: Location | null = null;
  const ctx: RoomContext = { open: (view) => push(view), back: () => void back(), go: (id, options) => go(id, options) };

  const stackOf = (room: string) => stacks.get(room) ?? [];
  /** Home's main view, where Back has nowhere to go (its arrow is hidden there). */
  const atHomeRoot = (location: Location) => location.room === rooms[0]?.id && stackOf(location.room)[0] === location.entry;

  function show(location: Location, focus?: 'autofocus'): void {
    if (current) {
      current.entry.view.dispatchEvent(new CustomEvent(VIEW_HIDDEN));
      current.entry.scrollTop = outlet.scrollTop;
      const scrolled = [...(scrolledIn.get(current.entry.view) ?? [])].filter((el) => el.isConnected && current!.entry.view.contains(el) && (el.scrollLeft || el.scrollTop));
      current.entry.inner = scrolled.map((el) => [el, el.scrollLeft, el.scrollTop]);
    }
    current = location;
    const view = location.entry.view;
    noteScrolling(view);
    // `keep` pages' main views stay, hidden; anything else leaves the page (as the browser
    // pauses its media and forgets its layout then, it's drawn afresh if it comes back).
    const kept = new Set(rooms.filter((room) => room.keep).map((room) => stackOf(room.id)[0]?.view));
    for (const child of [...outlet.children]) {
      if (child === view) continue;
      if (!kept.has(child as HTMLElement)) child.remove();
      else if (child.classList.contains(SHOWN_VIEW)) {
        // Hidden (styles.css), and out of reach of focus, clicks, arrows (spatial.ts skips `[inert]`) and screen readers.
        child.classList.remove(SHOWN_VIEW);
        (child as HTMLElement).inert = true;
      }
    }
    // Focus left in a view just hidden stays there until the browser's next frame moves it to the body.
    // Until then the page shown would take it for focus the person put somewhere (a show's page, whose
    // Play takes focus once its episodes are in unless focus has moved on, kept none when they came at once).
    const left = document.activeElement;
    if (left instanceof HTMLElement && outlet.contains(left) && !view.contains(left)) left.blur();
    view.classList.add(SHOWN_VIEW);
    view.inert = false;
    if (view.parentElement !== outlet) outlet.append(view);
    outlet.scrollTop = location.entry.scrollTop;
    for (const [el, left, top] of location.entry.inner ?? []) el.scrollTo({ left, top, behavior: 'instant' });
    if (focus) location.entry.view.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    onChange({ room: location.room, canGoBack: history.length > 0 && !atHomeRoot(location), view: location.entry.view });
    // Lets a kept view refresh what changed while it was away (e.g. watch progress).
    // After onChange, so whatever was just left (like the player) has saved its state.
    location.entry.view.dispatchEvent(new CustomEvent(VIEW_SHOWN));
  }

  function remember(): void {
    if (!current) return;
    const focus = document.activeElement;
    const box = focus instanceof HTMLElement && current.entry.view.contains(focus) ? focus.getBoundingClientRect() : null;
    history.push({ ...current, focus, ...(box ? { at: { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 } } : {}) });
    if (history.length > MAX_HISTORY) history.shift();
  }

  function go(id: string, options: { root?: boolean } = {}): void {
    const room = rooms.find((r) => r.id === id);
    if (!room) return;
    // Menus and drawers belong to the page they opened on, so they close when it
    // changes (e.g. Ctrl+K from inside one). First, so focus is back on their
    // opener before it's remembered for Back.
    closeLayers();
    let stack = stacks.get(id);
    if (!stack) {
      stack = [{ view: renderRoom(room), scrollTop: 0 }];
      stacks.set(id, stack);
    }
    if (current?.room === id) {
      // Choosing the current page from the nav returns to its root view, and at
      // its root view to the top (a long grid or Home, scrolled with a controller).
      if (stack.length === 1) {
        toTop();
        return room.onShow?.();
      }
      truncate(stack, 1);
      prune();
      // Back from the root would only show it again (it was left for a title page now dropped).
      while (history.at(-1)?.entry === stack[0]) history.pop();
    } else {
      remember();
      // Otherwise it opens where it was left, which may be a title page on top of it.
      if (options.root && stack.length > 1) {
        truncate(stack, 1);
        prune();
      }
    }
    show({ room: id, entry: stack.at(-1)! });
    room.onShow?.();
  }

  /**
   * A page's view, or (if drawing it throws) a message with "Try again" in its
   * place, so one broken page doesn't stop the others from opening.
   */
  function renderRoom(room: Room): HTMLElement {
    try {
      return room.render(ctx);
    } catch (err) {
      reportError(`The ${room.id} page could not draw`, err);
      const fallback = pageError(() => {
        const entry = stacks.get(room.id)?.[0];
        if (entry?.view !== fallback) return;
        entry.view = renderRoom(room);
        if (current?.entry === entry) show(current);
      });
      return fallback;
    }
  }

  function push(view: HTMLElement): void {
    if (!current) return;
    closeLayers();
    const entry = { view, scrollTop: 0 };
    remember();
    const stack = stackOf(current.room);
    stack.push(entry);
    // A long chain (title → More like this → title …) would keep every page and
    // its artwork; the oldest pushed views go once Back could no longer reach them.
    if (stack.length > MAX_STACK) {
      for (const dropped of stack.splice(1, stack.length - MAX_STACK)) dropped.view.dispatchEvent(new CustomEvent(VIEW_DISCARDED));
      prune();
    }
    show({ room: current.room, entry }, 'autofocus');
  }

  /** Cuts `stack` to `length` views, telling each dropped view it's gone. */
  function truncate(stack: Entry[], length: number): void {
    for (const entry of stack.splice(length)) entry.view.dispatchEvent(new CustomEvent(VIEW_DISCARDED));
  }

  /** Drops history entries whose views were discarded from their page's stack. */
  function prune(): void {
    for (let i = history.length - 1; i >= 0; i--) {
      const loc = history[i]!;
      if (!stackOf(loc.room).includes(loc.entry)) history.splice(i, 1);
    }
  }

  /** Returns to the previous location; false when there's nowhere to go. */
  function back(): boolean {
    // Home's main view has no Back (as its hidden arrow says): Esc does nothing there, and Android's Back leaves the app.
    if (!current || !history.length || atHomeRoot(current)) return false;
    closeLayers();
    const previous = history.pop()!;
    // Leaving a pushed view discards it (and anything above it) from its page.
    const stack = stackOf(current.room);
    const index = stack.indexOf(current.entry);
    if (index > 0) {
      truncate(stack, index);
      prune();
    }
    show(previous);
    // The view may have redrawn while away (e.g. a title page after playing): find the
    // same control again by its `data-focus-id`.
    const focus = previous.focus;
    if (focus instanceof HTMLElement) {
      const found = findAgain(previous.entry.view, focus);
      // Gone for good: what's now nearest where it was (a card taken out of My Library: the one that moved into its
      // place; the page's scroll is back where it was), else the view's main control (a title page's Play) rather than nothing.
      const near = !found && previous.at ? closestOnScreen(previous.entry.view, previous.at) : null;
      const target = found ?? near ?? previous.entry.view.querySelector<HTMLElement>('[data-autofocus]');
      // Not if the page was scrolled away from it: the next arrow key would jump back
      // there. Arrows then start from something on screen instead.
      if (target && onScreen(target)) target.focus({ preventScroll: true });
    }
    return true;
  }

  /**
   * Scrolls the page shown back to its top. Focus left down the page would
   * pull it back with the next arrow key, so it moves to the first thing on
   * screen there (only when it was in the page, not on the nav).
   */
  function toTop(): void {
    if (outlet.scrollTop <= 0) return;
    outlet.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    if (!outlet.contains(document.activeElement)) return;
    const view = current?.entry.view;
    const first = view?.querySelector<HTMLElement>('[data-autofocus]') ?? view?.querySelector<HTMLElement>('button:not([disabled]), [href], input, [tabindex="0"]');
    first?.focus({ preventScroll: true });
  }

  /** A page's main view from the top (the Orbit logo), rather than wherever it was left. */
  function goTop(id: string): void {
    const stack = stacks.get(id);
    if (stack?.[0]) stack[0].scrollTop = 0;
    go(id);
    if (current?.room !== id) return;
    // Already there with a view open on top (or scrolled down): back to the start.
    if (stackOf(id).length > 1) go(id);
    outlet.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  // `ctx` lets things outside the pages (ambient mode) open a view the same way pages do.
  return { go, goTop, back, ctx };
}
