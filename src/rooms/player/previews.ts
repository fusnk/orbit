/**
 * Seek-bar previews (Settings → Video, on by default; see
 * src-tauri/src/player/thumbs.rs). Hovering asks Rust for the frame nearest
 * that time; only one request runs at a time and the newest hover wins, and
 * frames are kept per 5-second step so moving back is instant.
 */
import { invoke } from '@tauri-apps/api/core';

/** Settings → Video → Seek bar previews: true (default) or false. */
export const PREVIEWS_KEY = 'video.previews';
const STEP_S = 5;
const MAX_CACHED = 300;

export function createPreviews() {
  let size: [number, number] | null = null;
  let session = 0;
  let busy = false;
  let wanted: number | null = null;
  let onFrame: ((frame: ImageData, seconds: number) => void) | null = null;
  const cache = new Map<number, ImageData>();

  /** Raw BGRA from mpv as an ImageData (RGBA). */
  function toImage(bytes: ArrayBuffer, [w, h]: [number, number]): ImageData | null {
    if (bytes.byteLength !== w * h * 4) return null;
    const pixels = new Uint8ClampedArray(bytes);
    for (let i = 0; i < pixels.length; i += 4) {
      const b = pixels[i]!;
      pixels[i] = pixels[i + 2]!;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
    return new ImageData(pixels, w, h);
  }

  async function pump(): Promise<void> {
    if (busy || wanted === null || !size) return;
    const seconds = wanted;
    const run = session;
    wanted = null;
    busy = true;
    try {
      const bytes = await invoke<ArrayBuffer>('thumbs_at', { seconds });
      const frame = run === session && size ? toImage(bytes, size) : null;
      if (frame) {
        if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
        cache.set(seconds, frame);
        onFrame?.(frame, seconds);
      }
    } catch {
      // A preview that fails just doesn't show.
    } finally {
      busy = false;
      void pump();
    }
  }

  return {
    /** Starts previews for a web stream at the video's size. */
    async start(url: string, width: number, height: number): Promise<void> {
      this.stop();
      const run = session;
      const preview = await invoke<[number, number]>('thumbs_start', { url, width, height }).catch(() => null);
      if (run === session) size = preview;
    },
    stop(): void {
      session++;
      size = null;
      wanted = null;
      cache.clear();
      void invoke('thumbs_stop').catch(() => {});
    },
    /** The preview box's size, once previews are running. */
    size: () => size,
    /** Asks for the frame near `seconds`; `draw` gets it (now if cached). */
    request(seconds: number, draw: (frame: ImageData, seconds: number) => void): void {
      if (!size) return;
      const step = Math.max(0, Math.round(seconds / STEP_S) * STEP_S);
      onFrame = draw;
      const cached = cache.get(step);
      if (cached) return draw(cached, step);
      wanted = step;
      void pump();
    },
  };
}
