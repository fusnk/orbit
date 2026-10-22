/**
 * Reduce visual effects → Auto (Settings → General → Comfort): turns the
 * effects down on a device that's likely to struggle with blurs, glows and
 * large shadows, and says why. The signals: the Android TV build, a
 * processor with 4 threads or fewer, 4 GB of memory or less (as the WebView
 * reports it, rounded), or a frame rate that stays low for a few seconds
 * after startup. A capable PC keeps the full look.
 *
 * The frame rate is measured only while the window is shown (a hidden or
 * minimised window draws no frames, which would read as a slow device), and
 * twice, apart, so one busy moment while Home loads doesn't decide it.
 */
import { isAndroid } from '../lib/platform';

/** Why Auto turned the effects down, or null when it didn't. */
export type AutoReason = { kind: 'tv' } | { kind: 'cores'; count: number } | { kind: 'memory'; gigabytes: number } | { kind: 'frames'; fps: number };

export const LOW_CORES = 4;
export const LOW_MEMORY_GB = 4;
/** Frames a second below this, in both measurements, count as low. */
export const LOW_FPS = 30;

export interface DeviceSignals {
  android: boolean;
  /** `navigator.hardwareConcurrency`, when known. */
  cores?: number | undefined;
  /** `navigator.deviceMemory` in GB, when known (Chromium-based WebViews only). */
  memoryGb?: number | undefined;
  /** The better of two low startup measurements, when both were low. */
  fps?: number | undefined;
}

/** The first signal that says this device is low-end, in order of certainty. Pure, for tests. */
export function lowEndReason(signals: DeviceSignals): AutoReason | null {
  if (signals.android) return { kind: 'tv' };
  if (signals.cores !== undefined && signals.cores > 0 && signals.cores <= LOW_CORES) return { kind: 'cores', count: signals.cores };
  if (signals.memoryGb !== undefined && signals.memoryGb > 0 && signals.memoryGb <= LOW_MEMORY_GB) return { kind: 'memory', gigabytes: signals.memoryGb };
  if (signals.fps !== undefined && signals.fps < LOW_FPS) return { kind: 'frames', fps: Math.round(signals.fps) };
  return null;
}

let measuredFps: number | undefined;

function deviceSignals(): DeviceSignals {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return { android: isAndroid, cores: nav.hardwareConcurrency || undefined, memoryGb: nav.deviceMemory, fps: measuredFps };
}

/** Why Auto has the effects down on this device right now, or null. */
export const autoReason = (): AutoReason | null => lowEndReason(deviceSignals());

/**
 * What a plain on/off switch (Quick settings) saves for the setting: On
 * pins the effects down. Off goes back to Auto, so the detection keeps
 * working on this device and the next one, unless Auto would turn them
 * down here too (`autoReduces`), where only Off keeps the full look.
 */
export const effectsSwitchValue = (on: boolean, autoReduces: boolean): 'reduced' | 'full' | 'auto' => (on ? 'reduced' : autoReduces ? 'full' : 'auto');

/** Dispatched on `document` when a measurement changed what Auto decides. */
export const AUTO_EFFECTS_CHANGED = 'orbit:auto-effects-changed';

/** Frames a second over `ms`, or null if the window was hidden meanwhile. */
function frameRate(ms: number): Promise<number | null> {
  return new Promise((resolve) => {
    if (document.visibilityState !== 'visible') return resolve(null);
    let frames = 0;
    let start = 0;
    const step = (now: number) => {
      if (document.visibilityState !== 'visible') return resolve(null);
      if (!start) start = now;
      else frames++;
      if (now - start >= ms) return resolve((frames * 1000) / (now - start));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Measures the frame rate twice, apart, unless another signal has already
 * decided (or `wanted` says Auto isn't in use). Dispatches
 * `AUTO_EFFECTS_CHANGED` when the result turns the effects down.
 */
export async function probeFrameRate(wanted: () => boolean): Promise<void> {
  if (measuredFps !== undefined || !wanted() || autoReason()) return;
  const first = await frameRate(2000);
  if (first === null || first >= LOW_FPS) return;
  await wait(8000);
  const second = wanted() ? await frameRate(2000) : null;
  if (second === null || second >= LOW_FPS) return;
  measuredFps = Math.max(first, second);
  document.dispatchEvent(new Event(AUTO_EFFECTS_CHANGED));
}
