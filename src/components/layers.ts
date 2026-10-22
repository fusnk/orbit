/**
 * Modal layers over the app: menus, drawers, the profile switcher. They can
 * stack (a ⋯ menu inside a drawer), and only the topmost is interactive: the
 * app and every layer beneath it are `inert`, so focus, Tab and spatial
 * navigation can't escape into them. The app becomes interactive again only
 * when the last layer closes.
 */

interface Inertable {
  inert: boolean;
}

interface Layer {
  element: Inertable;
  close: (() => void) | null;
}

export function createLayers(app: () => Inertable | null) {
  const stack: Layer[] = [];

  function sync(): void {
    const shell = app();
    if (shell) shell.inert = stack.length > 0;
    stack.forEach((layer, i) => (layer.element.inert = i < stack.length - 1));
  }

  /**
   * Adds `element` on top; `close` dismisses it (see `closeAll`), or null for a layer only its own
   * controls end (first-run setup: whatever was typed in it must survive the page changing behind it).
   * Returns the removal, for when it closes.
   */
  function push(element: Inertable, close: (() => void) | null): () => void {
    const layer = { element, close };
    stack.push(layer);
    sync();
    return () => {
      const index = stack.indexOf(layer);
      if (index < 0) return;
      stack.splice(index, 1);
      element.inert = false;
      sync();
    };
  }

  /** Closes every layer that can be dismissed, topmost first (e.g. when the page changes under them). */
  function closeAll(): void {
    for (const layer of [...stack].reverse()) layer.close?.();
  }

  /** The topmost layer, the only one that's interactive. */
  const top = (): Inertable | undefined => stack.at(-1)?.element;

  return { push, closeAll, top };
}

const layers = createLayers(() => document.getElementById('app'));

let tabListening = false;
/** `createLayers().push` for the app's own layers, each of which keeps Tab inside it (`wrapTab`). */
export function pushLayer(element: HTMLElement, close: (() => void) | null): () => void {
  if (!tabListening) {
    tabListening = true;
    // One listener for every layer, so a new menu or drawer can't forget it. On the document, after
    // the layer's own handlers: one that uses Tab itself (the palette's groups) has already taken it.
    document.addEventListener('keydown', (event) => {
      const top = layers.top();
      if (top && !event.defaultPrevented) wrapTab(top as HTMLElement, event);
    });
  }
  return layers.push(element, close);
}
export const closeLayers = layers.closeAll;

/**
 * Keeps Tab inside an open layer. The app behind is inert, so Tab past either end
 * would leave for the page itself (focus on <body>, outside the layer): it wraps around instead.
 */
export function wrapTab(layer: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
  const controls = [...layer.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  const edge = event.shiftKey ? first : last;
  const active = document.activeElement;
  // Also when focus is on the layer itself, or already left it (the page, <body>).
  if (active !== edge && active !== layer && layer.contains(active)) return;
  event.preventDefault();
  // Scrolled into view: the layer may scroll on a short window, and the other end is out of sight.
  (event.shiftKey ? last : first).focus();
}
