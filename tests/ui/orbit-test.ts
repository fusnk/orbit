/**
 * `window.orbitTest`, the helpers the layout fixtures put on their page for the specs (see README.md).
 * Each fixture fills its own part: player.html the player's, app.html the app's.
 */
import type * as data from './app-data';

/** Both fixtures: mpv's events for the open player. */
interface PlayerEvents {
  /** The file opens and plays, as mpv reports it. */
  start(): Promise<void>;
  /** A status event: an hour-long file, ten minutes in, playing, unless `extra` says otherwise. */
  status(extra?: Record<string, unknown>): Promise<void>;
}

/** player.html */
export interface PlayerTest extends PlayerEvents {
  presets: readonly string[];
}

/** app.html */
export interface AppTest extends PlayerEvents {
  data: typeof data;
  ready: Promise<boolean>;
  settled(ms?: number): Promise<boolean>;
  busy(): string[];
  go(room: string): Promise<boolean>;
  openTitle(idOrName: string): Promise<boolean>;
  openPlayer(idOrName?: string, start?: boolean): Promise<void>;
  /** Sends a player event for the file open now (its `load` filled in), e.g. `{ kind: 'error', message }`. */
  player(event: Record<string, unknown>): Promise<void>;
  emit(event: string, payload: unknown): Promise<void>;
  reconnect(): Promise<boolean>;
  settings: Map<string, unknown>;
  unanswered: Set<string>;
  calls: [string, unknown][];
}

declare global {
  interface Window {
    orbitTest: PlayerTest & AppTest;
  }
}
