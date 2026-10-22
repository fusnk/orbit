/**
 * "Back" as a single action for Escape, Backspace (outside text editing), a
 * remote's Back button and the mouse's back button. Overlays register a
 * handler while open; otherwise the fallback (router history) runs.
 */
import { isEditing } from './spatial';

const handlers: (() => void)[] = [];

/**
 * The keys that mean Back: Escape (also a controller's B), a remote's Back
 * button (BrowserBack), and Backspace outside a field being typed in. Steps
 * that go back within an overlay check this, so every way of going back acts alike.
 * Never while an input method (Chinese, Japanese, Korean) is composing: Escape
 * then cancels its candidates, and text-field.ts and the palette leave it to it.
 */
export const isBackKey = (event: Pick<KeyboardEvent, 'key' | 'target'> & { isComposing?: boolean }): boolean =>
  !event.isComposing && (event.key === 'Escape' || event.key === 'BrowserBack' || (event.key === 'Backspace' && !isEditing(event.target)));

/** Registers a back handler; returns a function that unregisters it. */
export function onBack(handler: () => void): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

/** Whether the last Back reached the fallback and it had nowhere to go (see `androidBack`). */
let wentNowhere = false;

/** `fallback` goes back a page; it returns false when there's none to go back to. */
export function installBackHandling(fallback: () => boolean): void {
  const goBack = () => {
    const handler = handlers.at(-1);
    if (handler) handler();
    else wentNowhere = !fallback();
  };

  document.addEventListener('keydown', (event) => {
    // Fields that are being edited use Escape themselves (and preventDefault it).
    if (event.defaultPrevented || event.repeat) return;
    // BrowserBack is a remote's (or a media keyboard's) Back button.
    if (isBackKey(event)) {
      event.preventDefault();
      goBack();
    }
  });

  // Mouse "back" thumb button.
  window.addEventListener('mouseup', (event) => {
    if (event.button === 3) {
      event.preventDefault();
      goBack();
    }
  });
}

/**
 * Android's Back button (gen/android MainActivity): the same Back as Esc, sent
 * to whatever has focus so an overlay, a panel or the player takes it first.
 * Returns false when Orbit had nowhere to go back to, so Android leaves the app.
 */
export function androidBack(): boolean {
  wentNowhere = false;
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: 'BrowserBack', bubbles: true, cancelable: true, composed: true }));
  return !wentNowhere;
}
