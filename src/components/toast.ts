import { h } from '../lib/dom';

const makeRegion = () => setUp(document.body.appendChild(h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' })));

/**
 * In the page from the start where there is one, since screen readers only
 * read a live region's changes once it's in the page (the first toast would go
 * unread); made on first use otherwise, so modules that may toast can load
 * without a page (tests).
 */
let region: HTMLElement | undefined = typeof document === 'undefined' || !document.body ? undefined : makeRegion();
let timer: ReturnType<typeof setTimeout> | undefined;
/** What had focus before the toast's button took it, given back after Undo. */
let returnFocus: Element | null = null;

const SHOW_MS = 3800;
/** Long enough to reach the button: by mouse, or with Tab or the arrow keys from the page. */
const SHOW_WITH_ACTION_MS = 7000;

export interface ToastOptions {
  /** A button beside the message, e.g. Undo after removing something. */
  action?: { label: string; run(): void } | undefined;
}

function hide(): void {
  if (!region) return;
  // Not while its button has focus: it goes a moment after focus leaves (`setUp`).
  if (region.contains(document.activeElement)) return;
  region.classList.remove('show');
  // A hidden toast's button can't be reached by mistake (Tab, the arrow keys).
  region.querySelector('.toast-action')?.remove();
}

function schedule(ms: number): void {
  clearTimeout(timer);
  timer = setTimeout(hide, ms);
}

function setUp(el: HTMLElement): HTMLElement {
  // While the button has focus the toast stays; it goes a moment after focus leaves.
  el.addEventListener('focusin', (event) => {
    clearTimeout(timer);
    if (!el.contains(event.relatedTarget as Node | null)) returnFocus = event.relatedTarget as Element | null;
  });
  el.addEventListener('focusout', (event) => {
    if (!el.contains(event.relatedTarget as Node | null)) schedule(SHOW_MS);
  });
  return el;
}

/** Shows a short, non-blocking message, with an optional action button. */
export function toast(message: string, options: ToastOptions = {}): void {
  region ??= makeRegion();
  if (!region.isConnected) document.body.append(region);
  const { action } = options;
  // A new message in place of one whose button had focus: focus goes back where it came from, not nowhere.
  const hadFocus = region.contains(document.activeElement);
  if (action) {
    const button = h('button', { class: 'toast-action' }, action.label);
    button.addEventListener('click', () => {
      const back = returnFocus;
      returnFocus = null;
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
      else button.blur();
      region?.classList.remove('show');
      button.remove();
      action.run();
    });
    region.replaceChildren(h('span', { class: 'toast-text' }, message), button);
  } else region.textContent = message;
  if (hadFocus && returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  region.classList.toggle('has-action', !!action);
  region.classList.add('show');
  schedule(action ? SHOW_WITH_ACTION_MS : SHOW_MS);
}
