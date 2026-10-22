/**
 * The Glass theme's sheen (glass.css): the soft highlight on a glass surface
 * follows the pointer while it is over one. One listener; it writes two
 * custom properties on the surface under the pointer, at most once a frame,
 * so it costs a repaint of that one surface while the mouse moves and nothing
 * at rest. Not on Android (no pointer on a TV, and its glass is plates), and
 * not with reduced motion or reduced effects.
 */
const SURFACES = '.nav, .button.glass, .hero-queue, .toast, .palette, .alerts-panel, .quick-panel, .menu, .drawer';

const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** Whether the sheen may move now (the settings can change at any time). */
function active(): boolean {
  const root = document.documentElement.dataset;
  if (root.themeStyle !== 'glass' || root.effects === 'reduced' || root.motion === 'reduce') return false;
  return root.motion === 'full' || !reducedMotion?.matches;
}

export function startGlassSheen(): void {
  let lit: HTMLElement | null = null;
  let frame = 0;
  let x = 0;
  let y = 0;
  const reset = () => {
    lit?.style.removeProperty('--glass-lx');
    lit?.style.removeProperty('--glass-ly');
    lit = null;
  };
  document.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse') return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(SURFACES) : null;
      if (target !== lit) reset();
      if (!target || !active()) return;
      lit = target;
      x = event.clientX;
      y = event.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!lit) return;
        const box = lit.getBoundingClientRect();
        if (!box.width || !box.height) return;
        lit.style.setProperty('--glass-lx', `${Math.round(((x - box.left) / box.width) * 100)}%`);
        lit.style.setProperty('--glass-ly', `${Math.round(((y - box.top) / box.height) * 100)}%`);
      });
    },
    { passive: true },
  );
  document.documentElement.addEventListener('pointerleave', reset);
}
