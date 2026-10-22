import { h } from '../lib/dom';

/**
 * A streaming service's logo (TMDB's), or its first letter in a rounded square when it has none or the logo
 * doesn't load (offline, TMDB's image host down), so a tile never shows the browser's broken-image icon.
 */
export function serviceLogo(service: { name: string; logo?: string | null }, lazy = false): HTMLElement {
  const initial = () => h('span', { class: 'service-initial', 'aria-hidden': 'true' }, service.name.slice(0, 1));
  if (!service.logo) return initial();
  const img = h('img', { src: service.logo, alt: '', referrerpolicy: 'no-referrer', ...(lazy ? { loading: 'lazy' } : {}) });
  img.addEventListener('error', () => img.replaceWith(initial()), { once: true });
  return img;
}
