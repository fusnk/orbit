/**
 * Settings → General → "When Orbit opens": how the window starts. The Rust
 * shell reads the same key (main_window.rs) and creates the window that way,
 * with the same default.
 */
export const WINDOW_MODES = ['normal', 'maximized', 'fullscreen'] as const;
export type WindowMode = (typeof WINDOW_MODES)[number];

/** Maximized unless one of the others was picked. */
export function parseWindowMode(raw: unknown): WindowMode {
  return raw === 'normal' || raw === 'fullscreen' ? raw : 'maximized';
}
