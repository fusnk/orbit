/**
 * On the view the router shows. A page's main view can stay in the page, hidden, while another
 * view shows (router.ts `Room.keep`): every other child of the outlet is such a kept view.
 */
export const SHOWN_VIEW = 'view-shown';

/** A view kept in the outlet, hidden (styles.css). */
const KEPT_VIEW_SELECTOR = `.outlet > :not(.${SHOWN_VIEW})`;

/**
 * Whether `el` is in the view showing now: in the page and not in a page's main view kept
 * hidden there. Media, timers and the ambient glow ask this rather than `isConnected`.
 */
export function isShown(el: Element): boolean {
  return el.isConnected && !el.closest(KEPT_VIEW_SELECTOR);
}
