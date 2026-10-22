/**
 * Settings → Playback → Rewind cache: how much video the player keeps in
 * memory, so jumping back is instant. A preset per profile, read by Rust
 * when the next video opens (src-tauri/src/player/rewind_cache.rs maps each
 * one to fixed mpv buffer sizes; nothing typed ever reaches mpv).
 */
export const REWIND_CACHE_PREFIX = 'playback.rewind-cache';
export const REWIND_PRESETS = ['standard', 'more', 'most'] as const;
export type RewindPreset = (typeof REWIND_PRESETS)[number];

export const parseRewindCache = (value: unknown): RewindPreset => (REWIND_PRESETS.includes(value as RewindPreset) ? (value as RewindPreset) : 'standard');
