/**
 * Subtitles move up while the controls are showing, so the bar never covers
 * a line, and go back down when the controls hide. The page measures how
 * much of the window the controls cover; Rust raises mpv's subtitles that
 * far above where the person put them (see `player_lift_subtitles`), never
 * lower than their own position. Nothing here animates (mpv moves the lines
 * at once), so reduced motion needs nothing else; changes wait a moment, so
 * a quick show-and-hide doesn't make the lines jump twice.
 */

/** mpv's own margin already keeps lines this far (percent) above the bottom. */
const MPV_MARGIN = 2;
/** Matches Rust's limit. */
export const MAX_LIFT = 30;
/** How long a change waits for the controls to settle. */
const SETTLE_MS = 150;

/** Percent of the window's height to raise subtitles to clear `covered` pixels of controls at the bottom of a window `height` pixels tall. */
export function liftFor(covered: number, height: number): number {
  if (!(height > 0) || !(covered > 0)) return 0;
  return Math.min(MAX_LIFT, Math.max(0, Math.ceil((covered / height) * 100) - MPV_MARGIN));
}

export function createSubtitleLift(send: (lift: number) => void) {
  let sent = 0;
  let wanted = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    /** The lift the controls call for now; sent once it holds for a moment. */
    want(lift: number): void {
      if (lift === wanted) return;
      wanted = lift;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (wanted === sent) return;
        sent = wanted;
        send(sent);
      }, SETTLE_MS);
    },
    /** The player closes: subtitles go back down at once. */
    reset(): void {
      clearTimeout(timer);
      wanted = 0;
      if (sent !== 0) send(0);
      sent = 0;
    },
  };
}