/**
 * Which player events the page acts on. Each `player_open` carries the
 * page's number for that load and Rust tags the file's events with it, so
 * events from a file already left behind (a channel surfed past, a source
 * that failed over) can't update the screen or start a failover for the new one.
 */

/** Event kinds that still count before the new file reports it has loaded (Android's player screen can close while loading). */
const BEFORE_LOADED = new Set(['error', 'tracks', 'chapters', 'loaded', 'closed']);

/**
 * Whether an event tagged `eventLoad` is about the load the page is on
 * (`currentLoad`). Until that file has loaded, only its errors, track and
 * chapter lists (which can come just before) and the load itself count.
 */
export function acceptsEvent(kind: string, eventLoad: unknown, currentLoad: number, awaitingFile: boolean): boolean {
  if (eventLoad !== currentLoad) return false;
  return !awaitingFile || BEFORE_LOADED.has(kind);
}
