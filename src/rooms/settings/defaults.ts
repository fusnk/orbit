/**
 * Every preference row's value out of the box, per Settings category: what
 * marks a folded row "Changed" (fold.ts) and what "Reset this section" puts
 * back (reset.ts).
 *
 * Each value is read the way its page reads it (the same parsers and
 * stores), so "Changed" means the row shows something other than the
 * default. Resetting writes the default through the same store a row would
 * use, so whatever follows it (the interface scale, the ranking, the
 * download schedule) updates at once. Setting keys and value formats stay
 * exactly as they were.
 *
 * Reset never goes near accounts, secrets, addons, sources (IPTV), folders,
 * profiles, the library or history: rows for those have no `reset` or
 * aren't listed. Looks, themes, the accent, the menu, fonts and the
 * wallpaper aren't either: Looks have their own "Restore my previous setup".
 */
import type { MessageKey } from '../../i18n';
import { AIR_TIMES_KEY, loadAirTimesSetting } from '../../catalog/air-times';
import { settings } from '../../lib/ipc';
import { activityOptionsChanged } from '../../app/activity';
import { setAnimeTabShown } from '../../app/anime-tab';
import { discordOptions, parseDiscordOptions, setDiscordOptions, type DiscordOptions } from '../../app/discord-options';
import { funPrefs, setFun } from '../../app/fun-settings';
import { HOVER_INFO_KEY, setHoverInfo } from '../../components/hover-info';
import { refreshWatchedMarks } from '../../components/watched-marks';
import { NO_AUTOPLAY_LIMITS, parseAutoplayLimits, type AutoplayLimits } from '../../lib/autoplay';
import { FUN_DEFAULTS, type FunPrefs } from '../../lib/fun';
import { DEFAULT_RULES, parseSourceRules, type SourceRules } from '../../lib/ranking-fallback';
import { alertPrefs, parsePrefs, setAlertPrefs, type AlertPrefs } from '../../library/alerts';
import { KEEP_COUNT_KEY, parseKeepCount } from '../../library/auto-downloads';
import { parseSpeedLimit, parseWindow, SPEED_LIMIT_KEY, WINDOW_KEY } from '../../library/download-schedule';
import { applyDownloadSchedule, parseMaxQuality, QUALITY_KEY as DOWNLOAD_QUALITY_KEY } from '../../library/downloads';
import { profileSetting } from '../../library/profiles';
import { parseSpoilers, setSpoilers, spoilers, SPOILERS_PREFIX, type Spoilers } from '../../library/spoilers';
import { parseContinueDays, parseWatchedAt, setWatchPrefs, WATCH_SETTINGS, watchPrefs } from '../../library/watch';
import { LIVE_SETTINGS, parseOpenOn } from '../../live/surf';
import { parseVodSources, VOD_SOURCES_KEY } from '../../live/vod';
import { appearance, APPEARANCE_DEFAULTS, setAppearance, type Appearance } from '../../theme/appearance';
import { activeLook, lookDefault } from '../../theme/looks';
import { ambientPrefs, AMBIENT_SETTINGS, DEFAULT_AMBIENT, setAmbientPrefs, type AmbientPrefs } from '../ambient/settings';
import { AUTOPLAY_LIMITS_PREFIX, loadRankingPrefs, parseQuality, parseTorrentMode, QUALITY_KEY, RULES_KEY, TORRENT_KEY } from '../detail/ranking-prefs';
import { BANNER_TRAILER_KEY, HERO_TRAILER_KEY, parseTrailerDelay, TRAILER_DELAY_KEY, TRAILER_SOUND_KEY, trailerSound } from '../detail/trailer-settings';
import { homeLayout } from '../home/rows';
import { EPISODES_DOCKED_KEY } from '../player/episode-dock';
import { EXTERNAL_KEY, parseExternal } from '../player/external';
import { GRAYSCALE_PAUSE_KEY } from '../player/grayscale-pause';
import { DEFAULT_LAYOUT, layoutChanged, loadPlayerLayout, PLAYER_LAYOUT_KEY, type PlayerLayout } from '../player/layout';
import { parseResumeSourceMode, RESUME_SOURCE_PREFIX } from '../player/last-source';
import { FILM_END_KEY, parseFilmEnd } from '../player/end-screen-rules';
import { LEARN_SKIPS_KEY } from '../player/learned-skips';
import { countdownSeconds, HWDEC_KEY, parseAutoplayLimit, parseAutoplayMode, parseNextUpAt, parseNextUpStyle, PLAYBACK_SETTINGS } from '../player/next-up';
import { LEGACY_LOOK_KEY, NEUTRAL, parsePicture, parsePictureQuality, PICTURE_KEY, PICTURE_QUALITY_KEY } from '../player/picture';
import { AUDIO_DEVICE_PREFIX, AUTO_DEVICE, parseAudioDevice } from '../player/audio-device';
import { AUTO_SYNC_KEY, DEFAULT_SEEK_STEP, DOUBLE_CLICK_SEEK_KEY, FIX_CAPS_KEY, HDR_KEY, HDR_SUBTITLES_KEY, HOLD_BOOST_KEY, NUMBER_JUMP_KEY, parsePassthrough, parseSeekStep, PASSTHROUGH_KEY, SDH_KEEP_LYRICS_KEY, SEEK_STEP_KEY, SMOOTH_MOTION_PREFIX, STRIP_SDH_KEY, VOLUME_BOOST_KEY, VOLUME_BOOST_LEVEL_PREFIX } from '../player/player-settings';
import { AI_SUBS_ENABLED_KEY } from '../player/subtitle-translate';
import { LANGUAGE_SETTINGS, parseAudioLanguage, parseLanguage } from '../player/preferred-language';
import { PREVIEWS_KEY } from '../player/previews';
import { parseRewindCache, REWIND_CACHE_PREFIX } from '../player/rewind-cache';
import { AUTO_SKIP_DELAY_KEY, parseAutoSkipDelay, parseSkipModes, SKIP_MODES_KEY, type SegmentKind } from '../player/skip';
import { ANISKIP_KEY, parseAniSkip, parseSegmentColors, parseSkipButtonDelay, parseSkipLanding, parseSmoothSkip, SEGMENT_COLORS_KEY, SKIP_BUTTON_DELAY_KEY, SKIP_LANDING_KEY, SMOOTH_SKIP_KEY } from '../player/skip-tuning';
import { AUDIO_NORMALIZE_KEY, DEFAULT_SUBTITLE_STYLE, saveSubtitleStyle, subtitleStyle, type SubtitleStyle } from '../player/subtitle-style';
import { AVOID_TRACKS_KEY, DEFAULT_AVOID_WORDS } from '../player/tracks';
import { parseVolumePopupPosition, VOLUME_POPUP_KEY, VOLUME_POPUP_POSITION_KEY } from '../player/volume-popup';
import { GENERAL_SETTINGS } from './general';
import { CLOCK_KEY, parseClock, setClock } from '../../lib/clock';
import { parseWindowMode } from './window-mode';

export interface Pref {
  /** The row it belongs to, by its label (as the page draws it and the palette finds it); for a simple row, only its name in the reset list. */
  label: MessageKey;
  /** Setting keys whose saving can change it; a per-profile one also matches `<key>.<profile id>`. */
  keys: readonly string[];
  /** What the row shows now. */
  read(): Promise<unknown>;
  /** What it shows out of the box. */
  initial: unknown;
  /** What it goes back to right now, where that follows other settings (the Look on screen); `initial` otherwise. */
  base?: () => Promise<unknown>;
  /** Puts `initial` back. Absent where Reset never goes (see the top of this file). */
  reset?: () => Promise<unknown>;
}

/** Structural equality, for the plain data settings hold (key order doesn't matter). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Whether a row showing `value` differs from its default. */
export const isChanged = (value: unknown, initial: unknown): boolean => !sameValue(value, initial);

/** The labels among `prefs` whose `values` (read in the same order) differ from their defaults. */
export function changedLabels(prefs: readonly Pick<Pref, 'label' | 'initial'>[], values: readonly unknown[]): Set<MessageKey> {
  return new Set(prefs.filter((pref, i) => isChanged(values[i], pref.initial)).map((pref) => pref.label));
}

/** Whether saving `saved` can change `pref` (a per-profile key ends in the profile's id). */
export const affects = (pref: Pick<Pref, 'keys'>, saved: string): boolean => pref.keys.some((key) => saved === key || saved.startsWith(`${key}.`));

const get = (key: string): Promise<unknown> => settings.get(key).catch(() => null);

/** A setting saved on its own: read through `parse`, reset by saving `initial` (then `after`, for whatever caches it). */
function plain<T>(label: MessageKey, key: string, initial: T, parse: (raw: unknown) => T, after?: () => unknown): Pref {
  return {
    label,
    keys: [key],
    initial,
    read: () => get(key).then(parse),
    reset: () => settings.set(key, initial).then(after),
  };
}

/** A setting each profile has its own of. */
function perProfile<T>(label: MessageKey, prefix: string, initial: T, parse: (raw: unknown) => T): Pref {
  return {
    label,
    keys: [prefix],
    initial,
    read: () => profileSetting(prefix).then(({ value }) => parse(value)),
    reset: () => profileSetting(prefix).then(({ key }) => settings.set(key, initial)),
  };
}

const bool = (initial: boolean) => (raw: unknown) => (initial ? raw !== false : raw === true);
const rank = () => void loadRankingPrefs();
const schedule = () => applyDownloadSchedule();

/**
 * What a field of `appearance` goes back to: with a Look on, its own value for
 * what it sets (so a reset leaves the Look as freshly chosen, not "Custom");
 * otherwise, and once the Look was changed by hand, Orbit's default.
 */
const lookBase = async <K extends keyof Appearance>(field: K): Promise<Appearance[K]> => lookDefault(activeLook(await loadPlayerLayout()), field);

/** One field of `appearance` (scale, glow, poster size…). */
const look = <K extends keyof Appearance>(label: MessageKey, field: K): Pref => ({
  label,
  keys: ['appearance'],
  initial: APPEARANCE_DEFAULTS[field],
  base: () => lookBase(field),
  read: async () => appearance()[field],
  reset: async () => setAppearance({ [field]: await lookBase(field) }),
});

const fun = (label: MessageKey, field: keyof FunPrefs): Pref => ({ label, keys: ['fun'], initial: FUN_DEFAULTS[field], read: async () => funPrefs()[field], reset: () => setFun({ [field]: FUN_DEFAULTS[field] }) });

const ambient = (label: MessageKey, field: keyof AmbientPrefs): Pref => ({
  label,
  keys: Object.values(AMBIENT_SETTINGS),
  initial: DEFAULT_AMBIENT[field],
  read: async () => ambientPrefs()[field],
  reset: () => setAmbientPrefs({ [field]: DEFAULT_AMBIENT[field] }),
});

const ALERT_DEFAULTS = parsePrefs(undefined);
const alerts = (label: MessageKey, field: keyof AlertPrefs): Pref => ({ label, keys: ['alerts.prefs'], initial: ALERT_DEFAULTS[field], read: async () => alertPrefs()[field], reset: () => setAlertPrefs({ [field]: ALERT_DEFAULTS[field] }) });

/** A new profile's spoiler settings with Orbit's own defaults (not an older install's switches). */
const SPOILER_DEFAULTS = parseSpoilers(null, APPEARANCE_DEFAULTS);
const spoiler = (label: MessageKey, field: keyof Spoilers): Pref => ({ label, keys: [SPOILERS_PREFIX], initial: SPOILER_DEFAULTS[field], read: async () => spoilers()[field], reset: () => setSpoilers({ [field]: SPOILER_DEFAULTS[field] }) });

const DISCORD_DEFAULTS = parseDiscordOptions(null);
const discord = (label: MessageKey, field: keyof DiscordOptions): Pref => ({
  label,
  keys: ['integrations.discord-options'],
  initial: DISCORD_DEFAULTS[field],
  read: async () => discordOptions()[field],
  reset: () => setDiscordOptions({ [field]: DISCORD_DEFAULTS[field] }).then(activityOptionsChanged),
});

/** One kind of segment's skip mode, in the one saved object (an older "skip automatically" switch still counts until it's saved). */
const SKIP_DEFAULTS = parseSkipModes(null, null);
const readSkips = () => Promise.all([get(SKIP_MODES_KEY), get(PLAYBACK_SETTINGS.autoSkip)]).then(([saved, legacy]) => parseSkipModes(saved, legacy));
const skip = (label: MessageKey, kind: SegmentKind): Pref => ({
  label,
  keys: [SKIP_MODES_KEY, PLAYBACK_SETTINGS.autoSkip],
  initial: SKIP_DEFAULTS[kind],
  read: () => readSkips().then((modes) => modes[kind]),
  reset: () => readSkips().then((modes) => settings.set(SKIP_MODES_KEY, { ...modes, [kind]: SKIP_DEFAULTS[kind] })),
});

/** One kind's colour on the seek bar, in the one saved object. */
const band = (label: MessageKey, kind: SegmentKind): Pref => ({
  label,
  keys: [SEGMENT_COLORS_KEY],
  initial: 'default',
  read: () => get(SEGMENT_COLORS_KEY).then((saved) => parseSegmentColors(saved)[kind]),
  reset: () => get(SEGMENT_COLORS_KEY).then((saved) => settings.set(SEGMENT_COLORS_KEY, { ...parseSegmentColors(saved), [kind]: 'default' })),
});

/** Part of the source rules (one saved object). `pick` and `put` read and write that part. */
function rule<T>(label: MessageKey, pick: (r: SourceRules) => T, put: (r: SourceRules, value: T) => SourceRules): Pref {
  const read = () => get(RULES_KEY).then(parseSourceRules);
  const initial = pick(DEFAULT_RULES);
  return {
    label,
    keys: [RULES_KEY],
    initial,
    read: () => read().then(pick),
    reset: () => read().then((rules) => settings.set(RULES_KEY, parseSourceRules(put(rules, initial)))).then(rank),
  };
}
const field =
  <K extends keyof SourceRules>(k: K) =>
  (r: SourceRules) =>
    r[k];
const setField =
  <K extends keyof SourceRules>(k: K) =>
  (r: SourceRules, value: SourceRules[K]) => ({ ...r, [k]: value });
// "Prefer" chips and the multi-audio switch share one list.
const preferChips = (r: SourceRules) => r.prefer.filter((p) => p !== 'multi-audio');
const multiAudio = (r: SourceRules) => r.prefer.includes('multi-audio');

/** One of the profile's autoplay limits. */
const limit = (label: MessageKey, k: keyof AutoplayLimits): Pref => ({
  label,
  keys: [AUTOPLAY_LIMITS_PREFIX],
  initial: NO_AUTOPLAY_LIMITS[k],
  read: () => profileSetting(AUTOPLAY_LIMITS_PREFIX).then(({ value }) => parseAutoplayLimits(value)[k]),
  reset: () => profileSetting(AUTOPLAY_LIMITS_PREFIX).then(({ key, value }) => settings.set(key, { ...parseAutoplayLimits(value), [k]: NO_AUTOPLAY_LIMITS[k] })).then(rank),
});

/** A part of the player's layout, for "Changed" only: the layout resets as one (its row). */
const layoutPart = (label: MessageKey, k: keyof PlayerLayout): Pref => ({ label, keys: [PLAYER_LAYOUT_KEY], initial: DEFAULT_LAYOUT[k], read: () => loadPlayerLayout().then((l) => l[k]) });
const playerLayout: Pref = {
  label: 'playerlook.presets-label',
  keys: [PLAYER_LAYOUT_KEY],
  initial: DEFAULT_LAYOUT,
  read: loadPlayerLayout,
  reset: async () => {
    const next = { ...DEFAULT_LAYOUT };
    await settings.set(PLAYER_LAYOUT_KEY, next);
    layoutChanged(next);
  },
};

/** One part of how subtitles look (where they sit is set in the player, and left alone). */
const style = (label: MessageKey, k: keyof SubtitleStyle): Pref => ({
  label,
  keys: ['player.subtitles'],
  initial: DEFAULT_SUBTITLE_STYLE[k],
  read: () => subtitleStyle().then((s) => s[k]),
  reset: () => subtitleStyle().then((s) => saveSubtitleStyle({ ...s, [k]: DEFAULT_SUBTITLE_STYLE[k] })),
});

/** Home's layout options: shown as "Changed", but Home rows have their own Reset. */
const homeOption = (label: MessageKey, pick: (l: Awaited<ReturnType<typeof homeLayout>>) => boolean, initial: boolean): Pref => ({ label, keys: ['home.layout'], initial, read: () => homeLayout().then(pick) });

export const PREFS: Readonly<Record<string, readonly Pref[]>> = {
  general: [
    plain('pages.clock.label', CLOCK_KEY, 'system', parseClock, () => setClock('system')),
    plain('settings.general.open-to', GENERAL_SETTINGS.openTo, 'home', (v) => (v === 'library' ? 'library' : 'home')),
    plain('settings.general.window', GENERAL_SETTINGS.window, 'maximized', parseWindowMode),
    plain('settings.general.close', GENERAL_SETTINGS.close, 'quit', (v) => (v === 'tray' ? 'tray' : 'quit')),
    look('settings.appearance.scale', 'scale'),
    look('settings.appearance.motion', 'motion'),
    look('settings.appearance.effects', 'effects'),
    alerts('alerts.settings.enabled', 'enabled'),
    alerts('alerts.settings.toasts', 'toasts'),
    alerts('alerts.settings.scope', 'scope'),
    plain('movix.air.setting', AIR_TIMES_KEY, false, bool(false), loadAirTimesSetting),
  ],
  appearance: [
    look('settings.themes.tint', 'tint'),
    look('settings.appearance.glow', 'glow'),
    look('settings.appearance.hero', 'heroStyle'),
    look('settings.appearance.hero-overlap', 'heroOverlap'),
    look('settings.appearance.hero-count', 'heroCount'),
    look('showcase.setting.label', 'detailLayout'),
    look('settings.appearance.detail-background', 'detailBackground'),
    look('settings.library.logos', 'logos'),
    look('settings.appearance.quality-badges', 'qualityBadges'),
    look('settings.appearance.age-ratings', 'ageRatings'),
    look('settings.appearance.where-to-watch', 'whereToWatch'),
    look('settings.appearance.card-shape', 'rowStyle'),
    look('settings.appearance.poster-size-label', 'posterSize'),
    look('settings.appearance.corners', 'corners'),
    plain('settings.appearance.hover-info', HOVER_INFO_KEY, true, bool(true), () => setHoverInfo(true)),
    look('pages.cards.titles', 'cardTitles'),
    look('pages.cards.actions', 'cardActions'),
    // The RPDB key is a secret: Reset leaves it alone.
    look('posters.ratings', 'posterRatings'),
    look('posters.provider', 'posterProvider'),
    look('posters.rpdb.style', 'rpdbStyle'),
    fun('fun.settings.intro', 'intro'),
    fun('fun.settings.roulette', 'roulette'),
    fun('fun.settings.quips', 'quips'),
    fun('fun.settings.hints', 'hints'),
    fun('fun.settings.seasonal', 'seasonal'),
    ambient('ambient.settings.after', 'afterMinutes'),
    ambient('ambient.settings.source', 'source'),
    ambient('ambient.settings.clock', 'clock'),
    ambient('ambient.settings.paused', 'paused'),
    // Last: turning it off while a joke language is in use reloads the window (fun-settings.ts), cutting off any reset after it.
    fun('funlangs.setting', 'languages'),
  ],
  'home-library': [
    { ...plain('settings.library.anime', 'nav.anime', false, bool(false)), reset: () => setAnimeTabShown(false) },
    look('titles.settings.story-arcs', 'storyArcs'),
    { ...look('settings.library.watched-marks', 'watchedMarks'), reset: () => setAppearance({ watchedMarks: APPEARANCE_DEFAULTS.watchedMarks }).then(refreshWatchedMarks) },
    { label: 'settings.library.watched', keys: [WATCH_SETTINGS.watchedAt], initial: parseWatchedAt(undefined), read: async () => watchPrefs().watchedAt, reset: () => setWatchPrefs({ watchedAt: parseWatchedAt(undefined) }) },
    { label: 'settings.library.drop-off', keys: [WATCH_SETTINGS.continueDays], initial: parseContinueDays(undefined), read: async () => watchPrefs().continueDays, reset: () => setWatchPrefs({ continueDays: parseContinueDays(undefined) }) },
    spoiler('spoilers.titles', 'titles'),
    spoiler('spoilers.descriptions', 'descriptions'),
    spoiler('spoilers.thumbnails', 'thumbnails'),
    spoiler('spoilers.ratings', 'ratings'),
    spoiler('spoilers.unaired', 'unaired'),
    spoiler('spoilers.scope', 'scope'),
    homeOption('homerows.hero-next', (l) => !!l.heroNext, false),
    homeOption('homerows.greeting.label', (l) => l.greeting !== false, true),
    homeOption('homerows.tags.label', (l) => l.cardTags !== false, true),
  ],
  playback: [
    plain('settings.playback.play', PLAYBACK_SETTINGS.play, 'best', (v) => (v === 'choose' ? 'choose' : 'best')),
    plain('settings.playback.resume', PLAYBACK_SETTINGS.resume, 'always', (v) => (v === 'start-over' || v === 'ask' ? v : 'always')),
    perProfile('settings.playback.resume-source', RESUME_SOURCE_PREFIX, 'ask', parseResumeSourceMode),
    plain('settings.playback.autoplay', PLAYBACK_SETTINGS.autoplay, 'always', parseAutoplayMode),
    plain('watching.autoplay.limit', PLAYBACK_SETTINGS.autoplayLimit, parseAutoplayLimit(undefined), parseAutoplayLimit),
    plain('settings.playback.countdown', PLAYBACK_SETTINGS.countdown, countdownSeconds(undefined), countdownSeconds),
    plain('movix.next-up.when', PLAYBACK_SETTINGS.nextUpAt, parseNextUpAt(undefined), parseNextUpAt),
    // Saved with the mode: "When" resets both.
    { label: 'movix.next-up.amount', keys: [PLAYBACK_SETTINGS.nextUpAt], initial: parseNextUpAt(undefined).value, read: () => get(PLAYBACK_SETTINGS.nextUpAt).then((v) => parseNextUpAt(v).value) },
    plain('movix.next-up.style', PLAYBACK_SETTINGS.nextUpStyle, 'card', parseNextUpStyle),
    plain('settings.playback.same-source', PLAYBACK_SETTINGS.sameSource, true, bool(true)),
    plain('playerlook.end.setting', FILM_END_KEY, 'next', parseFilmEnd),
    skip('playerplus.settings.skip-intro', 'intro'),
    skip('playerplus.settings.skip-recap', 'recap'),
    skip('playerplus.settings.skip-credits', 'credits'),
    skip('playerplus.settings.skip-preview', 'preview'),
    plain('playerplus.settings.skip-delay', AUTO_SKIP_DELAY_KEY, 0, parseAutoSkipDelay),
    plain('movix.smooth', SMOOTH_SKIP_KEY, true, parseSmoothSkip),
    plain('movix.button-delay', SKIP_BUTTON_DELAY_KEY, 0, parseSkipButtonDelay),
    plain('movix.landing', SKIP_LANDING_KEY, 0, parseSkipLanding),
    band('movix.color-intro', 'intro'),
    band('movix.color-recap', 'recap'),
    band('movix.color-credits', 'credits'),
    band('movix.color-preview', 'preview'),
    plain('settings.playback.skip-lookup', PLAYBACK_SETTINGS.skipLookup, true, bool(true)),
    plain('movix.aniskip', ANISKIP_KEY, false, parseAniSkip),
    plain('playerplus.settings.learn-skips', LEARN_SKIPS_KEY, true, bool(true)),
    plain('settings.video.trailers', HERO_TRAILER_KEY, false, bool(false)),
    plain('settings.video.banner-trailers', BANNER_TRAILER_KEY, false, bool(false)),
    plain('settings.video.trailer-delay', TRAILER_DELAY_KEY, parseTrailerDelay(undefined), parseTrailerDelay),
    plain('settings.video.trailer-sound', TRAILER_SOUND_KEY, false, trailerSound),
  ],
  // How the player looks (the layout resets as one), then how it behaves.
  player: [
    playerLayout,
    layoutPart('playerlook.size', 'size'),
    layoutPart('playerlook.background', 'background'),
    layoutPart('playerlook.timeline', 'timeline'),
    layoutPart('playerlook.show-title', 'title'),
    layoutPart('playerlook.show-badges', 'badges'),
    layoutPart('playerlook.show-next', 'next'),
    layoutPart('playerlook.show-chapters', 'chapters'),
    layoutPart('playerlook.show-clock', 'clock'),
    plain('playerplus.settings.episodes', EPISODES_DOCKED_KEY, false, bool(false)),
    plain('settings.player.seek-step', SEEK_STEP_KEY, DEFAULT_SEEK_STEP, parseSeekStep),
    // The switch, and the preset picked in the player (per profile): Reset forgets the preset too, so turning the switch on gives 150% again.
    {
      label: 'settings.player.volume-boost',
      keys: [VOLUME_BOOST_KEY, VOLUME_BOOST_LEVEL_PREFIX],
      initial: false,
      read: () => get(VOLUME_BOOST_KEY).then(bool(false)),
      reset: () => Promise.all([settings.set(VOLUME_BOOST_KEY, false), profileSetting(VOLUME_BOOST_LEVEL_PREFIX).then(({ key }) => settings.set(key, null))]),
    },
    plain('playerplus.settings.hold-boost', HOLD_BOOST_KEY, true, bool(true)),
    plain('playerplus.settings.number-jump', NUMBER_JUMP_KEY, true, bool(true)),
    plain('pstream.settings.double-click', DOUBLE_CLICK_SEEK_KEY, false, bool(false)),
    plain('settings.playback.pause-minimized', PLAYBACK_SETTINGS.pauseOnMinimize, true, bool(true)),
    plain('settings.playback.keep-fullscreen', PLAYBACK_SETTINGS.keepFullscreen, false, bool(false)),
    plain('settings.playback.volume-popup', VOLUME_POPUP_KEY, false, bool(false)),
    plain('settings.playback.volume-popup-position', VOLUME_POPUP_POSITION_KEY, parseVolumePopupPosition(undefined), parseVolumePopupPosition),
    plain('playerplus.settings.grayscale', GRAYSCALE_PAUSE_KEY, false, bool(false)),
    plain('settings.video.previews', PREVIEWS_KEY, true, bool(true)),
    perProfile('settings.player.rewind', REWIND_CACHE_PREFIX, 'standard', parseRewindCache),
    // Rust checks and writes the external player's choice: shown as changed, never reset from here.
    { label: 'local.external.heading', keys: [EXTERNAL_KEY], initial: 'none', read: () => get(EXTERNAL_KEY).then((v) => parseExternal(v).kind) },
  ],
  subtitles: [
    plain('settings.subtitles.subtitle-language', LANGUAGE_SETTINGS.subtitle, '', parseLanguage),
    plain('settings.subtitles.forced', LANGUAGE_SETTINGS.forcedOnly, false, bool(false)),
    plain('settings.subtitles.auto-sync', AUTO_SYNC_KEY, false, bool(false)),
    plain('subs.settings.strip-sdh', STRIP_SDH_KEY, false, bool(false)),
    plain('subs.settings.keep-lyrics', SDH_KEEP_LYRICS_KEY, true, bool(true)),
    plain('playertools.caps.setting', FIX_CAPS_KEY, false, bool(false)),
    plain('subtrans.settings.enabled', AI_SUBS_ENABLED_KEY, false, bool(false)),
    style('subfonts.font', 'font'),
    style('settings.subtitles.size-label', 'size'),
    style('settings.subtitles.colour', 'color'),
    style('subs.style.opacity', 'opacity'),
    style('settings.subtitles.background', 'background'),
    style('subs.style.box-colour', 'backColor'),
    style('subs.style.box-opacity', 'backOpacity'),
    style('settings.subtitles.outline', 'outline'),
    style('subs.style.outline-colour', 'outlineColor'),
    style('settings.subtitles.bold', 'bold'),
  ],
  'picture-sound': [
    plain('settings.video.quality', PICTURE_QUALITY_KEY, parsePictureQuality(undefined), parsePictureQuality),
    {
      label: 'settings.video.picture',
      keys: [PICTURE_KEY, LEGACY_LOOK_KEY],
      initial: NEUTRAL,
      read: () => Promise.all([get(PICTURE_KEY), get(LEGACY_LOOK_KEY)]).then(([picture, legacy]) => parsePicture(picture, legacy)),
      reset: () => settings.set(PICTURE_KEY, { ...NEUTRAL }),
    },
    plain('settings.video.hwdec', HWDEC_KEY, 'auto', (v) => (v === 'off' ? 'off' : 'auto')),
    plain('settings.video.hdr', HDR_KEY, false, bool(false)),
    plain('settings.video.hdr-subtitles', HDR_SUBTITLES_KEY, true, bool(true)),
    perProfile('settings.video.smooth-motion', SMOOTH_MOTION_PREFIX, false, bool(false)),
    perProfile('audiodevice.title', AUDIO_DEVICE_PREFIX, AUTO_DEVICE, parseAudioDevice),
    plain('settings.subtitles.audio-language', LANGUAGE_SETTINGS.audio, 'en', parseAudioLanguage, rank),
    plain('prfixes.audio.original', LANGUAGE_SETTINGS.originalAudio, false, bool(false)),
    plain('settings.subtitles.normalize', AUDIO_NORMALIZE_KEY, false, bool(false)),
    plain('settings.subtitles.passthrough', PASSTHROUGH_KEY, parsePassthrough(undefined), parsePassthrough),
    plain('settings.subtitles.avoid', AVOID_TRACKS_KEY, DEFAULT_AVOID_WORDS, (v) => (typeof v === 'string' ? v : DEFAULT_AVOID_WORDS)),
  ],
  addons: [
    plain('settings.playback.quality', QUALITY_KEY, parseQuality(undefined), parseQuality, rank),
    plain('settings.playback.torrents', TORRENT_KEY, parseTorrentMode(undefined), parseTorrentMode, rank),
    plain('settings.playback.source-fails', PLAYBACK_SETTINGS.autoSwitch, true, bool(true)),
    rule('settings.playback.max-quality', field('maxQuality'), setField('maxQuality')),
    rule('settings.playback.max-size', field('maxSizeGB'), setField('maxSizeGB')),
    rule('sources.rules.min-size', field('minSizeGB'), setField('minSizeGB')),
    rule('settings.playback.multi-audio', multiAudio, (r, on) => ({ ...r, prefer: [...preferChips(r), ...(on ? (['multi-audio'] as const) : [])] })),
    rule('settings.playback.avoid', field('avoid'), setField('avoid')),
    rule('settings.playback.prefer', preferChips, (r, chips) => ({ ...r, prefer: [...chips, ...(multiAudio(r) ? (['multi-audio'] as const) : [])] })),
    rule('settings.playback.prefer-words', field('preferWords'), setField('preferWords')),
    rule('settings.playback.avoid-words', field('avoidWords'), setField('avoidWords')),
    limit('sources.limits.min-quality', 'minQuality'),
    limit('sources.limits.max-quality', 'maxQuality'),
    limit('sources.limits.max-size', 'maxSizeGB'),
  ],
  accounts: [
    discord('integrations.discord.hide-title', 'hideTitle'),
    discord('integrations.discord.poster', 'poster'),
    discord('integrations.discord.time', 'time'),
    discord('integrations.discord.while-paused', 'whilePaused'),
    discord('integrations.discord.while-browsing', 'whileBrowsing'),
    discord('integrations.discord.hide-limited', 'hideOnLimited'),
    plain('livetv.vod.sources', VOD_SOURCES_KEY, true, parseVodSources),
    plain('livetv.settings.open-on', LIVE_SETTINGS.openOn, 'all', parseOpenOn),
    plain('livetv.settings.resume', LIVE_SETTINGS.resumeLast, false, bool(false)),
  ],
  downloads: [
    plain('downloads.settings.quality', DOWNLOAD_QUALITY_KEY, parseMaxQuality(undefined), parseMaxQuality),
    plain('downloads.settings.keep-next', KEEP_COUNT_KEY, parseKeepCount(undefined), parseKeepCount),
    plain('downloads.schedule.speed', SPEED_LIMIT_KEY, parseSpeedLimit(undefined), parseSpeedLimit, schedule),
    plain('downloads.schedule.window', WINDOW_KEY, null, parseWindow, schedule),
  ],
};

/** What `pref` goes back to now (see `Pref.base`). */
const baseOf = (pref: Pref): Promise<unknown> => (pref.base ? pref.base().catch(() => pref.initial) : Promise.resolve(pref.initial));

/** Each of `prefs` read, and what it goes back to, in the same order. */
async function readAll(prefs: readonly Pref[]): Promise<{ values: unknown[]; bases: unknown[] }> {
  const [values, bases] = await Promise.all([Promise.all(prefs.map((pref) => pref.read().catch(() => pref.initial))), Promise.all(prefs.map(baseOf))]);
  return { values, bases };
}

/** The rows of `category` that differ from their defaults now. */
export async function changedRows(category: string): Promise<Set<MessageKey>> {
  const prefs = PREFS[category] ?? [];
  const { values, bases } = await readAll(prefs);
  return changedLabels(
    prefs.map((pref, i) => ({ label: pref.label, initial: bases[i] })),
    values,
  );
}

/** What "Reset this section" would change in `category`: its resettable rows that differ from their defaults. */
export async function resettable(category: string): Promise<Pref[]> {
  const prefs = (PREFS[category] ?? []).filter((pref) => pref.reset);
  const { values, bases } = await readAll(prefs);
  return prefs.filter((_, i) => isChanged(values[i], bases[i]));
}

/**
 * Puts `prefs` back to their defaults, one after another: several share one
 * saved object (the source rules, subtitle style), so each reads what the
 * one before wrote. Resolves to how many failed.
 */
export async function resetPrefs(prefs: readonly Pref[]): Promise<number> {
  let failed = 0;
  for (const pref of prefs) {
    try {
      await pref.reset?.();
    } catch (err) {
      console.error('Could not reset', pref.label, err);
      failed++;
    }
  }
  return failed;
}
