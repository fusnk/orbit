/**
 * "Near the screen" for pages drawn in the router's outlet. Pages scroll
 * inside the outlet (main.ts), not the window, and an IntersectionObserver
 * watching the window is clipped by the outlet's edge: its margin reached no
 * further than what was already on screen. So rows and pictures meant to load
 * a screen ahead only started once they were in view (on an Android TV, seconds
 * of empty cards per row). Watching the outlet itself lets the margin work.
 */

let scrollRoot: Element | null = null;

/** The element pages scroll in; set once by main.ts. */
export function setScrollRoot(el: Element): void {
  scrollRoot = el;
}

/**
 * An observer whose `rootMargin` reaches past the outlet's edge. Elements
 * outside the outlet (drawers, overlays) are never reported as intersecting:
 * use `whenNear` for those that may be.
 */
export function nearObserver(callback: IntersectionObserverCallback, rootMargin: string, scrollMargin?: string): IntersectionObserver {
  return new IntersectionObserver(callback, { root: scrollRoot, rootMargin, ...(scrollMargin ? { scrollMargin } : {}) });
}

/** Runs `run` once `el` comes within `rootMargin` of the screen, inside the outlet or not. */
export function whenNear(el: Element, rootMargin: string, run: () => void): void {
  const observers: IntersectionObserver[] = [];
  let done = false;
  const seen: IntersectionObserverCallback = (entries) => {
    if (done || !entries.some((entry) => entry.isIntersecting)) return;
    done = true;
    for (const observer of observers) observer.disconnect();
    run();
  };
  // The window as well, for elements outside the outlet.
  observers.push(new IntersectionObserver(seen, { rootMargin }));
  if (scrollRoot) observers.push(nearObserver(seen, rootMargin));
  for (const observer of observers) observer.observe(el);
}
