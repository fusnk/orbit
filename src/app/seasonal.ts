/**
 * Seasonal touches (Settings → Appearance → Little extras): a small glyph by
 * the title bar's wordmark (a bat from 15 to 31 October, a leaf through
 * November for Thanksgiving, a snowflake through December), drawn in the
 * season's colour, and `data-season` on the root so the artwork glow on Home
 * and title pages warms up (styles.css `.ambient`). Still: no particles, no
 * motion. Reduce visual effects hides both (fun.css, styles.css). The date is
 * looked at again every hour, so a session left open across the 1st still changes.
 */
import { t } from '../i18n';
import { seasonOn, type Season } from '../lib/fun';
import { FUN_CHANGED, funPrefs } from './fun-settings';
import './fun.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HOUR_MS = 60 * 60 * 1000;

const GLYPHS: Record<Season, { path: string; filled: boolean; viewBox: string }> = {
  halloween: {
    path: 'M12 8.5c.6-.9 1-1.3 1.6-1.3l.4 1.3c1.7-1.9 4.3-2.6 7.5-2.1-1 .8-1.6 1.9-1.6 3.4-1.4-.4-2.6 0-3.4 1-.9-.8-2-.9-3 .2-.6.6-1 1.4-1.5 2.6-.5-1.2-.9-2-1.5-2.6-1-1.1-2.1-1-3-.2-.8-1-2-1.4-3.4-1 0-1.5-.6-2.6-1.6-3.4 3.2-.5 5.8.2 7.5 2.1l.4-1.3c.6 0 1 .4 1.6 1.3z',
    filled: true,
    // Cropped to the wings, so the bat isn't lost in empty space.
    viewBox: '2 5 20 10',
  },
  thanksgiving: {
    // An autumn leaf and its midrib, drawn in the snowflake's line (side veins blur at title-bar size).
    path: 'M5 19C5 10.5 10.5 4.5 19.5 4.5C19.5 13.5 13.5 19 5 19ZM5 19L13.5 10.5',
    filled: false,
    viewBox: '0 0 24 24',
  },
  christmas: {
    // Six arms, each with a small V two-thirds of the way out.
    path: 'M12 12L12 3M10 4.4L12 6.4L14 4.4M12 12L19.8 7.5M17.6 6.5L16.8 9.2L19.6 9.9M12 12L19.8 16.5M19.6 14.1L16.8 14.8L17.6 17.5M12 12L12 21M14 19.6L12 17.6L10 19.6M12 12L4.2 16.5M6.4 17.5L7.2 14.8L4.4 14.1M12 12L4.2 7.5M4.4 9.9L7.2 9.2L6.4 6.5',
    filled: false,
    viewBox: '0 0 24 24',
  },
};

/** The season shown now: none with Seasonal touches off. */
export const seasonNow = (): Season | null => (funPrefs().seasonal ? seasonOn(new Date()) : null);

/** Fired on `document` when the season shown changes (the date moved on, or the switch). */
export const SEASON_CHANGED = 'orbit:season-changed';

/** Keeps the seasonal glyph inside `wordmark`, and the root's `data-season`, in step with the date and the switch. */
export function installSeasonal(wordmark: HTMLElement): void {
  let shown: Season | null = null;
  const sync = () => {
    const season = seasonNow();
    if (season === shown) return;
    shown = season;
    wordmark.querySelector('.seasonal-mark')?.remove();
    if (season) {
      wordmark.append(seasonGlyph(season));
      document.documentElement.dataset['season'] = season;
    } else delete document.documentElement.dataset['season'];
    document.dispatchEvent(new Event(SEASON_CHANGED));
  };
  sync();
  document.addEventListener(FUN_CHANGED, sync);
  window.setInterval(sync, HOUR_MS);
}

/**
 * The season's glyph (decoration: screen readers skip it). By the wordmark it
 * has its greeting as a tooltip; `tooltip: false` leaves it out where the
 * glyph sits inside text, whose own wording it would otherwise join.
 */
export function seasonGlyph(season: Season, tooltip = true): SVGSVGElement {
  const { path, filled, viewBox } = GLYPHS[season];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `seasonal-mark ${season}${filled ? ' filled' : ''}`);
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  // A tooltip for the curious; the wordmark's own label (Home) is what's announced.
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = t(season === 'halloween' ? 'fun.seasonal.halloween' : season === 'thanksgiving' ? 'fun.seasonal.thanksgiving' : 'fun.seasonal.winter');
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', path);
  svg.append(...(tooltip ? [title] : []), shape);
  return svg;
}
