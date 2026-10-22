/**
 * Font pairs (Settings → Appearance → Fonts): one font for the interface and
 * one for big titles. All are bundled with Orbit (open-licensed, from
 * Fontsource) because the CSP doesn't load fonts from the web; a font's files
 * are only read once something uses it.
 */
import '@fontsource-variable/fraunces';
import '@fontsource-variable/ibm-plex-sans';
// Inter's opsz build (opsz and wght axes): with `font-optical-sizing: auto`
// big titles get the Display cut and small text the Text cut.
import '@fontsource-variable/inter/opsz.css';
import './montserrat.css';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/space-grotesk';
// Arabic: Orbit's own fonts have no Arabic letters, so this follows each pair's Latin font.
// Every weight Orbit asks for up to 700 is a real cut; 800 (the hero) matches 700, so nothing is faux bold.
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import { t } from '../i18n';

// Chinese, Japanese and Korean come from the system's CJK fonts (--font-cjk, theme/tokens.css).
const FALLBACK = "'IBM Plex Sans Arabic', 'Segoe UI Variable', 'Segoe UI', var(--font-cjk), system-ui, sans-serif";

export interface FontPair {
  id: string;
  label: string;
  ui: string;
  display: string;
  /** Titles' weight, and how far their letters are spaced (Bebas Neue is narrow and wants room). */
  displayWeight: number;
  displayTracking: number;
  /** Home's banner and the title page's name. Bebas Neue has one weight, so it never asks for more. */
  heroWeight: number;
}

/** The pair someone who never picked one gets; a pair they picked is saved and stays. */
export const DEFAULT_FONTS = 'inter';

export const FONT_PAIRS = [
  { id: 'inter', label: 'Inter', ui: `'Inter Variable', ${FALLBACK}`, display: `'Inter Variable', ${FALLBACK}`, displayWeight: 700, displayTracking: 0, heroWeight: 800 },
  // Orbit's first pair. The id stays 'orbit' so everyone who picked it (and themes that carry it) keeps it.
  { id: 'orbit', label: t('settings.themes.fonts-billboard'), ui: `'Manrope Variable', ${FALLBACK}`, display: "'Bebas Neue', 'Manrope Variable', 'IBM Plex Sans Arabic', var(--font-cjk), sans-serif", displayWeight: 400, displayTracking: 1, heroWeight: 400 },
  { id: 'editorial', label: 'Editorial', ui: `'Inter Variable', ${FALLBACK}`, display: "'Fraunces Variable', Georgia, 'IBM Plex Sans Arabic', var(--font-cjk), serif", displayWeight: 600, displayTracking: 0, heroWeight: 600 },
  // Montserrat is wide: a slightly negative tracking factor (-0.1) tightens big titles a touch and trims their size by
  // a pixel or so. Its variable font ships 100–900, so 700 and the 800 hero are real cuts.
  { id: 'montserrat-titles', label: t('settings.themes.fonts-montserrat-titles'), ui: `'Inter Variable', ${FALLBACK}`, display: `'Montserrat Variable', ${FALLBACK}`, displayWeight: 700, displayTracking: -0.1, heroWeight: 800 },
  { id: 'montserrat', label: t('settings.themes.fonts-montserrat'), ui: `'Montserrat Variable', ${FALLBACK}`, display: `'Montserrat Variable', ${FALLBACK}`, displayWeight: 700, displayTracking: -0.1, heroWeight: 800 },
  { id: 'jakarta', label: 'Jakarta', ui: `'Plus Jakarta Sans Variable', ${FALLBACK}`, display: `'Plus Jakarta Sans Variable', ${FALLBACK}`, displayWeight: 700, displayTracking: 0, heroWeight: 800 },
  { id: 'plex', label: 'Plex', ui: `'IBM Plex Sans Variable', ${FALLBACK}`, display: `'IBM Plex Sans Variable', ${FALLBACK}`, displayWeight: 700, displayTracking: 0, heroWeight: 700 },
  { id: 'grotesk', label: 'Grotesk', ui: `'Space Grotesk Variable', ${FALLBACK}`, display: `'Space Grotesk Variable', ${FALLBACK}`, displayWeight: 700, displayTracking: 0, heroWeight: 700 },
  { id: 'system', label: t('settings.common.system'), ui: FALLBACK, display: FALLBACK, displayWeight: 700, displayTracking: 0, heroWeight: 700 },
] as const satisfies readonly FontPair[];

export type FontPairId = (typeof FONT_PAIRS)[number]['id'];

export const findFontPair = (id: unknown): FontPair => FONT_PAIRS.find((f) => f.id === id) ?? FONT_PAIRS.find((f) => f.id === DEFAULT_FONTS)!;

export function applyFonts(id: FontPairId): void {
  const pair = findFontPair(id);
  const root = document.documentElement.style;
  root.setProperty('--font-ui', pair.ui);
  root.setProperty('--font-display', pair.display);
  root.setProperty('--font-display-weight', String(pair.displayWeight));
  root.setProperty('--font-display-tracking', String(pair.displayTracking));
  root.setProperty('--font-hero-weight', String(pair.heroWeight));
}
