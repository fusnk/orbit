/**
 * Night mode and the sound presets, one at a time (the player's Sound
 * view). The page only names a mode; Rust holds the filter each one is
 * (see `audio_options` in src-tauri/src/player/mod.rs).
 */
import type { MessageKey } from '../../i18n';

export const SOUND_MODES = ['off', 'night', 'cinema', 'music', 'dialogue'] as const;
export type SoundMode = (typeof SOUND_MODES)[number];

/** The saved mode. Before the presets there was only night mode, saved as a switch. */
export const SOUND_KEY = 'player.sound';

export const SOUND_NAMES: Record<SoundMode, MessageKey> = {
  off: 'playerplus.sound.off',
  night: 'player.picture.night',
  cinema: 'playerplus.sound.cinema',
  music: 'playerplus.sound.music',
  dialogue: 'playerplus.sound.dialogue',
};

export const SOUND_HINTS: Record<SoundMode, MessageKey> = {
  off: 'playerplus.sound.off-hint',
  night: 'player.picture.night-note',
  cinema: 'playerplus.sound.cinema-hint',
  music: 'playerplus.sound.music-hint',
  dialogue: 'playerplus.sound.dialogue-hint',
};

/** The saved mode; with none saved yet, night mode's old switch decides. */
export function parseSoundMode(saved: unknown, legacyNight: unknown): SoundMode {
  const mode = SOUND_MODES.find((m) => m === saved);
  if (mode) return mode;
  return legacyNight === true ? 'night' : 'off';
}
