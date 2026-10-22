/**
 * Whether the page is out of sight: the window hidden (minimised, in the
 * tray) or not focused, or ambient mode covering it. Looping decoration holds
 * still meanwhile (the banners' drift, styles.css; the Home banner's
 * rotation): each frame it moves redraws the window, which on a high refresh
 * rate display is real CPU and GPU for something nobody is looking at.
 *
 * The root carries `data-page-unseen` while it is, for CSS.
 */
let covered = false;

export const pageUnseen = (): boolean => covered || document.hidden || !document.hasFocus();

const update = () => document.documentElement.toggleAttribute('data-page-unseen', pageUnseen());

/** Ambient mode covers the whole window while it's up. */
export function setPageCovered(on: boolean): void {
  covered = on;
  update();
}

export function installWindowActivity(): void {
  // On blur, once focus has settled: focus moving into a frame on the page blurs the window for a moment.
  window.addEventListener('blur', () => setTimeout(update));
  window.addEventListener('focus', update);
  document.addEventListener('visibilitychange', update);
  update();
}
