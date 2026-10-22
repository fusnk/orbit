import { onBack } from '../app/back';
import { t } from '../i18n';
import { h } from '../lib/dom';
import { icon } from './icons';
import { pushLayer } from './layers';
import './image-viewer.css';

/**
 * A full-size image over the app, like the drawer a modal layer: the rest of
 * the app is `inert` while it's open. Left and right (or the buttons) step
 * through `images`; Back (Escape / mouse back), the close button or a click
 * beside the image closes it, and focus returns to where it was.
 */
export function openImageViewer(images: readonly string[], start: number, label: string): void {
  if (!images.length) return;
  const returnFocus = document.activeElement;
  let index = Math.min(Math.max(start, 0), images.length - 1);

  const picture = h('img', { class: 'image-viewer-img', alt: '', decoding: 'async' });
  const counter = h('span', { class: 'image-viewer-count', 'aria-live': 'polite' });
  const button = (name: 'chevronLeft' | 'chevronRight' | 'close', title: string, action: () => void) => {
    const b = h('button', { class: 'image-viewer-button', title, 'aria-label': title }, icon(name));
    b.addEventListener('click', (event) => {
      event.stopPropagation();
      action();
    });
    return b;
  };
  const step = (by: 1 | -1) => show((index + by + images.length) % images.length);
  const prev = button('chevronLeft', t('titles.detail.media-previous'), () => step(-1));
  const next = button('chevronRight', t('titles.detail.media-next'), () => step(1));
  const closeButton = button('close', t('titles.streams.close-esc'), () => close());
  prev.classList.add('step');
  next.classList.add('step');
  const several = images.length > 1;
  const overlay = h(
    'div',
    { class: 'image-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': label },
    picture,
    h('div', { class: 'image-viewer-bar' }, several ? prev : '', several ? counter : '', several ? next : '', closeButton),
  );

  function show(i: number): void {
    index = i;
    picture.classList.remove('loaded');
    picture.src = images[i]!;
    counter.textContent = t('titles.detail.media-position', { number: i + 1, count: images.length });
  }
  picture.addEventListener('load', () => picture.classList.add('loaded'));

  // Left and right step through the images (in reading order), before spatial navigation sees them.
  overlay.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const forward = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = forward === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    if (event.key !== forward && event.key !== back) return;
    event.preventDefault();
    if (several) step(event.key === forward ? 1 : -1);
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    removeBack();
    removeLayer();
    overlay.remove();
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  }
  const removeBack = onBack(close);
  show(index);
  document.body.append(overlay);
  const removeLayer = pushLayer(overlay, close);
  closeButton.focus({ preventScroll: true });
}
