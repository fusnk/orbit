/**
 * What source ranking prefers (Settings → Playback → Preferred quality and
 * the rules under "Choosing a source", and Settings → Audio & Subtitles →
 * Preferred audio language), and whether
 * torrent sources are offered at all (Settings → Playback → Torrents).
 * Loaded at startup and again whenever one changes, so ranking stays
 * synchronous.
 */
import { NO_AUTOPLAY_LIMITS, parseAutoplayLimits, type AutoplayLimits } from '../../lib/autoplay';
import { settings } from '../../lib/ipc';
import { profileSetting } from '../../library/profiles';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_RULES, MAC_SUPPORT, parseDeviceSupport, parseSourceRules, type DeviceSupport, type RankingPrefs, type Resolution } from '../../lib/ranking-fallback';
import { isAndroid, isMac } from '../../lib/platform';
import { LANGUAGE_SETTINGS, parseLanguage } from '../player/preferred-language';

export const QUALITY_KEY = 'playback.quality';
export const QUALITIES: readonly [Resolution, string][] = [
  ['2160p', '4K'],
  ['1080p', '1080p'],
  ['720p', '720p'],
  ['480p', '480p'],
];

/** A saved quality, or the design's default (1080p). */
export function parseQuality(value: unknown): Resolution {
  return QUALITIES.find(([q]) => q === value)?.[0] ?? '1080p';
}

/** Torrents: hidden (default), downloaded only, or downloaded and shared while watching. */
export const TORRENT_KEY = 'playback.torrents';
export const TORRENT_MODES = ['off', 'download', 'share'] as const;
export type TorrentMode = (typeof TORRENT_MODES)[number];
export const parseTorrentMode = (value: unknown): TorrentMode => TORRENT_MODES.find((m) => m === value) ?? 'off';

/** Settings → Playback → Choosing a source: one object (see `parseSourceRules`). */
export const RULES_KEY = 'playback.source-rules';

/**
 * Settings → Playback → Autoplay limits, per profile (profiles.rs
 * `PROFILE_SETTINGS`): what an automatic pick may land on (see autoplay.ts).
 * The rules above reorder every list; these only filter automatic picks.
 */
export const AUTOPLAY_LIMITS_PREFIX = 'playback.autoplay-limits';

let prefs: RankingPrefs = { preferredQuality: '1080p', language: 'en', rules: DEFAULT_RULES };
/** Android: what this TV can decode and show, asked once (it doesn't change while Orbit runs); a Mac's is known (MAC_SUPPORT). */
let device: Promise<DeviceSupport | undefined> | undefined;
let torrents: TorrentMode = 'off';
let limits: AutoplayLimits = NO_AUTOPLAY_LIMITS;

export const torrentMode = (): TorrentMode => torrents;
export const autoplayLimits = (): AutoplayLimits => limits;

/** For ranking an episode's sources, pass `episode`: its size limit is smaller. */
export const rankingPrefs = (episode = false): RankingPrefs => (episode ? { ...prefs, episode } : prefs);

export async function loadRankingPrefs(): Promise<void> {
  device ??= isAndroid ? invoke('player_device_support').then(parseDeviceSupport, () => undefined) : Promise.resolve(isMac ? MAC_SUPPORT : undefined);
  const [quality, language, torrent, rules, autoplay, support] = await Promise.all([
    settings.get(QUALITY_KEY).catch(() => null),
    settings.get(LANGUAGE_SETTINGS.audio).catch(() => null),
    settings.get(TORRENT_KEY).catch(() => null),
    settings.get(RULES_KEY).catch(() => null),
    profileSetting(AUTOPLAY_LIMITS_PREFIX).catch(() => ({ value: null })),
    device,
  ]);
  torrents = parseTorrentMode(torrent);
  limits = parseAutoplayLimits(autoplay.value);
  // Without a preferred audio language, English (as before the setting existed).
  prefs = { preferredQuality: parseQuality(quality), language: parseLanguage(language) || 'en', rules: parseSourceRules(rules), ...(support ? { device: support } : {}) };
}
