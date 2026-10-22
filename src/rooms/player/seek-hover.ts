/**
 * Keeps the seek bar's hover box (time, and the preview picture) inside the
 * window: it's centred over the pointer, so near either end of the bar half
 * of it would otherwise hang off the edge.
 */

/** Space kept between the box and the window's edge, in pixels. */
export const EDGE_MARGIN = 16;

/** How far (px) to move a box of `width` centred at `centre` so it stays `margin` inside a window `viewport` wide. */
export function edgeShift(centre: number, width: number, viewport: number, margin = EDGE_MARGIN): number {
  const half = width / 2;
  // Too wide to fit either way: keep its start inside, as the start is read first.
  if (width + 2 * margin >= viewport) return margin - (centre - half);
  if (centre - half < margin) return margin - (centre - half);
  if (centre + half > viewport - margin) return viewport - margin - (centre + half);
  return 0;
}
