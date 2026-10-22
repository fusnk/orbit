/**
 * Whether closing the player takes the window out of full screen (`now`): only a full screen
 * the player went into, and not with Settings → Playback → Stay in full screen on (`keep`). A
 * window already in full screen when the player opened (`before`: Settings → General → Open as
 * full screen, or kept from the last player) stays that way, as it was before the video.
 */
export function leavesFullscreen({ now, before, keep }: { now: boolean; before: boolean; keep: boolean }): boolean {
  return now && !before && !keep;
}

/**
 * Whether the player's top bar moves the window (the Tauri drag region). Only a window that's
 * neither in full screen nor maximized: neither can be dragged out of, and on a maximized one
 * a click near Back with a slight mouse move restored the window instead (as the app's own
 * title bar already avoids).
 */
export function topDragsWindow({ fullscreen, maximized }: { fullscreen: boolean; maximized: boolean }): boolean {
  return !fullscreen && !maximized;
}
