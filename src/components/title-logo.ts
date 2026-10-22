/**
 * Title logos in place of names (Settings → Use title logos): the banners,
 * the player's loading and pause screens. Titles from catalogs and TMDB often
 * come without a logo, so an IMDb title's full details (cached) fill it in.
 */
import { loadMeta } from '../catalog/service';
import type { Title } from '../catalog/titles';
import { h } from '../lib/dom';
import { appearance } from '../theme/appearance';
import './title-logo.css';

/**
 * Logos that failed to load, and when: the name shows instead for a while.
 * Not for good: a logo that failed while the network was still waking (after
 * sleep, say) would otherwise show as a name until Orbit restarted. Capped, so
 * a long session of failures doesn't grow it without end.
 */
const failed = new Map<string, number>();
const FAILED_FOR_MS = 30 * 60_000;
const MAX_FAILED = 500;
// The connection coming back is the likeliest fix for every failure.
if (typeof window !== 'undefined') window.addEventListener('online', () => failed.clear());

function failedNow(src: string): boolean {
  const at = failed.get(src);
  if (at === undefined) return false;
  if (Date.now() - at < FAILED_FOR_MS) return true;
  failed.delete(src);
  return false;
}

function noteFailed(src: string): void {
  failed.delete(src);
  if (failed.size >= MAX_FAILED) failed.delete(failed.keys().next().value!);
  failed.set(src, Date.now());
}

const usable = (src: string | undefined): src is string => !!src?.startsWith('https://') && !failedNow(src);

/** The title's logo address, or null if logos are off or it has none. */
export async function findLogo(title: Title): Promise<string | null> {
  if (!appearance().logos) return null;
  if (usable(title.logo)) return title.logo;
  if (!/^tt\d+$/.test(title.id)) return null;
  const logo = (await loadMeta(title.type, title.id).catch(() => null))?.logo;
  return usable(logo) && appearance().logos ? logo : null;
}

/** The logo the title already carries (no lookup), or null if logos are off or it has none. */
export function knownLogo(title: Title): string | null {
  return appearance().logos && usable(title.logo) ? title.logo : null;
}

/** The logo's image. Its alt is empty: the name stays beside it for screen readers. */
export function logoImage(src: string, className: string, lazy = false): HTMLImageElement {
  const img = h('img', { class: className, src, alt: '', decoding: 'async', loading: lazy ? 'lazy' : 'eager', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => noteFailed(src), { once: true });
  return img;
}

/**
 * A heading holding the title's name, which gives way to its logo once that
 * has loaded (the name stays for screen readers, and comes back if the logo
 * fails). A heading replaced before its logo is found just never shows it.
 */
export function titleHeading(tag: 'h2' | 'span', className: string, title: Title): HTMLElement {
  const heading = h(tag, { class: `${className} title-logo-heading` }, h('span', { class: 'title-logo-name' }, title.name));
  void findLogo(title).then((src) => {
    if (!src) return;
    const img = logoImage(src, 'title-logo');
    img.addEventListener('load', () => heading.classList.add('has-logo'), { once: true });
    img.addEventListener(
      'error',
      () => {
        heading.classList.remove('has-logo');
        img.remove();
      },
      { once: true },
    );
    heading.append(img);
  });
  return heading;
}

/**
 * A network's or studio's logo on a title page (TMDB's, drawn white). Its own class: `.title-logo` is the
 * title's logo, hidden until it loads, which kept these from ever showing. One that doesn't load is dropped.
 */
export function networkLogo(logo: { name: string; logo: string }): HTMLImageElement {
  const img = h('img', { class: 'network-logo', src: logo.logo, alt: logo.name, title: logo.name, referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}
