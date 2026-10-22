/** Hue of the ambient glow when a page's artwork has no readable colour (warm neutral). */
export const DEFAULT_AMBIENT_HUE = 45;

/**
 * Tints the colour wash behind the page (see `.ambient` in styles.css) with
 * the artwork's hue, or clears it (`null`). Only pages with a hero (artwork)
 * carry a hue; every other page sits on the plain theme background, so the
 * router clears the wash whenever it shows one of those.
 */
export function setAmbientHue(hue: number | null): void {
  // Set on the glow itself: a custom property changed on the root restyles the
  // whole page (the hero changes it every few seconds).
  const glow = document.querySelector<HTMLElement>('.ambient');
  if (!glow) return;
  if (hue === null) {
    delete glow.dataset.art;
    return;
  }
  glow.dataset.art = '';
  if (glow.style.getPropertyValue('--ambient-hue') !== String(hue)) glow.style.setProperty('--ambient-hue', String(hue));
}
