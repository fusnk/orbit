/**
 * Ambient mode: after a while with no input, Orbit fades into a slideshow of
 * artwork (Settings → Appearance → Ambient mode).
 *
 * It's a modal layer (components/layers.ts), so the app under it is inert
 * and a page change closes it like any overlay. Input is caught on `window`
 * in the capture phase, before anything else sees it: the first key, click
 * or touch only wakes Orbit and is swallowed, so it never acts on the page
 * (or the player) underneath; the rest of that press (key-up, mouse-up,
 * click) is swallowed too. The one exception is Enter (or a controller's A)
 * on a slide, which opens that title, except over the player, where opening
 * a page would end playback. Focus goes back exactly where it was.
 *
 * Over the player it's only an overlay: it never touches mpv.
 */
import { BLOCKED_CHECK_MS, createIdleTimer, type IdleConditions } from '../../app/idle';
import { isEditing } from '../../app/spatial';
import { setPageCovered } from '../../app/window-activity';
import { allowedTitles } from '../../catalog/parental';
import { loadCatalog, usableAddons } from '../../catalog/service';
import { browsableCatalogs, type Title } from '../../catalog/titles';
import { pushLayer } from '../../components/layers';
import { libraryEntries } from '../../library/library';
import { continueWatching, recentlyWatched } from '../../library/watch';
import { reducedMotion } from '../../theme/appearance';
import { ambientPrefs, loadAmbientPrefs, onAmbientPrefsChange, type AmbientPrefs } from './settings';
import { allowedSlides, pickSlides, type AmbientSource, type Slide } from './slides';
import { createAmbientView } from './view';
import './ambient.css';

/** Input right after it appears (the rest of the click on Preview, a held key) doesn't wake it. */
const GRACE_MS = 600;
/** After waking, the rest of the press that woke it is swallowed for this long. */
const TAIL_MS = 700;
const LEAVE_MS = 750;
/** Trending waits this long for the catalog before showing what it has. */
const TRENDING_TIMEOUT_MS = 8_000;
/** Pointer movement smaller than this (px) is jitter, or the browser re-sending the position. */
const MOVE_THRESHOLD = 3;

type Origin = 'idle' | 'paused' | 'preview';

export interface AmbientDeps {
  /** The player: not open, playing, or paused (as mpv last reported it). */
  player(): IdleConditions['player'];
  /** Opens a title's page. */
  openTitle(title: Title): void;
}

let showAmbient: ((origin: Origin) => void) | null = null;

/** Starts ambient mode now (Settings → Preview). */
export function previewAmbient(): void {
  showAmbient?.('preview');
}

/** Something else playing with sound (a page's video) counts as playing. */
const audibleVideo = () => [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended && !v.muted);

export function installAmbient(deps: AmbientDeps): void {
  const conditions = (): IdleConditions => {
    const player = deps.player();
    return {
      player: player === 'none' && audibleVideo() ? 'playing' : player,
      editing: isEditing(document.activeElement),
      hidden: document.visibilityState === 'hidden',
    };
  };
  const idle = createIdleTimer({ conditions, onIdle: () => show(deps.player() === 'paused' ? 'paused' : 'idle') });
  const configure = (prefs: AmbientPrefs) => idle.configure({ afterMs: prefs.afterMinutes * 60_000, whenPaused: prefs.paused });
  configure(ambientPrefs());
  void loadAmbientPrefs().then(configure);
  onAmbientPrefsChange(configure);

  let open: {
    view: ReturnType<typeof createAmbientView>;
    origin: Origin;
    shownAt: number;
    returnFocus: Element | null;
    removeLayer(): void;
    watch: ReturnType<typeof setInterval>;
  } | null = null;
  let tailUntil = 0;

  function show(origin: Origin): void {
    if (open) return;
    const prefs = ambientPrefs();
    const view = createAmbientView({ clock: prefs.clock, details: origin !== 'paused', still: reducedMotion() });
    const returnFocus = document.activeElement;
    document.body.append(view.element);
    const removeLayer = pushLayer(view.element, () => wake());
    view.element.focus({ preventScroll: true });
    // Never over playback: if something starts playing underneath (not by a key, which wakes it first), step aside.
    const watch = setInterval(() => {
      if (conditions().player === 'playing') wake();
    }, BLOCKED_CHECK_MS);
    open = { view, origin, shownAt: performance.now(), returnFocus, removeLayer, watch };
    // What's under it holds still meanwhile (the banner's drift and rotation).
    setPageCovered(true);
    if (document.visibilityState === 'hidden') view.hold(true);
    void view.start(loadSlides(prefs.source));
  }

  /** Fades out and gives the page back; `then` runs once focus is back (e.g. to open a title). */
  function wake(then?: () => void): void {
    if (!open) return;
    const { view, removeLayer, returnFocus, watch } = open;
    open = null;
    clearInterval(watch);
    setPageCovered(false);
    view.close();
    removeLayer();
    // Still on screen while it fades, so the rest of the click lands on it, not the page.
    view.element.classList.add('leaving');
    setTimeout(() => view.element.remove(), LEAVE_MS);
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    tailUntil = performance.now() + TAIL_MS;
    idle.activity();
    then?.();
  }

  /** Enter or A: open the slide's title where that's allowed, otherwise just wake. */
  function choose(): void {
    const title = open && open.origin !== 'paused' ? open.view.slide()?.title : undefined;
    wake(title ? () => deps.openTitle(title) : undefined);
  }

  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const settled = () => open !== null && performance.now() - open.shownAt >= GRACE_MS;
  const inTail = () => performance.now() < tailUntil;

  window.addEventListener(
    'keydown',
    (event) => {
      if (!open) {
        if (inTail() && event.repeat) return swallow(event);
        // A fresh press is deliberate: it, and what follows it, go to the page.
        tailUntil = 0;
        return idle.activity();
      }
      swallow(event);
      if (event.repeat || !settled()) return;
      if (event.key === 'Enter') choose();
      else wake();
    },
    { capture: true },
  );
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (!open) {
        tailUntil = 0;
        return idle.activity();
      }
      swallow(event);
      if (settled()) wake();
    },
    { capture: true },
  );
  // The rest of a press that woke it, so it doesn't act on what's underneath.
  for (const type of ['keyup', 'pointerup', 'mouseup', 'click', 'auxclick', 'contextmenu', 'dblclick'] as const) {
    window.addEventListener(
      type,
      (event) => {
        if (open || inTail()) swallow(event);
      },
      { capture: true },
    );
  }
  window.addEventListener(
    'pointermove',
    (event) => {
      if (!open) return idle.activity();
      if (Math.abs(event.movementX) + Math.abs(event.movementY) > MOVE_THRESHOLD && settled()) wake();
    },
    { capture: true, passive: true },
  );
  // Nothing under it scrolls (it covers the window and isn't scrollable), so this can stay passive.
  window.addEventListener(
    'wheel',
    () => {
      if (!open) return idle.activity();
      if (settled()) wake();
    },
    { capture: true, passive: true },
  );

  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState === 'hidden';
    idle.visibility(hidden);
    open?.view.hold(hidden);
  });

  // Controllers reach it as keys (app/gamepad.ts): A is Enter, everything else wakes it.

  showAmbient = show;
}

async function loadSlides(source: AmbientSource): Promise<Slide[]> {
  const trending = source === 'for-you' ? [] : await withTimeout(loadTrending(), TRENDING_TIMEOUT_MS).catch(() => []);
  const slides = pickSlides(source, {
    continueWatching: continueWatching(),
    library: libraryEntries().map((entry) => entry.title),
    recent: recentlyWatched(),
    trending,
  });
  return allowedSlides(slides, allowedTitles);
}

/** What's popular: the catalog Home leads with (its first movie catalog, e.g. Cinemeta's Popular). */
async function loadTrending(): Promise<Title[]> {
  const refs = browsableCatalogs(await usableAddons()).filter((ref) => ref.catalog.type === 'movie' || ref.catalog.type === 'series');
  const top = refs.find((ref) => ref.catalog.type === 'movie') ?? refs[0];
  return top ? loadCatalog(top) : [];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timed out')), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
