/**
 * The subtitle style as CSS, for the previews in Settings → Subtitles (the
 * card and the full-screen one) and the player's Subtitle style view.
 * Everything goes through custom properties and data attributes on the
 * preview's frame (CSSOM, so CSP-safe); the rules reading them are in
 * subtitle-preview.css (`.subtitle-preview`), loaded here for both.
 *
 * This is an approximation of what mpv draws, kept in one place so the two
 * can't drift apart. mpv sizes everything against a 720-line picture, so the
 * frame is a size container and the rules scale from its height (cqh). What
 * the page can't match exactly: libass's outline and shadow shapes (CSS text
 * stroke and shadow stand in), its line wrapping, and the real font's
 * fallback for letters it lacks.
 */
import { SUBTITLE_FONTS, type SubtitleStyle } from './subtitle-style';
import '../../theme/subtitle-fonts.css';
import './subtitle-preview.css';

/** mpv's own subtitle font on this platform (Segoe UI on Windows through DirectWrite's "sans-serif"). */
const DEFAULT_FAMILY = "'Segoe UI', system-ui, sans-serif";

/** "#rrggbb" at `percent` opacity, as CSS. */
export function rgba(hex: string, percent: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${percent / 100})`;
}

export function applySubtitleCss(frame: HTMLElement, style: SubtitleStyle): void {
  const family = SUBTITLE_FONTS.find(([id]) => id === style.font)?.[2] || DEFAULT_FAMILY;
  frame.style.setProperty('--sub-size', String(style.size));
  frame.style.setProperty('--sub-color', rgba(style.color, style.opacity));
  frame.style.setProperty('--sub-outline', String(style.outline));
  frame.style.setProperty('--sub-outline-color', style.outlineColor);
  frame.style.setProperty('--sub-back', rgba(style.backColor, style.backOpacity));
  // sub-pos: 100 is the bottom of the picture, lower is higher up, as a percentage of its height.
  frame.style.setProperty('--sub-lift', String(100 - style.position));
  frame.style.setProperty('--sub-font', family);
  frame.dataset.background = style.background;
  frame.dataset.bold = String(style.bold);
}
