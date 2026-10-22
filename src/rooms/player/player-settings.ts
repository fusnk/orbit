/**
 * Settings → Player and Video: how far a jump goes, whether the volume can
 * go above 100%, and HDR output. Read when the player opens.
 */

export const SEEK_STEP_KEY = 'player.seek-step';
export const SEEK_STEPS = [5, 10, 15, 30] as const;
export const DEFAULT_SEEK_STEP = 10;

/** The saved jump in seconds, or the default for anything else. */
export function parseSeekStep(value: unknown): number {
  return SEEK_STEPS.find((s) => s === value) ?? DEFAULT_SEEK_STEP;
}

export const VOLUME_BOOST_KEY = 'player.volume-boost';
/** The ceiling the older on/off "Allow volume above 100%" switch gave. */
export const BOOSTED_MAX = 150;
export const VOLUME_BOOST_LEVEL_PREFIX = 'player.volume-boost-level';
export const VOLUME_BOOST_LEVELS = [100, 125, 150, 200] as const;
export type VolumeBoostLevel = (typeof VOLUME_BOOST_LEVELS)[number];
/** The loudest preset: no saved volume may be above it. */
export const MAX_VOLUME_BOOST = Math.max(...VOLUME_BOOST_LEVELS);

/** The old switch keeps its 150% ceiling until a preset is saved. */
export function parseVolumeBoost(value: unknown): VolumeBoostLevel {
  return value === true ? BOOSTED_MAX : VOLUME_BOOST_LEVELS.find((level) => level === value) ?? 100;
}

/** A volume the player may use: whole, 0 to `max`. */
export function clampVolume(level: number, max: number): number {
  if (!Number.isFinite(level)) return max;
  return Math.min(max, Math.max(0, Math.round(level)));
}

/** The speaker for a volume (0–200): crossed out when muted or silent, then one wave per third of 100%. */
export function volumeIcon(level: number, muted: boolean): 'volumeOff' | 'volumeLow' | 'volumeMid' | 'volume' {
  if (muted || level <= 0) return 'volumeOff';
  if (level <= 33) return 'volumeLow';
  return level <= 66 ? 'volumeMid' : 'volume';
}

/** Settings → Video → HDR output (off unless turned on). */
export const HDR_KEY = 'video.hdr';

/** Settings → Picture & Sound → Softer subtitles in HDR (on unless turned off). */
export const HDR_SUBTITLES_KEY = 'video.hdr-subtitles';

/** Settings → Picture & Sound → Smooth motion: per profile (`<prefix>.<profile id>`), off unless turned on. */
export const SMOOTH_MOTION_PREFIX = 'video.smooth-motion';

/**
 * Settings → Audio & Subtitles → Audio passthrough: which formats go to a
 * receiver or soundbar undecoded. Off by default; "dolby-dts" is the common
 * set every passthrough-capable receiver takes, "all" adds the lossless ones
 * (TrueHD, DTS-HD MA), which need HDMI and a receiver that supports them.
 */
export const PASSTHROUGH_KEY = 'player.passthrough';
export const PASSTHROUGH_CHOICES = ['off', 'dolby-dts', 'all'] as const;
export type Passthrough = (typeof PASSTHROUGH_CHOICES)[number];
/** mpv's names for each choice's formats (Rust checks them against the same list). */
export const PASSTHROUGH_FORMATS: Record<Passthrough, readonly string[]> = {
  off: [],
  'dolby-dts': ['ac3', 'eac3', 'dts'],
  all: ['ac3', 'eac3', 'dts', 'dts-hd', 'truehd'],
};

/** The saved choice, or 'off'. */
export const parsePassthrough = (value: unknown): Passthrough => PASSTHROUGH_CHOICES.find((c) => c === value) ?? 'off';

/** Settings → Audio & Subtitles → Sync subtitles automatically (off unless turned on). */
export const AUTO_SYNC_KEY = 'player.auto-sync';

/**
 * Settings → Audio & Subtitles → Remove hearing-impaired text (off unless
 * turned on), and whether song lyrics stay when it's on (they do unless
 * turned off). See src-tauri/src/player/sdh.rs.
 */
export const STRIP_SDH_KEY = 'player.strip-sdh';
export const SDH_KEEP_LYRICS_KEY = 'player.sdh-keep-lyrics';

/** Settings → Player → Hold play/pause for 2× speed (on unless turned off; see hold-speed.ts). */
export const HOLD_BOOST_KEY = 'player.hold-boost';

/** Settings → Player → Double-click the sides to jump (off unless turned on). */
export const DOUBLE_CLICK_SEEK_KEY = 'player.double-click-seek';

/** Which side of the picture `x` is on, for double-click jumps: -1 the left third, 1 the right third, 0 the middle. */
export function pictureSide(x: number, left: number, width: number): -1 | 0 | 1 {
  if (!(width > 0)) return 0;
  const at = (x - left) / width;
  return at < 1 / 3 ? -1 : at > 2 / 3 ? 1 : 0;
}

/** Settings → Player → Number keys jump through the video: 1 to 10%, 5 to 50%… (on unless turned off). */
export const NUMBER_JUMP_KEY = 'player.number-jump';

/**
 * Settings → Audio & Subtitles → Fix ALL-CAPS subtitles (off unless turned
 * on). Only subtitle files Orbit adds itself; see src-tauri/src/player/caps.rs.
 */
export const FIX_CAPS_KEY = 'player.fix-caps';
