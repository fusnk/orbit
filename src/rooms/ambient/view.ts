/**
 * Ambient mode's screen: a slow slideshow of backdrops drifting under a
 * quiet caption, a clock, and the Orbit ring filling toward the next slide.
 *
 * Pacing (after Apple TV's aerials and Plex/Kodi fanart screensavers): long
 * slides with long crossfades, the caption arriving a beat after its picture
 * and leaving before it, so the picture is always what changes first. Only
 * the current and next pictures are held; the next is decoded before it
 * fades in, so nothing ever paints half-loaded. Everything animated is
 * opacity or transform (GPU-composited), and all of it holds still while
 * the window is hidden.
 *
 * Each slide carries its own scrim between the picture and the caption, so the
 * shade sits under the type, never over it, and fades with its picture.
 */
import { locale, t } from '../../i18n';
import { clockFormat, formatClock } from '../../lib/clock';
import { h } from '../../lib/dom';
import { appearance } from '../../theme/appearance';
import { slideMeta, type Slide } from './slides';

/** How long each picture is the main one. */
const SLIDE_MS = 14_000;
const FADE_MS = 2_400;
/** Plain crossfades with reduced motion: no drift, a shorter fade. */
const STILL_FADE_MS = 1_000;
/** A picture that takes longer than this to arrive is skipped. */
const LOAD_TIMEOUT_MS = 20_000;
/** Ken Burns paths in ambient.css; each slide takes the next. */
const DRIFTS = 4;
/**
 * How often a second the drift moves. Each move redraws the whole window, so at
 * a high refresh rate display's every frame it's most of a core, for a motion of
 * a fraction of a pixel per frame; 30 looks just as smooth at this speed.
 */
const DRIFT_STEPS_PER_S = 30;
/** How often the Orbit ring is redrawn over a slide (about 14 times a second). */
const RING_STEPS = 200;

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface AmbientViewOptions {
  clock: boolean;
  /** Whether Enter opens the title (not over the player): shows the hint. */
  details: boolean;
  still: boolean;
}

interface Prepared {
  slide: Slide;
  index: number;
  element: HTMLElement;
}

/** Resolves once `img` is decoded and ready to paint; rejects if it can't be. */
function decoded(img: HTMLImageElement): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('image timed out')), LOAD_TIMEOUT_MS)));
  return Promise.race([img.decode(), timeout]).finally(() => clearTimeout(timer));
}

function image(src: string, className: string): HTMLImageElement {
  const img = h('img', { class: className, alt: '', decoding: 'async', draggable: 'false' });
  img.src = src;
  return img;
}

export function createAmbientView(options: AmbientViewOptions) {
  const fadeMs = options.still ? STILL_FADE_MS : FADE_MS;
  const stage = h('div', { class: 'ambient-stage' });
  const clock = h('div', { class: 'ambient-clock' });
  const hint = h('span', { class: 'ambient-hint' }, t('ambient.hint.details'));
  const ring = orbitRing();
  const corner = h('div', { class: 'ambient-corner', 'aria-hidden': 'true' }, options.details ? hint : '', ring.element);
  const element = h(
    'div',
    { class: 'ambient-mode', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('ambient.label'), tabindex: '-1', 'data-slides': 'none' },
    stage,
    options.clock ? clock : '',
    corner,
  );
  element.classList.toggle('still', options.still);
  // The scrim shades the clock's corner too, only when there's a clock.
  element.classList.toggle('with-clock', options.clock);
  // CSS and timers share one clock.
  element.style.setProperty('--ambient-slide', `${SLIDE_MS}ms`);
  element.style.setProperty('--ambient-fade', `${fadeMs}ms`);
  const drifts = driftStepper();

  let slides: Slide[] = [];
  let current: Prepared | null = null;
  let next: Promise<Prepared | null> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerDue = 0;
  let remaining = 0;
  let clockTimer: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  let closed = false;
  let drift = 0;
  /** Waiting for the next picture to arrive; it arms the timer itself once it has. */
  let advancing = false;

  // ── Clock ──
  const timeFormat = clockFormat();
  const dateFormat = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  function tick(): void {
    const now = new Date();
    // The day period ("PM") smaller beside the digits, where the language uses one.
    const parts = timeFormat.formatToParts(now);
    const time = h('span', { class: 'ambient-time' });
    for (const part of parts) time.append(part.type === 'dayPeriod' ? h('span', { class: 'ambient-period' }, part.value) : part.value);
    clock.replaceChildren(time, h('span', { class: 'ambient-date' }, dateFormat.format(now)));
    clock.setAttribute('aria-label', `${formatClock(now)}, ${dateFormat.format(now)}`);
    // On the minute, not every second: nothing else changes.
    clockTimer = setTimeout(tick, 60_000 - (now.getTime() % 60_000) + 50);
  }

  // ── Slides ──
  function slideElement(slide: Slide, backdrop: HTMLImageElement, logo: HTMLImageElement | null): HTMLElement {
    const eyebrow = slide.note ?? (slide.kind === 'library' ? t('ambient.slide.library') : slide.kind === 'recent' ? t('ambient.slide.recent') : slide.kind === 'trending' ? t('ambient.slide.trending') : '');
    const meta = slideMeta(slide.title);
    // Addon text: set as text nodes by h(), never parsed.
    // Two boxes, so its rise and its fade-out (ambient.css) each animate an element of their own.
    const caption = h(
      'div',
      { class: 'ambient-caption' },
      h(
        'div',
        { class: 'ambient-caption-rise' },
        eyebrow ? h('span', { class: 'ambient-eyebrow' }, eyebrow) : '',
        logo ?? h('span', { class: 'ambient-name' }, slide.title.name),
        meta ? h('span', { class: 'ambient-meta' }, meta) : '',
      ),
    );
    if (logo) logo.alt = slide.title.name;
    const el = h('div', { class: 'ambient-slide', 'data-drift': String(drift++ % DRIFTS) }, h('div', { class: 'ambient-frame' }, backdrop), h('div', { class: 'ambient-scrim', 'aria-hidden': 'true' }), caption);
    return el;
  }

  /** Decodes the first slide from `from` on (wrapping) whose picture loads; null if none does. */
  async function prepare(from: number): Promise<Prepared | null> {
    for (let step = 0; step < slides.length; step++) {
      const index = (from + step) % slides.length;
      const slide = slides[index]!;
      const backdrop = image(slide.title.background!, 'ambient-backdrop');
      const logoSrc = appearance().logos && slide.title.logo?.startsWith('https://') ? slide.title.logo : undefined;
      const logo = logoSrc ? image(logoSrc, 'ambient-logo') : null;
      const [picture, mark] = await Promise.allSettled([decoded(backdrop), logo ? decoded(logo) : Promise.resolve()]);
      if (closed) return null;
      if (picture.status === 'rejected') continue;
      // A logo that won't load gives way to the name.
      return { slide, index, element: slideElement(slide, backdrop, mark.status === 'fulfilled' ? logo : null) };
    }
    return null;
  }

  function present(prepared: Prepared): void {
    const previous = current;
    current = prepared;
    stage.append(prepared.element);
    drifts.add(prepared.element);
    // The old picture stays under the new one until it has faded in, then goes (only two are ever held).
    if (previous) setTimeout(() => previous.element.remove(), fadeMs + 100);
    ring.restart(SLIDE_MS);
    if (held) ring.hold(true);
    element.dataset.slides = slides.length > 1 ? 'many' : 'one';
    if (slides.length > 1) {
      next = prepare(prepared.index + 1);
      arm(SLIDE_MS);
    }
  }

  function arm(ms: number): void {
    // Only ever one timer: a second would advance twice and drop the slide on screen.
    clearTimeout(timer);
    timer = undefined;
    remaining = ms;
    if (held || closed) return;
    timerDue = Date.now() + ms;
    timer = setTimeout(advance, ms);
  }

  async function advance(): Promise<void> {
    timer = undefined;
    advancing = true;
    const prepared = await next;
    advancing = false;
    if (closed) return;
    // Nothing else would load: keep this one and try again later.
    if (!prepared || prepared.index === current?.index) {
      next = prepare((current?.index ?? 0) + 1);
      return arm(SLIDE_MS);
    }
    present(prepared);
  }

  return {
    element,
    /** Starts the slideshow once `list` arrives (the clock shows meanwhile). */
    async start(list: Promise<Slide[]>): Promise<void> {
      if (options.clock) tick();
      slides = await list.catch(() => []);
      if (closed || !slides.length) return;
      const first = await prepare(0);
      if (first && !closed) present(first);
    },
    /** The slide on screen, if any. */
    slide: (): Slide | null => current?.slide ?? null,
    /** Holds everything still (the window is hidden), or lets it run again. */
    hold(on: boolean): void {
      if (on === held || closed) return;
      held = on;
      element.classList.toggle('held', on);
      if (on) {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
          remaining = Math.max(0, timerDue - Date.now());
        }
        clearTimeout(clockTimer);
        ring.hold(true);
        drifts.hold(true);
      } else {
        ring.hold(false);
        drifts.hold(false);
        // Mid-advance (the next picture is still loading), the advance arms the timer once it lands.
        if (current && slides.length > 1 && !advancing) arm(remaining);
        if (options.clock) tick();
      }
    },
    /** Stops every timer; the element is the caller's to fade out and remove. */
    close(): void {
      closed = true;
      clearTimeout(timer);
      clearTimeout(clockTimer);
      ring.hold(true);
      drifts.hold(true);
    },
  };
}

/**
 * Moves the slides' drift (ambient.css) on a timer, DRIFT_STEPS_PER_S times a
 * second, instead of letting it run as an animation. A running animation wakes
 * the compositor on every frame the display shows, even when its value hasn't
 * changed (300 times a second on a 300 Hz screen, a stepped timing function
 * included), so the drift's animations sit paused and only real moves are drawn.
 */
function driftStepper() {
  let moving: Animation[] = [];
  let ticker: ReturnType<typeof setInterval> | undefined;
  let last = 0;
  let held = false;
  const step = () => {
    const now = performance.now();
    const by = now - last;
    last = now;
    moving = moving.filter((animation) => {
      const end = animation.effect?.getComputedTiming().endTime;
      const at = Number(animation.currentTime ?? 0) + by;
      animation.currentTime = typeof end === 'number' ? Math.min(at, end) : at;
      // Done, or its slide has gone: nothing more to move.
      return typeof end === 'number' && at < end && (animation.effect as KeyframeEffect | null)?.target?.isConnected === true;
    });
    if (!moving.length) stop();
  };
  const stop = () => {
    clearInterval(ticker);
    ticker = undefined;
  };
  const run = () => {
    if (ticker !== undefined || held || !moving.length) return;
    last = performance.now();
    ticker = setInterval(step, 1000 / DRIFT_STEPS_PER_S);
  };
  return {
    /** Takes over the drift of a slide just put on screen (none with reduced motion). */
    add(slide: HTMLElement): void {
      const frame = slide.querySelector('.ambient-frame');
      for (const animation of frame?.getAnimations() ?? []) {
        animation.pause();
        moving.push(animation);
      }
      run();
    },
    /** Holds every drift where it is, or lets them move on. */
    hold(on: boolean): void {
      held = on;
      if (on) stop();
      else run();
    },
  };
}

/**
 * The Orbit mark as a progress ring: a faint orbit, an arc that fills toward
 * the next slide, and the accent moon at its centre.
 *
 * The arc is moved by a timer, not a CSS animation: a dash offset can't be
 * animated off the main thread, so as an animation it would restyle and
 * repaint the page every frame the display shows (at 300 Hz, most of a core)
 * to move it a fraction of a pixel.
 */
function orbitRing() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ambient-orbit');
  svg.setAttribute('viewBox', '0 0 48 48');
  const circle = (className: string, r: number) => {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('class', className);
    c.setAttribute('cx', '24');
    c.setAttribute('cy', '24');
    c.setAttribute('r', String(r));
    return c;
  };
  const track = circle('ambient-orbit-track', 21);
  const arc = circle('ambient-orbit-arc', 21);
  // A path length of 100 lets the dash offset run from 100 (empty) to 0 (full).
  arc.setAttribute('pathLength', '100');
  svg.append(track, arc, circle('ambient-orbit-moon', 4));

  let duration = 1;
  /** Time run before the last hold; the current run started at `since`. */
  let ran = 0;
  let since = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;
  const draw = () => {
    const done = Math.min(1, (ran + (ticker === undefined ? 0 : Date.now() - since)) / duration);
    arc.style.strokeDashoffset = String(100 - done * 100);
  };
  const pause = () => {
    if (ticker === undefined) return;
    ran += Date.now() - since;
    clearInterval(ticker);
    ticker = undefined;
  };
  const run = () => {
    if (ticker !== undefined || ran >= duration) return;
    since = Date.now();
    ticker = setInterval(() => {
      draw();
      if (ran + Date.now() - since >= duration) pause();
    }, duration / RING_STEPS);
  };
  return {
    element: svg,
    /** Empties the arc and fills it over `ms`. */
    restart(ms: number): void {
      pause();
      duration = ms;
      ran = 0;
      draw();
      run();
    },
    /** Holds it where it is, or lets it run on. */
    hold(on: boolean): void {
      if (on) pause();
      else run();
    },
  };
}
