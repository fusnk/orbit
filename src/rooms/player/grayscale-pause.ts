/**
 * Settings → Player → Black and white when paused (off unless turned on):
 * the paused picture fades to grey, and colour comes back on play.
 *
 * The fade is mpv's own saturation (the video equaliser), stepped down over
 * half a second. It's applied as the picture is drawn, so unlike a video
 * filter (`vf=lavfi=[hue=s=0]`) it neither reinitialises the decoder nor
 * pushes hardware decoding back to the CPU. The page can't do it: the video
 * is a native surface beneath the WebView, which CSS can't touch.
 */

export const GRAYSCALE_PAUSE_KEY = 'player.grayscale-pause';
const FADE_MS = 500;
const STEPS = 8;

/** Whether animations are reduced (Settings → Appearance, or the system's setting). */
export function motionReduced(): boolean {
  const choice = document.documentElement.dataset.motion;
  if (choice === 'reduce') return true;
  return choice !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createGrayscalePause(setGray: (amount: number) => void) {
  let enabled = false;
  let target = 0;
  let level = 0;
  let timer: number | undefined;

  function goTo(next: number): void {
    target = next;
    window.clearInterval(timer);
    // Colour comes straight back on play; the fade is only for pausing.
    if (next === 0 || motionReduced()) {
      level = next;
      setGray(level);
      return;
    }
    const step = 1 / STEPS;
    timer = window.setInterval(() => {
      level = Math.min(target, level + step);
      setGray(level);
      if (level >= target) window.clearInterval(timer);
    }, FADE_MS / STEPS);
  }

  return {
    configure(on: boolean): void {
      enabled = on;
      if (!on && target) goTo(0);
    },
    /** mpv's paused state changed (or a new file started). */
    paused(paused: boolean): void {
      const next = enabled && paused ? 1 : 0;
      if (next !== target) goTo(next);
    },
    stop(): void {
      window.clearInterval(timer);
    },
  };
}
