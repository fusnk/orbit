/**
 * A rating with its site's mark: IMDb's yellow tag, TMDB's gradient tag,
 * Letterboxd's three dots. Drawn as small SVGs with DOM APIs (no markup
 * parsing, nothing fetched), so they work offline and under the CSP.
 */
import { formatDecimal, t } from '../i18n';
import { h } from '../lib/dom';

const SVG_NS = 'http://www.w3.org/2000/svg';
export type RatingSite = 'imdb' | 'tmdb' | 'letterboxd';

function svg(width: number, height: number, ...children: SVGElement[]): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', `0 0 ${width} ${height}`);
  el.setAttribute('width', String(width));
  el.setAttribute('height', String(height));
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('class', 'rating-mark');
  el.append(...children);
  return el;
}

function node(name: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (text) el.textContent = text;
  return el;
}

/** A rounded tag with a word on it. */
function tag(width: number, fill: string, color: string, word: string, defs?: SVGElement): SVGSVGElement {
  return svg(
    width,
    16,
    ...(defs ? [defs] : []),
    node('rect', { width, height: 16, rx: 3, fill }),
    node('text', { x: width / 2, y: 12, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: color, 'letter-spacing': -0.2 }, word),
  );
}

let gradients = 0;

function mark(site: RatingSite): SVGSVGElement {
  if (site === 'imdb') return tag(34, '#f5c518', '#000', 'IMDb');
  if (site === 'tmdb') {
    // Each badge has its own gradient id, since several can be on a page.
    const id = `tmdb-grad-${++gradients}`;
    const grad = node('linearGradient', { id, x1: 0, x2: 1, y1: 0, y2: 0 });
    grad.append(node('stop', { offset: 0, 'stop-color': '#90cea1' }), node('stop', { offset: 1, 'stop-color': '#01b4e4' }));
    const defs = node('defs', {});
    defs.append(grad);
    return tag(38, `url(#${id})`, '#0d253f', 'TMDB', defs);
  }
  return svg(
    30,
    16,
    node('circle', { cx: 6, cy: 8, r: 5.2, fill: '#ff8000' }),
    node('circle', { cx: 15, cy: 8, r: 5.2, fill: '#00e054', 'fill-opacity': 0.92 }),
    node('circle', { cx: 24, cy: 8, r: 5.2, fill: '#40bcf4', 'fill-opacity': 0.92 }),
  );
}

const NAMES: Record<RatingSite, string> = { imdb: 'IMDb', tmdb: 'TMDB', letterboxd: 'Letterboxd' };

/**
 * "[IMDb] 8.0", with the site named for screen readers and on hover. A plain number (addons send IMDb's
 * as "8.1") is written the language's way: "8,1" in German, beside TMDB's.
 */
export function ratingBadge(site: RatingSite, value: string, hint?: string): HTMLElement {
  const shown = /^\d+(?:\.\d+)?$/.test(value.trim()) ? formatDecimal(Number(value)) : value;
  return h('span', { class: `rating-badge ${site}`, title: hint ?? t('browse.rating.title', { site: NAMES[site] }), 'aria-label': `${NAMES[site]} ${shown}` }, mark(site), h('span', { class: 'rating-value' }, shown));
}
