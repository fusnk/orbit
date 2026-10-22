/**
 * TV mode's one owner of the scrolling that follows focus. The browser's own
 * smooth scroll restarts from a standstill every time it's asked again, so a
 * remote's key repeat (a new target every 80–110 ms) made the page lurch and
 * stall, and two requests in flight fought over the same scroller. Here each
 * scroller has at most one glide: a critically damped spring that a new target
 * re-aims without losing its speed, as Compose for TV's bring-into-view does
 * (its `BringIntoViewSpec` is asked for the distance again on every frame, and
 * the scroll animation is a spring) and as Leanback's grid keeps one smooth
 * scroller and adds pending moves to it rather than starting another.
 *
 * The glide asks where it should be (`aim`) on every frame, from the focused
 * element's live position, so a row drawn or loaded above it mid-glide doesn't
 * leave focus off its line. A wheel, touch or click stops it: the person took
 * the page.
 */

export type Axis = 'x' | 'y';

/** How stiff the spring is (radians a second): Compose's default spring (stiffness 400, no bounce), about 0.25 s to settle. */
const OMEGA = 20;
/** A frame the main thread held up longer than this (rows being drawn) moves the page no further than this would, so it doesn't leap. */
const MAX_FRAME = 0.048;
/** A glide gives up after this long: something keeps moving its target (pictures loading in a loop). */
const MAX_GLIDE_MS = 1500;
/** Moves shorter than this are skipped: a scroller already in place stays still. */
const STILL = 4;

/** Where a glide is and how fast it's moving (pixels, pixels a second). */
export interface Motion {
  pos: number;
  velocity: number;
}

/**
 * One step of a critically damped spring toward `target`, solved exactly for `dt` seconds, so a long frame
 * neither overshoots nor blows up. A new target keeps the velocity, so key repeat reads as one steady motion.
 */
export function springStep(motion: Motion, target: number, dt: number, omega = OMEGA): Motion {
  const x = motion.pos - target;
  const decay = Math.exp(-omega * dt);
  const k = motion.velocity + omega * x;
  return { pos: target + (x + k * dt) * decay, velocity: (motion.velocity - omega * k * dt) * decay };
}

/** Whether a glide is close enough to rest at its target. */
export function settled(motion: Motion, target: number): boolean {
  return Math.abs(motion.pos - target) < 0.5 && Math.abs(motion.velocity) < 20;
}

/** The range a scroller's position can take along `axis`: right-to-left rows count down from 0. */
export function scrollRange(size: { scroll: number; client: number }, rtl: boolean): [number, number] {
  const extent = Math.max(0, size.scroll - size.client);
  return rtl ? [-extent, 0] : [0, extent];
}

export function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

interface Glide {
  el: HTMLElement;
  axis: Axis;
  /** How far the scroller should still move, measured now; null stops the glide. */
  aim: () => number | null;
  motion: Motion;
  /** What the glide last set, to notice when something else moved the scroller. */
  written: number;
  started: number;
}

const glides: Glide[] = [];
let frame = 0;
let lastTime = 0;

const read = (g: Pick<Glide, 'el' | 'axis'>) => (g.axis === 'y' ? g.el.scrollTop : g.el.scrollLeft);
function write(g: Glide, value: number): void {
  if (g.axis === 'y') g.el.scrollTop = value;
  else g.el.scrollLeft = value;
  g.written = read(g);
}
function range(g: Pick<Glide, 'el' | 'axis'>): [number, number] {
  return g.axis === 'y'
    ? scrollRange({ scroll: g.el.scrollHeight, client: g.el.clientHeight }, false)
    : scrollRange({ scroll: g.el.scrollWidth, client: g.el.clientWidth }, getComputedStyle(g.el).direction === 'rtl');
}

function tick(now: number): void {
  frame = 0;
  const dt = Math.min(MAX_FRAME, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  for (const g of [...glides]) {
    const actual = read(g);
    // Something else moved it (the browser keeping content steady as a row above was drawn): go on from there.
    if (Math.abs(actual - g.written) > 1.5) g.motion.pos += actual - g.written;
    const delta = g.el.isConnected && now - g.started < MAX_GLIDE_MS ? g.aim() : null;
    if (delta === null || !Number.isFinite(delta)) {
      stop(g);
      continue;
    }
    const target = clamp(actual + delta, range(g));
    g.motion = springStep(g.motion, target, dt);
    if (settled(g.motion, target)) {
      write(g, target);
      stop(g);
    } else write(g, g.motion.pos);
  }
  if (glides.length) frame = requestAnimationFrame(tick);
}

function stop(g: Glide): void {
  const i = glides.indexOf(g);
  if (i >= 0) glides.splice(i, 1);
}

/** Stops every glide (the person scrolled or clicked: the page is theirs). */
export function stopGlides(): void {
  glides.length = 0;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

let watching = false;

/**
 * Moves `el` along `axis` by what `aim` says (measured from where it is now, asked again each frame),
 * re-aiming a glide already running there. `instant` (reduced motion) jumps there at once.
 */
export function glide(el: HTMLElement, axis: Axis, aim: () => number | null, instant: boolean): void {
  if (!watching) {
    watching = true;
    for (const type of ['wheel', 'touchstart', 'pointerdown'] as const) document.addEventListener(type, stopGlides, { capture: true, passive: true });
  }
  const running = glides.find((g) => g.el === el && g.axis === axis);
  if (running) {
    if (instant) stop(running);
    else {
      running.aim = aim;
      running.started = performance.now();
      return;
    }
  }
  const delta = aim();
  // A scroller already in place stays still: a move of a few pixels reads as a wobble.
  if (delta === null || (!running && Math.abs(delta) < STILL)) return;
  const pos = read({ el, axis });
  if (instant) {
    const target = clamp(pos + delta, range({ el, axis }));
    if (axis === 'y') el.scrollTop = target;
    else el.scrollLeft = target;
    return;
  }
  glides.push({ el, axis, aim, motion: { pos, velocity: 0 }, written: pos, started: performance.now() });
  if (!frame) {
    lastTime = performance.now();
    frame = requestAnimationFrame(tick);
  }
}
