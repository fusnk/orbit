import { onBack } from '../app/back';
import { h } from '../lib/dom';
import { pushLayer } from './layers';

/**
 * Opens a modal side drawer. It's a modal layer: the rest of the app is made
 * `inert` while it's open, which removes it from Tab order, clicks, and
 * spatial navigation in one step. Back (Escape / mouse back), the scrim,
 * `close()`, or the page changing dismisses it and focus returns to where it was.
 */
export function openDrawer(content: HTMLElement, label: string, onClose?: () => void): () => void {
  const returnFocus = document.activeElement;
  const scrim = h('div', { class: 'scrim' });
  const panel = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, content);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    removeBack();
    removeLayer();
    // Still on screen while it slides away; nothing in it should take focus or clicks.
    panel.inert = true;
    onClose?.();
    panel.classList.remove('open');
    scrim.classList.remove('open');
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    const remove = () => {
      panel.remove();
      scrim.remove();
    };
    panel.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 500); // in case no transition runs (reduced motion)
  };
  const removeBack = onBack(close);

  scrim.addEventListener('click', close);
  document.body.append(scrim, panel);
  const removeLayer = pushLayer(panel, close);
  requestAnimationFrame(() => {
    panel.classList.add('open');
    scrim.classList.add('open');
  });
  (panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  return close;
}
