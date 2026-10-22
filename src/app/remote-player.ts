/**
 * The player's link to the phone remote (see app/remote.ts): what it lets a
 * phone do while it's open, and what it tells Rust is playing. Kept apart
 * from app/remote.ts so the player needn't import the pages that module opens.
 */
import { invoke } from '@tauri-apps/api/core';

/** What the open player lets a phone do (see rooms/player/index.ts). */
export interface RemotePlayer {
  setPaused(paused: boolean): void;
  seekBy(seconds: number): void;
  seekTo(seconds: number): void;
  setVolume(level: number): void;
  setMuted(muted: boolean): void;
  playNext(): void;
  subtitle(id: number | null): void;
  audio(id: number): void;
  stop(): void;
}

/** What the player shows, for the phone. */
export interface NowPlaying {
  title: string;
  detail: string | null;
  poster: string | null;
  live: boolean;
  canNext: boolean;
  maxVolume: number;
}

let player: RemotePlayer | null = null;

/** The open player, if any. */
export const remotePlayer = (): RemotePlayer | null => player;

/** Tells Rust what's playing (kept even while the remote is off, so a phone pairing mid-film sees it). */
export function tellNowPlaying(now: NowPlaying | null): void {
  void invoke('remote_now_playing', { playing: now }).catch((err: unknown) => console.warn('Could not tell the phone remote what’s playing', err));
}

/** Lets phones control the player while it's open; the returned function lets go (as it closes). */
export function attachRemotePlayer(target: RemotePlayer): () => void {
  player = target;
  return () => {
    if (player !== target) return;
    player = null;
    tellNowPlaying(null);
  };
}
