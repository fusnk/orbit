/**
 * What the command palette can find in Settings: every category, and the
 * rows and sections within them, by the same message keys the pages draw, so
 * labels match whatever language is on screen.
 *
 * A row or heading is found again on the page by its label; a section that
 * has its own class by that class. If it isn't drawn (yet), the jump still
 * opens the right category.
 *
 * It's also Settings' list of what the simple view folds away: an entry
 * marked `advanced` sits under its group's "More options" until opened (or
 * until "Show all settings" is on), see rooms/settings/fold.ts.
 *
 * What's edited only in Theme Studio (the colours, the seek bar, the menu's
 * pages) has a link row in Settings; its entry opens the Studio there
 * instead (`studio`).
 */
import { t, type MessageKey } from '../../i18n';
import { ACTION_IDS, firstKey, type ActionId } from '../../lib/keymap';
import { ACTION_LABELS } from '../../rooms/settings/shortcuts';
import { CATEGORIES, resolvePlace } from '../../rooms/settings/categories';
import type { StudioPlace } from '../../rooms/studio';
import { isAndroid } from '../../lib/platform';

export interface SettingsCategory {
  id: string;
  label: MessageKey;
  /** Other words people may type for it. */
  keywords: MessageKey;
}

export interface SettingsEntry {
  /** Stable, for remembering recent picks. */
  id: string;
  category: string;
  /** The category's tab it's on, for a category that has tabs. */
  tab?: string;
  label: MessageKey;
  /** The row's explanation, matched as keywords. */
  hint?: MessageKey;
  /** How to find it on the page: a `.setting-row` or `.settings-subheading` by its label, or a section by its class. */
  find: 'row' | 'heading' | `.${string}`;
  /** Folded under "More options" in the simple view. */
  advanced: boolean;
  /** Edited in Theme Studio: the palette opens it there rather than Settings. */
  studio?: StudioPlace;
}

/** In the Settings page's order (see rooms/settings/categories.ts). */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = CATEGORIES.map(({ id, label, keywords }) => ({ id, label, keywords }));

/** 'A': an advanced row (folded in the simple view); `studio`: where Theme Studio edits it. */
type Spec = [label: MessageKey, hint?: MessageKey | null, find?: SettingsEntry['find'] | null, advanced?: 'A' | null, studio?: StudioPlace];

/** By category, or `category/tab` for a tab's rows; within each, in the page's order. */
const SPECS: Record<string, Spec[]> = {
  // General folds with its own "More …" groups (rooms/settings/disclosure.ts), which the palette opens too, so nothing here is 'A'.
  general: [
    ['settings.general.open-to', 'settings.general.open-to-hint', '.open-to-section'],
    ['settingsgeneral.everyday', null, 'heading'],
    ['settings.general.language', 'settings.general.language-hint'],
    ['settings.general.close', 'settings.general.close-hint'],
    // Accessibility (from Appearance)
    ['settingsgeneral.accessibility', null, 'heading'],
    ['settings.appearance.scale', 'settings.appearance.scale-hint'],
    ['settings.appearance.motion', 'settings.appearance.motion-hint'],
    ['settings.appearance.effects', 'settings.appearance.effects-hint'],
    // Notifications (from Library)
    ['alerts.settings.enabled', 'alerts.settings.enabled-hint'],
    ['alerts.settings.toasts', 'alerts.settings.toasts-hint'],
    ['alerts.settings.scope', 'alerts.settings.scope-hint'],
    ['movix.air.setting', 'movix.air.setting-hint'],
    // More general settings
    ['pages.clock.label', 'pages.clock.hint'],
    ['settings.general.window', 'settings.general.window-hint'],
    ['remote.settings.enabled', 'remote.settings.enabled-hint'],
    ['connect.settings.enabled', 'connect.settings.enabled-hint'],
    // Backup & help (from Advanced and Library)
    ['settings.advanced.backup', 'settings.advanced.backup-hint'],
    ['settings.advanced.diagnostics', 'settings.advanced.diagnostics-hint', '.diagnostics-section'],
    ['onboard.settings.again', 'onboard.settings.again-hint'],
    ['integrations.import.heading', 'integrations.import.from-hint', '.import-section'],
    ['settings.general.profiles', 'settings.general.profiles-hint'],
    // The version, licences and updates (the update rows only show in builds that update themselves).
    ['settingshome.about.heading', 'settingshome.updates.label', '.about-section'],
  ],
  appearance: [
    ['looks.heading', 'looks.hint', 'heading'],
    ['looks.name.orbit', 'looks.orbit-hint', '.looks-section'],
    ['looks.name.crimson', 'looks.crimson-hint', '.looks-section'],
    ['looks.name.marquee', 'lookstyles.marquee-hint', '.looks-section'],
    ['looks.name.premiere', 'lookstyles.premiere-hint', '.looks-section'],
    ['looks.name.glass', 'lookstyles.glass-hint', '.looks-section'],
    ['looks.name.aurora', 'lookstyles.aurora-hint', '.looks-section'],
    ['looks.name.couch', 'lookstyles.couch-hint', '.looks-section'],
    ['looks.name.afterglow', 'lookstyles.afterglow-hint', '.looks-section'],
    ['looks.name.arc', 'orbitlook.look-hint', '.looks-section'],
    ['looks.restore', 'lookstyles.restore-hint', '.looks-restore'],
    ['studio.title', 'studio.open-hint'],
    ['settings.themes.theme', 'settings.themes.theme-hint'],
    ['studio.colours', 'settings.themes.theme-hint', null, null, 'colours'],
    ['settings.themes.yours', 'settings.themes.yours-hint', '.my-themes', 'A'],
    ['settings.accent.accent', 'settings.accent.hint'],
    ['playercolour.label', 'playercolour.hint'],
    ['settings.themes.tint', 'settings.themes.tint-hint', null, 'A'],
    ['settings.themes.fonts', 'settings.themes.fonts-hint', null, 'A'],
    ['studio.layout.position', 'studio.layout.style-hint'],
    ['studio.layout.place', 'studio.layout.place-hint', null, 'A'],
    ['settings.appearance.menu-pages', 'settings.appearance.menu-pages-hint', null, null, 'layout'],
    ['settings.appearance.glow', 'settings.appearance.glow-hint', null, 'A'],
    ['settings.appearance.hero', 'settings.appearance.hero-hint'],
    ['settings.appearance.hero-overlap', 'settings.appearance.hero-overlap-hint'],
    ['settings.appearance.hero-count', 'settings.appearance.hero-count-hint', null, 'A'],
    ['settings.appearance.wallpaper', 'settings.appearance.wallpaper-hint'],
    ['showcase.setting.label', 'showcase.setting.hint'],
    ['settings.appearance.detail-background', 'settings.appearance.detail-background-hint', null, 'A'],
    ['settings.library.logos', 'settings.library.logos-hint'],
    ['settings.appearance.quality-badges', 'settings.appearance.quality-badges-hint', null, 'A'],
    ['settings.appearance.age-ratings', 'settings.appearance.age-ratings-hint', null, 'A'],
    ['settings.appearance.where-to-watch', 'settings.appearance.where-to-watch-hint', null, 'A'],
    ['settings.appearance.posters', 'settings.appearance.poster-size-hint', 'heading'],
    ['settings.appearance.card-shape', 'settings.appearance.card-shape-hint'],
    ['settings.appearance.corners', 'settings.appearance.corners-hint', null, 'A'],
    ['settings.appearance.hover-info', 'settings.appearance.hover-info-hint'],
    ['pages.cards.titles', 'pages.cards.titles-hint'],
    ['pages.cards.actions', 'pages.cards.actions-hint'],
    ['posters.ratings', 'posters.ratings-hint'],
    ['posters.provider', 'posters.provider-hint'],
    ['posters.rpdb.style', 'posters.rpdb.style-hint'],
    ['fun.settings.heading', null, 'heading'],
    ['fun.settings.intro', 'fun.settings.intro-hint', null, 'A'],
    ['fun.settings.roulette', 'fun.settings.roulette-hint', null, 'A'],
    ['fun.settings.quips', 'fun.settings.quips-hint', null, 'A'],
    ['fun.settings.hints', 'fun.settings.hints-hint', null, 'A'],
    ['fun.settings.seasonal', 'fun.settings.seasonal-hint', null, 'A'],
    ['funlangs.setting', 'funlangs.setting-hint', null, 'A'],
    ['ambient.settings.after', 'ambient.settings.after-hint'],
    ['ambient.settings.source', 'ambient.settings.source-hint', null, 'A'],
    ['ambient.settings.clock', 'ambient.settings.clock-hint', null, 'A'],
    ['ambient.settings.paused', 'ambient.settings.paused-hint', null, 'A'],
    ['ambient.settings.preview-label', 'ambient.settings.preview-hint', null, 'A'],
  ],
  'home-library': [
    ['settingslayout.chapter.library', null, 'heading'],
    ['settings.library.anime', 'settings.library.anime-hint'],
    ['titles.settings.story-arcs', 'titles.settings.story-arcs-hint', null, 'A'],
    ['settings.library.watched-marks', 'settings.library.watched-marks-hint'],
    ['settings.library.continue-heading', null, 'heading'],
    ['settings.library.watched', 'settings.library.watched-hint', null, 'A'],
    ['settings.library.drop-off', 'settings.library.drop-off-hint'],
    ['spoilers.heading', 'spoilers.intro', 'heading'],
    ['spoilers.titles', 'spoilers.titles-hint', null, 'A'],
    ['spoilers.descriptions', 'spoilers.descriptions-hint'],
    ['spoilers.thumbnails', 'spoilers.thumbnails-hint'],
    ['spoilers.ratings', 'spoilers.ratings-hint', null, 'A'],
    ['spoilers.unaired', 'spoilers.unaired-hint', null, 'A'],
    ['spoilers.scope', 'spoilers.scope-hint', null, 'A'],
    ['settings.library.home-rows', null, '.home-rows-section'],
    ['homerows.preset.dashboard', 'homerows.preset.dashboard-hint', null, 'A'],
    ['homerows.hero-next', 'homerows.hero-next-hint', null, 'A'],
    ['homerows.greeting.label', 'homerows.greeting.hint', null, 'A'],
    ['homerows.tags.label', 'homerows.tags.hint', null, 'A'],
  ],
  playback: [
    ['settingslayout.chapter.starting', null, 'heading'],
    ['settings.playback.play', 'settings.playback.play-hint'],
    ['settings.playback.resume', 'settings.playback.resume-hint'],
    ['settings.playback.resume-source', 'settings.playback.resume-source-hint', null, 'A'],
    ['settings.playback.next-heading', null, 'heading'],
    ['settings.playback.autoplay', 'watching.autoplay.hint'],
    ['watching.autoplay.limit', 'watching.autoplay.limit-hint', null, 'A'],
    ['settings.playback.countdown', 'settings.playback.countdown-hint', null, 'A'],
    ['movix.next-up.when', 'movix.next-up.when-hint', null, 'A'],
    ['movix.next-up.amount', 'movix.next-up.amount-hint', null, 'A'],
    ['movix.next-up.style', 'movix.next-up.style-hint', null, 'A'],
    ['settings.playback.same-source', 'settings.playback.same-source-hint', null, 'A'],
    ['playerlook.end.setting', 'playerlook.end.setting-hint'],
    ['playerplus.settings.skipping', 'playerplus.settings.skipping-hint', 'heading'],
    ['playerplus.settings.skip-intro'],
    ['playerplus.settings.skip-recap', null, null, 'A'],
    ['playerplus.settings.skip-credits'],
    ['playerplus.settings.skip-preview', null, null, 'A'],
    ['playerplus.settings.skip-delay', 'playerplus.settings.skip-delay-hint', null, 'A'],
    ['movix.smooth', 'movix.smooth-hint'],
    ['settingslayout.chapter.skip-tuning', null, 'heading'],
    ['movix.button-delay', 'movix.button-delay-hint', null, 'A'],
    ['movix.landing', 'movix.landing-hint', null, 'A'],
    ['movix.color-intro', 'movix.colors-hint', null, 'A'],
    ['movix.color-recap', null, null, 'A'],
    ['movix.color-credits', null, null, 'A'],
    ['movix.color-preview', null, null, 'A'],
    ['settings.playback.skip-lookup', 'settings.playback.skip-lookup-hint', null, 'A'],
    ['movix.aniskip', 'movix.aniskip-hint', null, 'A'],
    ['playerplus.settings.learn-skips', 'playerplus.settings.learn-skips-hint', null, 'A'],
    ['playerplus.settings.forget-skips', 'playerplus.settings.forget-skips-hint', null, 'A'],
    ['settings.playback.trailers-heading', null, 'heading'],
    ['settings.video.trailers', 'settings.video.trailers-hint'],
    ['settings.video.banner-trailers', 'settings.video.banner-trailers-hint', null, 'A'],
    ['settings.video.trailer-delay', 'settings.video.trailer-delay-hint', null, 'A'],
    ['settings.video.trailer-sound', 'settings.video.trailer-sound-hint'],
  ],
  // How the player looks, then how it behaves (both were under Appearance and Playback).
  player: [
    ['settingslayout.chapter.player-look', null, 'heading'],
    ['playerlook.layout', 'playerlook.layout-hint'],
    ['playerlook.size', 'playerlook.size-hint'],
    ['playerlook.background', 'playerlook.background-hint', null, 'A'],
    ['playerlook.timeline', 'playerlook.timeline-hint', null, 'A'],
    ['playerlook.show-title', 'playerlook.show-title-hint', null, 'A'],
    ['playerlook.show-badges', 'playerlook.show-badges-hint', null, 'A'],
    ['playerlook.show-next', 'playerlook.show-next-hint', null, 'A'],
    ['playerlook.show-chapters', 'playerlook.show-chapters-hint', null, 'A'],
    ['playerlook.show-clock', 'playerlook.show-clock-hint'],
    ['playerplus.settings.episodes', 'playerplus.settings.episodes-hint', null, 'A'],
    ['studio.seek.heading', 'settings.appearance.seekbar-hint', null, null, 'seekbar'],
    ['playercolour.seek-label', 'playercolour.hint'],
    ['settingslayout.chapter.player-controls', null, 'heading'],
    ['settings.player.seek-step', 'settings.player.seek-step-hint'],
    ['settings.player.volume-boost', 'settings.player.volume-boost-hint', null, 'A'],
    ['playerplus.settings.hold-boost', 'playerplus.settings.hold-boost-hint', null, 'A'],
    ['playerplus.settings.number-jump', 'playerplus.settings.number-jump-hint', null, 'A'],
    ['pstream.settings.double-click', 'pstream.settings.double-click-hint', null, 'A'],
    ['settings.playback.volume-popup', 'settings.playback.volume-popup-hint', null, 'A'],
    ['settings.playback.volume-popup-position', 'settings.playback.volume-popup-position-hint', null, 'A'],
    ['settingslayout.chapter.player-window', null, 'heading'],
    ['settings.playback.pause-minimized', 'settings.playback.pause-minimized-hint', null, 'A'],
    ['settings.playback.keep-fullscreen', 'settings.playback.keep-fullscreen-hint', null, 'A'],
    ['playerplus.settings.grayscale', 'playerplus.settings.grayscale-hint', null, 'A'],
    ['settings.video.previews', 'settings.video.previews-hint', null, 'A'],
    ['settings.player.rewind', 'settings.player.rewind-hint', null, 'A'],
    ['local.external.heading', 'local.external.player-hint', '.external-player-section', 'A'],
  ],
  subtitles: [
    ['settingslayout.chapter.subtitle-text', null, 'heading'],
    ['settings.subtitles.subtitle-language', 'settings.subtitles.subtitle-language-hint'],
    ['settings.subtitles.forced', 'settings.subtitles.forced-hint', null, 'A'],
    ['settings.subtitles.auto-sync', 'settings.subtitles.auto-sync-hint', null, 'A'],
    ['subs.settings.strip-sdh', 'subs.settings.strip-sdh-hint'],
    ['subs.settings.keep-lyrics', 'subs.settings.keep-lyrics-hint', null, 'A'],
    ['playertools.caps.setting', 'playertools.caps.hint', null, 'A'],
    ['subtrans.settings.heading', 'subtrans.settings.intro', 'heading'],
    ['subtrans.settings.enabled', 'subtrans.settings.enabled-hint'],
    ['settings.subtitles.style-heading', 'settings.subtitles.style-intro', 'heading'],
    ['subfonts.preview', 'subfonts.preview-hint'],
    ['subfonts.font', 'subfonts.font-hint'],
    ['settings.subtitles.size-label'],
    ['settings.subtitles.colour'],
    ['subs.style.opacity', null, null, 'A'],
    ['settings.subtitles.background', 'settings.subtitles.background-hint'],
    ['subs.style.box-colour', null, null, 'A'],
    ['subs.style.box-opacity', 'subs.style.box-opacity-hint', null, 'A'],
    ['settings.subtitles.outline', null, null, 'A'],
    ['subs.style.outline-colour', null, null, 'A'],
    ['settings.subtitles.bold', null, null, 'A'],
  ],
  'picture-sound': [
    ['settings.video.quality', 'settings.video.quality-hint'],
    ['settings.video.picture', 'settings.video.picture-hint', null, 'A'],
    ['settings.video.hwdec', 'settings.video.hwdec-hint', null, 'A'],
    ['settings.video.hdr', 'settings.video.hdr-hint', null, 'A'],
    ['settings.video.hdr-subtitles', 'settings.video.hdr-subtitles-hint', null, 'A'],
    ['settings.video.smooth-motion', 'settings.video.smooth-motion-hint', null, 'A'],
    ['settings.subtitles.audio-heading', null, 'heading'],
    ['audiodevice.title', 'audiodevice.hint'],
    ['settings.subtitles.audio-language', 'settings.subtitles.audio-language-hint'],
    ['prfixes.audio.original', 'prfixes.audio.original-hint'],
    ['settings.subtitles.normalize', 'settings.subtitles.normalize-hint'],
    ['settings.subtitles.passthrough', 'settings.subtitles.passthrough-hint', null, 'A'],
    ['settings.subtitles.avoid', 'settings.subtitles.avoid-hint', null, 'A'],
  ],
  // Installing, the store and updates are palette actions (they press the page's own buttons).
  'addons/sources': [
    ['settingslayout.chapter.choosing-source', null, 'heading'],
    ['settings.playback.quality', 'settings.playback.quality-hint'],
    ['settings.playback.torrents', 'settings.playback.torrents-hint'],
    ['settings.playback.source-fails', 'settings.playback.source-fails-hint', null, 'A'],
    ['settingslayout.chapter.ranking-rules', null, 'heading'],
    ['settings.playback.max-quality', 'settings.playback.max-quality-hint', null, 'A'],
    ['settings.playback.max-size', 'settings.playback.max-size-hint', null, 'A'],
    ['sources.rules.min-size', 'sources.rules.min-size-hint', null, 'A'],
    ['settings.playback.multi-audio', 'settings.playback.multi-audio-hint', null, 'A'],
    ['settings.playback.avoid', 'settings.playback.avoid-hint', null, 'A'],
    ['settings.playback.prefer', 'settings.playback.prefer-hint', null, 'A'],
    ['settings.playback.prefer-words', 'settings.playback.prefer-words-hint', null, 'A'],
    ['settings.playback.avoid-words', 'settings.playback.avoid-words-hint', null, 'A'],
    ['sources.limits.heading', null, 'heading'],
    ['sources.limits.min-quality', 'sources.limits.min-quality-hint', null, 'A'],
    ['sources.limits.max-quality', 'sources.limits.max-quality-hint', null, 'A'],
    ['sources.limits.max-size', 'sources.limits.max-size-hint', null, 'A'],
  ],
  accounts: [
    ['integrations.providers.heading', null, 'heading'],
    // Its row is labelled plain "TMDB" (a name, not a message), so it's found by its class.
    ['integrations.tmdb.field-label', 'integrations.tmdb.hint', '.tmdb-row'],
    ['integrations.streaming.heading', 'integrations.streaming.country-hint', '.streaming-section'],
    ['integrations.stremio.account', 'integrations.stremio.account-hint', '.stremio-section'],
    ['integrations.stremio.sync', 'integrations.stremio.sync-hint'],
    ['integrations.anilist.account', 'integrations.anilist.hint', '.anilist-section'],
    // Both labelled "Server": their intros carry the names people type (Jellyfin, Plex).
    ['jellyfin.settings.server-label', 'jellyfin.settings.intro', '.jellyfin-section'],
    ['plex.settings.server-label', 'plex.settings.intro', '.plex-section'],
    ['cloud.settings.heading', 'cloud.settings.intro', '.debrid-section'],
    ['integrations.letterboxd.profile', 'integrations.letterboxd.profile-hint', '.letterboxd-section'],
    ['integrations.discord.show', 'integrations.discord.show-hint', '.discord-section'],
    ['integrations.discord.hide-title', 'integrations.discord.hide-title-hint', null, 'A'],
    ['integrations.discord.poster', 'integrations.discord.poster-hint', null, 'A'],
    ['integrations.discord.time', 'integrations.discord.time-hint', null, 'A'],
    ['integrations.discord.while-paused', 'integrations.discord.while-paused-hint', null, 'A'],
    ['integrations.discord.while-browsing', 'integrations.discord.while-browsing-hint', null, 'A'],
    ['integrations.discord.hide-limited', 'integrations.discord.hide-limited-hint', null, 'A'],
    // Live TV sources (was its own category; moved as a block)
    ['settings.nav.livetv', 'integrations.live-tv.intro', '.live-tv-section'],
    ['livetv.vod.sources', 'livetv.vod.sources-hint', null, 'A'],
    ['livetv.settings.open-on', 'livetv.settings.open-on-hint', null, 'A'],
    ['livetv.settings.resume', 'livetv.settings.resume-hint', null, 'A'],
    ['integrations.live-tv.add-heading', null, 'heading'],
  ],
  downloads: [
    ['downloads.settings.folder', 'downloads.settings.folder-hint'],
    ['downloads.settings.quality', 'downloads.settings.quality-hint'],
    ['downloads.settings.keep-next', 'downloads.settings.keep-next-hint', null, 'A'],
    ['downloads.schedule.speed', 'downloads.schedule.speed-hint', null, 'A'],
    ['downloads.schedule.window', 'downloads.schedule.window-hint', null, 'A'],
    ['downloads.settings.storage', 'downloads.settings.storage-hint'],
  ],
  shortcuts: [['settings.shortcuts.fixed', 'settings.shortcuts.fixed-hint', 'heading']],
};

/** Rows Android doesn't show (general.ts, settings/index.ts, integrations.ts, subtitles.ts): the window's, Discord's, external players' and the sound output. */
const ANDROID_HIDDEN = /^(settings\.general\.(window|close)|integrations\.discord\.|local\.external\.|settings\.player\.rewind|audiodevice\.)/;

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = Object.entries(SPECS)
  .flatMap(([where, specs]) => {
    const [category, tab] = where.split('/') as [string, string | undefined];
    return specs.map(([label, hint, find, advanced, studio]) => ({ id: `${category}/${label}`, category, ...(tab ? { tab } : {}), label, ...(hint ? { hint } : {}), find: find ?? 'row', advanced: advanced === 'A', ...(studio ? { studio } : {}) }));
  })
  // Only what this platform's Settings shows.
  .filter((entry) => SETTINGS_CATEGORIES.some((c) => c.id === entry.category) && !(isAndroid && ANDROID_HIDDEN.test(entry.label)));

/** The rows `category` folds in its simple view. */
export const advancedEntries = (category: string): SettingsEntry[] => SETTINGS_ENTRIES.filter((e) => e.category === category && e.advanced);

/**
 * Where a remembered palette pick is now: `category` or `category/label`, saved
 * maybe before the categories were regrouped. A row keeps its label key
 * wherever it moved; an old category id leads to where it went. Null if
 * it's gone.
 */
export function currentSettingId(id: string): string | null {
  const slash = id.indexOf('/');
  if (slash < 0) return SETTINGS_CATEGORIES.some((c) => c.id === id) ? id : (resolvePlace(id)?.category ?? null);
  if (SETTINGS_ENTRIES.some((e) => e.id === id)) return id;
  const label = id.slice(slash + 1);
  return SETTINGS_ENTRIES.find((e) => e.label === label)?.id ?? null;
}

// ── Keyboard shortcuts ──

/** Palette items that are an app shortcut's own action (Search, Settings, the shortcut list): they show its key. */
export const SHORTCUT_ITEMS = { 'page:search': 'app.search', 'page:settings': 'app.settings', 'action:shortcuts': 'app.shortcuts' } as const satisfies Record<string, ActionId>;

const OWN_ITEM = new Set<ActionId>([...Object.values(SHORTCUT_ITEMS), 'app.palette']);

/**
 * Every other shortcut (the player's, saving a card), found by its action's name. They only work
 * in the player or on a focused card, so the palette opens their row in Settings → Shortcuts.
 */
export const SHORTCUT_ENTRIES: readonly { id: ActionId; label: MessageKey }[] = ACTION_IDS.filter((id) => !OWN_ITEM.has(id)).map((id) => ({ id, label: ACTION_LABELS[id] }));

/** "Shortcut · K": the action's key as it's mapped now. */
export const shortcutDetail = (id: ActionId): string => t('palette.kind.shortcut', { key: firstKey(id) ?? t('settings.shortcuts.not-set') });
