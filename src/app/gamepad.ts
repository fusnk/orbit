/**
 * Game controllers. The Gamepad API has no input events, so connected pads are
 * polled once a frame (only while the window shows and a pad is connected;
 * a few times a second while another app has focus),
 * and their presses become the keys the rest of Orbit already understands: the
 * D-pad and left stick are the arrow keys, A is Enter, B is Escape (Back) and
 * Y is the Menu key (the focused item's context menu).
 * Spatial navigation, Back, the player's shortcuts and ambient mode then work
 * the same with a controller as with a keyboard or a remote, through one path.
 */

export type Key = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Enter' | 'Escape' | 'ContextMenu';

/** The "standard" mapping's button indexes (https://w3c.github.io/gamepad/#remapping). */
const BUTTONS: readonly (readonly [number, Key])[] = [
  [0, 'Enter'],
  [1, 'Escape'],
  [3, 'ContextMenu'],
  [12, 'ArrowUp'],
  [13, 'ArrowDown'],
  [14, 'ArrowLeft'],
  [15, 'ArrowRight'],
];
/** A stick pushed less than this is resting drift, not input. */
const STICK = 0.5;
/** A held direction repeats like a held arrow key: after a pause, then steadily. */
export const REPEAT_DELAY_MS = 400;
export const REPEAT_MS = 110;
/** How often pads are read while the window doesn't have focus. */
export const UNFOCUSED_POLL_MS = 250;

const CODES: Record<Key, string> = { ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Enter: 'Enter', Escape: 'Escape', ContextMenu: 'ContextMenu' };

/** The keys a pad is holding down. The stick counts along its stronger axis only, so a diagonal push moves one way. */
export function heldKeys(pad: { buttons: readonly { pressed: boolean }[]; axes: readonly number[] }): Set<Key> {
  const keys = new Set<Key>();
  for (const [index, key] of BUTTONS) if (pad.buttons[index]?.pressed) keys.add(key);
  const [x = 0, y = 0] = pad.axes;
  if (Math.abs(x) >= Math.abs(y) && Math.abs(x) > STICK) keys.add(x < 0 ? 'ArrowLeft' : 'ArrowRight');
  else if (Math.abs(y) > STICK) keys.add(y < 0 ? 'ArrowUp' : 'ArrowDown');
  return keys;
}

export interface PadEvent {
  type: 'keydown' | 'keyup';
  key: Key;
  repeat: boolean;
}

/** Turns what's held now into key events, given what was held before (key → when it went down, when it last fired). */
export function padEvents(before: Map<Key, { since: number; last: number }>, held: ReadonlySet<Key>, now: number): PadEvent[] {
  const events: PadEvent[] = [];
  for (const [key] of before) {
    if (held.has(key)) continue;
    before.delete(key);
    events.push({ type: 'keyup', key, repeat: false });
  }
  for (const key of held) {
    const state = before.get(key);
    if (!state) {
      before.set(key, { since: now, last: now });
      events.push({ type: 'keydown', key, repeat: false });
    } else if (key.startsWith('Arrow') && now - state.since >= REPEAT_DELAY_MS && now - state.last >= REPEAT_MS) {
      state.last = now;
      events.push({ type: 'keydown', key, repeat: true });
    }
  }
  return events;
}

/**
 * The held keys Orbit acts on. The Gamepad API keeps reporting the pad while another app has
 * focus (a game on another monitor, say), so nothing counts then; and a button still held from
 * then is ignored until it's let go, so returning mid-press doesn't land that press here.
 * `ignored` carries those keys from one poll to the next.
 */
export function focusedKeys(held: ReadonlySet<Key>, ignored: Set<Key>, focused: boolean): Set<Key> {
  for (const key of ignored) if (!held.has(key)) ignored.delete(key);
  if (!focused) {
    for (const key of held) ignored.add(key);
    return new Set();
  }
  return new Set([...held].filter((key) => !ignored.has(key)));
}

/** What A clicks: what a real Enter would (a synthetic key event clicks nothing), and checkboxes, which a keyboard toggles with Space. */
const ACTIVATED_BY_A = 'button, a[href], summary, input:is([type="button"], [type="submit"], [type="reset"], [type="checkbox"], [type="radio"])';

/**
 * The browser shows focus (`:focus-visible`) only after a real key press, so focus moved by a pad or the
 * phone remote's synthetic keys was drawn only if the last real input was the keyboard: after a mouse
 * click it moved unseen. This marks the page while those keys drive it; styles.css draws the ring then,
 * and a real click or tap hands control back to the pointer.
 */
function markKeys(): void {
  document.documentElement.dataset.input = 'keys';
}

let watchingPointer = false;
function watchPointer(): void {
  if (watchingPointer) return;
  watchingPointer = true;
  document.addEventListener('pointerdown', (event) => {
    if (event.isTrusted) delete document.documentElement.dataset.input;
  }, { capture: true, passive: true });
}

function send({ type, key, repeat }: PadEvent): void {
  if (type === 'keydown') {
    markKeys();
    watchPointer();
  }
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  const proceed = target.dispatchEvent(new KeyboardEvent(type, { key, code: CODES[key], repeat, bubbles: true, cancelable: true, composed: true }));
  if (proceed && type === 'keydown' && key === 'Enter' && !repeat && target.matches(ACTIVATED_BY_A)) target.click();
}

/** One press and release of `key`, as a pad's button gives (the phone remote's arrow pad uses it too). */
export function pressKey(key: Key): void {
  send({ type: 'keydown', key, repeat: false });
  send({ type: 'keyup', key, repeat: false });
}

export function installGamepad(): void {
  if (!('getGamepads' in navigator)) return;
  const before = new Map<Key, { since: number; last: number }>();
  const ignored = new Set<Key>();
  let frame: number | undefined;
  let slow: number | undefined;
  /** Lets go of everything, so a direction doesn't keep repeating. */
  const release = () => {
    for (const event of padEvents(before, new Set(), performance.now())) send(event);
  };

  const poll = (now: number) => {
    frame = undefined;
    const pads = navigator.getGamepads().filter((pad) => pad !== null);
    const held = new Set<Key>();
    for (const pad of pads) for (const key of heldKeys(pad)) held.add(key);
    const focused = document.hasFocus();
    for (const event of padEvents(before, focusedKeys(held, ignored, focused), now)) send(event);
    // Keeps polling while a pad is connected; requestAnimationFrame itself pauses while the window is hidden.
    if (!pads.length) return;
    if (focused) frame = requestAnimationFrame(poll);
    // Without focus nothing acts on the pad (a game on another monitor, Orbit playing beside it):
    // a few checks a second still note what's held, rather than one every frame for hours.
    else slow = window.setTimeout(() => {
      slow = undefined;
      if (document.visibilityState !== 'hidden') poll(performance.now());
    }, UNFOCUSED_POLL_MS);
  };
  const start = () => {
    if (frame === undefined && slow === undefined) frame = requestAnimationFrame(poll);
  };
  /** Focus is back: every frame again from now. */
  const resume = () => {
    if (slow === undefined) return;
    window.clearTimeout(slow);
    slow = undefined;
    poll(performance.now());
  };

  window.addEventListener('gamepadconnected', start);
  window.addEventListener('focus', resume);
  // Another app took focus mid-press: let go now rather than at the next frame.
  window.addEventListener('blur', release);
  // Hidden mid-press: let go of everything, so a direction doesn't keep repeating on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') release();
    else start();
  });
  if (navigator.getGamepads().some((pad) => pad !== null)) start();
}
