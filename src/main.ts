// First: catches errors from everything below (see app/errors.ts).
import './app/boot-guard';
import '@fontsource-variable/manrope';
import '@fontsource/bebas-neue';
import '@fontsource-variable/jetbrains-mono';
import './theme/tokens.css';
import './styles.css';
import { ensureBuiltins, refreshManifestsDaily } from './addons/registry';
import { loadActivitySetting, showActivity } from './app/activity';
import { TV_SOURCES_CHANGED, tvSources } from './live/iptv';
import { androidBack, installBackHandling } from './app/back';
import { reportError, startupError } from './app/errors';
import { settleWithin } from './lib/timeout';
import { installLocalDrop } from './app/local-drop';
import { installPalette, togglePalette } from './app/palette';
import { ANIME_TAB_CHANGED, animeTabShown } from './app/anime-tab';
import { createNav } from './app/nav';
import { createOfflineBanner } from './app/offline';
import { createUpdateBanner } from './app/updates';
import { createRouter } from './app/router';
import { installSpatialNav } from './app/spatial';
import { appShortcut } from './app/app-shortcuts';
import { installGamepad } from './app/gamepad';
import { installWindowActivity } from './app/window-activity';
import { installQuit } from './app/quit';
import { startRemoteBridge } from './app/remote';
import { startConnectBridge } from './app/connect';
import { startDeepLinks } from './app/deep-link';
import { createTitlebar } from './app/titlebar';
import { createAlertsBell } from './app/alerts-bell';
import { createHistoryChip, openQuickSettings } from './app/quick-settings';
import { loadHistoryPause } from './library/history-pause';
import { loadAlerts, startAlerts } from './library/alerts';
import { loadAirTimesSetting } from './catalog/air-times';
import { startReminders } from './library/reminders';
import { loadLibrary } from './library/library';
import { loadLists } from './library/lists';
import { loadRatings } from './library/ratings';
import { loadFavouriteEpisodes } from './library/favourite-episodes';
import { loadCollections } from './library/collections';
import { allDownloads, downloadsLoadError, loadDownloads, onDownloadsChange } from './library/downloads';
import { activeProfileId, FIRST_PROFILE, listProfiles, startProfile } from './library/profiles';
import { avatar, openProfileSwitcher, pickProfileAtStart } from './rooms/profiles/picker';
import { startContentLimit } from './rooms/profiles/parental';
import { liveTvAllowed, loadContentLimit } from './catalog/parental';
import { startStremioSync } from './library/stremio-sync';
import { startAniListSync } from './library/anilist';
import { loadWatch, refreshNewEpisodes, watchRecord } from './library/watch';
import { installWatchNext } from './library/watch-next';
import { h } from './lib/dom';
import { isAndroid, isMac } from './lib/platform';
import { settings } from './lib/ipc';
import { loadKeymap } from './lib/keymap';
import { navRooms, rooms } from './rooms';
import { searchNextFor } from './rooms/search';
import { playerOpen, syncPlayer } from './rooms/player';
import { loadRankingPrefs } from './rooms/detail/ranking-prefs';
import { titleHandlers } from './rooms/detail/open';
import { openTonight } from './rooms/tonight';
import { installAmbient } from './rooms/ambient';
import { startAutoDownloads } from './rooms/downloads/auto';
import { openSettingsTo } from './rooms/settings';
import { GENERAL_SETTINGS } from './rooms/settings/general';
import { ACTION_LABELS } from './rooms/settings/shortcuts';
import { saveFocusedCard } from './components/card-actions';
import { loadClock } from './lib/clock';
import { invoke } from '@tauri-apps/api/core';
import { RETURN_TO_KEY, syncLanguage, t, tmdbLanguage } from './i18n';
import { appearance, loadAppearance, startAutoEffects } from './theme/appearance';
import { loadRpdb } from './catalog/rpdb';
import { loadSpoilers } from './library/spoilers';
import { setAmbientHue } from './theme/ambient';
import { loadTheme, startCssSafeMode } from './theme/engine';
import { startGlassSheen } from './theme/glass';
import { toast } from './components/toast';
import { startTvMode } from './theme/looks';
import { loadFun } from './app/fun-settings';
import { playLaunchIntro } from './app/launch-intro';
import { installSeasonal } from './app/seasonal';
import { startOnboardingIfNew } from './app/onboarding/flow';
import { FIRST_PROFILE_NAMED } from './app/onboarding/state';
import { setupOpen } from './app/onboarding/gate';
import { shiftHoldWatcher } from './app/safe-mode-key';
import { setScrollRoot } from './lib/near-view';

const root = document.getElementById('app');
if (!root) throw new Error('#app element missing');
performance.mark('orbit-main');

/**
 * Everything awaited before the first page is local (settings, history), but
 * none of it may hold the window blank: each step gets a time limit, and a
 * step that fails or runs late falls back to defaults (a late answer still
 * applies when it comes). Failures go to the log file.
 */
const STEP_MS = 4000;
const step = <T, F>(name: string, work: Promise<T>, fallback: F): Promise<T | F> =>
  settleWithin(work, STEP_MS, fallback, (err) => reportError(`Startup: ${name}`, err, 'warn'));

/**
 * Safe mode: Shift held on its own for a second while Orbit starts (see safe-mode-key.ts) turns
 * custom CSS off for the session, the way back from a theme whose CSS hides the app. It only
 * acts when custom CSS is showing.
 */
const SAFE_MODE_MS = 5000;
const theme = loadTheme();
// Missing or unreadable appearance settings fall back to defaults; they shouldn't block startup.
const startup = Promise.all([
  step('language', syncLanguage(), undefined),
  step('theme', theme, undefined),
  // Whether an RPDB key is saved: a keychain read, only when RPDB is the poster provider.
  step('appearance', loadAppearance().then(() => (appearance().posterProvider === 'rpdb' ? loadRpdb() : undefined)), undefined),
  step('shortcuts', loadKeymap(), { reset: [], keyless: [] }),
  step('little extras', loadFun(), undefined),
  step('clock', loadClock(), undefined),
]);
const watchShift = shiftHoldWatcher(() => {
  stopWatchingShift();
  // Once the language is known (for the toast) and the theme's CSS is on screen to take off,
  // even when the theme step gave up waiting before it was.
  void Promise.all([startup, theme.catch(() => {})]).then(() => {
    if (startCssSafeMode()) toast(t('settings.theme.safe-mode'));
  });
});
function stopWatchingShift(): void {
  window.removeEventListener('keydown', watchShift, true);
  window.removeEventListener('keyup', watchShift, true);
}
window.addEventListener('keydown', watchShift, true);
window.addEventListener('keyup', watchShift, true);

const [, , , keysReset] = await startup;
performance.mark('orbit-appearance');
// Shortcuts on keys now kept for editing text and menus went back to their defaults (lib/keymap.ts).
const actionNames = (ids: readonly (keyof typeof ACTION_LABELS)[]) => ids.map((id) => t(ACTION_LABELS[id])).join(', ');
if (keysReset.reset.length) toast(t('settings.shortcuts.reset-reserved', { actions: actionNames(keysReset.reset) }));
if (keysReset.keyless.length) toast(t('settings.shortcuts.reset-keyless', { actions: actionNames(keysReset.keyless) }));
window.setTimeout(stopWatchingShift, SAFE_MODE_MS);
// After the theme, which places the menu: TV mode (Couch) follows the menu and the player's layout.
void step('TV mode', startTvMode(), undefined);

// The launch ident plays over whatever startup draws next; nothing waits for it.
playLaunchIntro(playerOpen);

// TMDB rows, title pages and cast in the interface's language, where TMDB has it.
void invoke('tmdb_set_language', { tag: tmdbLanguage() }).catch((err: unknown) => console.warn('Could not set the TMDB language', err));
// The tray's menu ("Minimize to tray") too: Rust builds it before the language is known.
void invoke('tray_labels', { show: t('settings.general.tray-show'), quit: t('settings.general.close-quit') }).catch((err: unknown) => console.warn('Could not name the tray menu', err));

// Before "Who's watching?", so arrow keys and a controller's D-pad work there too.
installSpatialNav();
installGamepad();
// Background windows hold their looping decoration still (app/window-activity.ts).
installWindowActivity();

// Library, history and addons belong to a profile, so one is chosen first:
// automatically with a single unlocked profile, otherwise "Who's watching?".
// If profiles can't be read, "Who's watching?" is where that shows (Orbit
// can't do anything without a profile).
if ((await step('profiles', startProfile(), 'choose' as const)) === 'choose') {
  performance.mark('orbit-picker');
  try {
    await pickProfileAtStart(root);
  } catch (err) {
    reportError('Startup: Who’s watching', err);
    root.replaceChildren(startupError());
    // Nothing more can start; "Try again" reloads the window.
    await new Promise<never>(() => {});
  }
}
performance.mark('orbit-profile');
// Read beside the profile's data (each is its own local read), rather than one after the other.
const profileButtonLoad = step('profile button', createProfileButton(), undefined);
const openToLoad = step('open to', settings.get(GENERAL_SETTINGS.openTo), null);

await Promise.all([
  step('library', loadLibrary(), undefined),
  // The profile's content limit, before any title is drawn.
  step('content limit', startContentLimit(), undefined),
  step('watch history', loadWatch(), undefined),
  step('history pause', loadHistoryPause(), undefined),
  step('spoilers', loadSpoilers(), undefined),
  step('lists', loadLists(), undefined),
  step('ratings', loadRatings(), undefined),
  step('favourite episodes', loadFavouriteEpisodes(), undefined),
  step('collections', loadCollections(), undefined),
  step('downloads', loadDownloads(), undefined),
  step('source preferences', loadRankingPrefs(), undefined),
  step('Discord setting', loadActivitySetting(), undefined),
  step('new-episode alerts', loadAlerts(), undefined),
  step('air times setting', loadAirTimesSetting(), undefined),
]);
performance.mark('orbit-data');
const profileButton = await profileButtonLoad;

const outlet = h('main', { class: 'outlet' });
setScrollRoot(outlet);
outlet.addEventListener('scroll', () => outlet.classList.toggle('scrolled', outlet.scrollTop > 4), { passive: true });
const nav = createNav(navRooms, (id) => router.go(id));
const titlebar = createTitlebar({
  nav: nav.element,
  onBack: () => router.back(),
  onHome: () => router.goTop('home'),
  onSettings: (anchor) => quickSettings(anchor),
  profile: profileButton,
  historyChip: createHistoryChip((anchor) => quickSettings(anchor)),
  bell: createAlertsBell(() => router.ctx),
});
function quickSettings(anchor: HTMLElement): void {
  openQuickSettings(
    anchor,
    () => {
      router.go('settings');
      // Into the page, on the category it shows, rather than left on the title bar's button.
      document.querySelector<HTMLElement>('.outlet .settings-nav-item[aria-current="true"]')?.focus({ preventScroll: true });
    },
    () => {
      router.go('addons');
      // Into the page, on the tab it shows.
      document.querySelector<HTMLElement>('.outlet .addons-page .addons-tabs .segment[aria-selected="true"]')?.focus({ preventScroll: true });
    },
    () => openTonight(router.ctx),
    () => {
      // Its pairing code, in Settings → General.
      openSettingsTo('general', '.remote-section');
      router.go('settings');
    },
    () => {
      // Orbit Connect's devices and pairing code, in Settings → General.
      openSettingsTo('general', '.connect-section');
      router.go('settings');
    },
  );
}
let currentRoom = '';
const router = createRouter(rooms, outlet, (state) => {
  currentRoom = state.room;
  nav.setActive(state.room);
  titlebar.update(state);
  syncPlayer(state.view);
  showActivity(state.room, state.view);
  // The artwork's tint belongs to the view that set it: a view without art (Settings, Library…) clears it.
  const hue = Number(state.view.dataset.hue);
  setAmbientHue(state.view.dataset.hue && Number.isFinite(hue) ? hue : null);
});

// The Anime tab is optional; it starts hidden so it never flashes in.
function showAnimeTab(on: boolean): void {
  nav.setHidden('anime', !on);
  if (!on && currentRoom === 'anime') router.go('home');
}
showAnimeTab(false);

// Live TV shows once the profile has an IPTV source (Settings → Live TV).
async function showLiveTab(): Promise<void> {
  // A profile's content limit can turn Live TV off.
  const has = (await loadContentLimit().then(liveTvAllowed)) && (await tvSources().catch(() => [])).length > 0;
  nav.setHidden('live', !has);
  if (!has && currentRoom === 'live') router.go('home');
}
nav.setHidden('live', true);

// Downloads shows once the profile has a download.
// Downloads that couldn't be read keep the page, which says so and offers Try again.
const showDownloadsTab = () => nav.setHidden('downloads', allDownloads().length === 0 && downloadsLoadError() === null);
showDownloadsTab();
onDownloadsChange(showDownloadsTab);
document.addEventListener(TV_SOURCES_CHANGED, () => void showLiveTab());
void animeTabShown().then(showAnimeTab);
document.addEventListener(ANIME_TAB_CHANGED, (event) => showAnimeTab((event as CustomEvent<boolean>).detail));

// A small seasonal glyph by the wordmark around Halloween and late December.
const wordmark = titlebar.element.querySelector<HTMLElement>('.wordmark');
if (wordmark) installSeasonal(wordmark);
root.replaceChildren(h('div', { class: 'wallpaper', 'aria-hidden': 'true' }), h('div', { class: 'ambient', 'aria-hidden': 'true' }), titlebar.element, createOfflineBanner(), createUpdateBanner(), outlet);
installBackHandling(() => router.back());
// Android's Back button asks this first (gen/android MainActivity), and leaves the app only when it's false.
if (isAndroid) {
  Object.assign(window, {
    __orbitBack: androidBack,
    // A search aimed at Orbit from Android (gen/android MainActivity): Search opens with it. True once taken.
    __orbitSearch: (query: unknown) => {
      if (typeof query !== 'string' || !query.trim()) return false;
      searchNextFor(query.trim().slice(0, 200));
      // The results, not a title page Search was left on.
      router.go('search', { root: true });
      return true;
    },
  });
  // For styles that differ there (`:root[data-platform='android']`).
  document.documentElement.dataset.platform = 'android';
} else {
  startGlassSheen();
  // The window's own buttons sit over the header there (`:root[data-platform='mac']`, app/titlebar.ts).
  if (isMac) document.documentElement.dataset.platform = 'mac';
}

// Ambient mode after a while without input (Settings → Appearance). Over the player it reads the
// paused state the player last drew from mpv's events, and never changes it.
const { openDetail, play } = titleHandlers(router.ctx);
if (isAndroid) {
  // A title picked in the TV home screen's Continue Watching (gen/android MainActivity, library/watch-next.ts):
  // played only when this profile has it in its own list. True once taken, found or not.
  Object.assign(window, {
    __orbitWatchNext: (id: unknown) => {
      const record = typeof id === 'string' ? watchRecord(id) : undefined;
      if (record) play(record.title);
      return true;
    },
  });
  installWatchNext();
}
installAmbient({
  player: () => (!playerOpen() ? 'none' : document.querySelector('.player.paused') ? 'paused' : 'playing'),
  openTitle: openDetail,
});

// Video and subtitle files dragged onto the window from this PC.
installLocalDrop(router.ctx);

// Closing Orbit saves where the video got to and sends what's waiting for Stremio first.
installQuit();

// A paired phone's commands (Settings → General → Phone remote; off until turned on).
startRemoteBridge(router.ctx);
// Other Orbits on the home network (Settings → General → Orbit Connect; off until turned on, then kept on).
startConnectBridge(router.ctx);

// The command palette (Ctrl+K): titles, your things, Settings, addons and actions in one field.
installPalette({
  ctx: router.ctx,
  go: (id, options) => router.go(id, options),
  rooms,
  // Addons is out of the nav by default, so Ctrl+K (and Quick settings) is the way there.
  shown: (id) => id === 'addons' || !document.querySelector<HTMLElement>(`.nav-item[data-room="${CSS.escape(id)}"]`)?.hidden,
});

// App-wide shortcuts (Settings → Shortcuts): by default Ctrl+K the command palette, / search, Ctrl+, settings, ? the shortcut list, L saves the focused card.
document.addEventListener('keydown', (event) => {
  // The player owns the keyboard; Esc (Back) is the way out. First-run setup too: no shortcut opens a page behind it.
  if (playerOpen() || setupOpen()) return;
  const action = appShortcut(event);
  if (!action) return;
  // Only on a focused card; elsewhere the key is left alone.
  if (action === 'app.save-card') {
    if (saveFocusedCard()) event.preventDefault();
    return;
  }
  event.preventDefault();
  if (action === 'app.palette') return togglePalette();
  if (action === 'app.shortcuts') openSettingsTo('shortcuts');
  router.go(action === 'app.search' ? 'search' : 'settings');
});

/** The title-bar avatar: who's watching, and the way to switch. */
async function createProfileButton(): Promise<HTMLElement | undefined> {
  try {
    const [profiles, id] = await Promise.all([listProfiles(), activeProfileId()]);
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return undefined;
    const button = h('button', { class: 'profile-button' });
    const draw = (name: string) => {
      button.title = t('browse.profile.title', { name });
      button.setAttribute('aria-label', t('browse.profile.label', { name }));
      button.replaceChildren(avatar({ ...profile, name }), h('span', { class: 'profile-name', 'aria-hidden': 'true' }, name));
    };
    draw(profile.name);
    // First-run setup names a new install's profile in the person's language (onboarding/state.ts).
    if (profile.id === FIRST_PROFILE.id) document.addEventListener(FIRST_PROFILE_NAMED, (event) => draw((event as CustomEvent<string>).detail));
    button.addEventListener('click', () => void openProfileSwitcher());
    return button;
  } catch (err) {
    reportError('Could not show the profile', err, 'warn');
    return undefined;
  }
}

void showLiveTab();

// Back where the language was changed (Settings → General), else Settings → General → Open to.
if (takeReturnTo() === 'settings-general') {
  openSettingsTo('general');
  router.go('settings');
} else {
  const page = await openToLoad;
  // Starting without a connection, the downloads are what can be watched.
  router.go(!navigator.onLine && allDownloads().some((d) => d.state === 'done') ? 'downloads' : page === 'library' ? 'library' : 'home');
}
performance.mark('orbit-first-page');
// A new install gets a short, skippable setup over Home; anyone with data of their own never does.
// Then addon install links (stremio://, orbit://) from a website: the Addons page opens on their review.
// After the first page, so the one Orbit was started with isn't covered by it, and once setup is known
// to be open or not, so a link waits for setup to end rather than opening under it.
void startOnboardingIfNew()
  .catch((err: unknown) => reportError('Could not check for first-run setup', err, 'warn'))
  .finally(() => startDeepLinks((id, options) => router.go(id, options)));
// Two frames on, the first page has been painted. (A hidden window draws no
// frames, so the timer makes sure background work still starts.)
requestAnimationFrame(() => requestAnimationFrame(reportStartup));
window.setTimeout(reportStartup, 3000);

let started = false;
/** Startup timings (ms since the window began loading) to the log file, once, for cold-start numbers. */
function reportStartup(): void {
  if (started) return;
  started = true;
  performance.mark('orbit-painted');
  const marks: [string, number][] = performance.getEntriesByType('mark').map((m) => [m.name, m.startTime]);
  void invoke('diagnostics_startup', { marks }).catch(() => {});
  scheduleBackgroundWork();
  startAutoEffects();
}

function takeReturnTo(): string | null {
  try {
    const page = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    return page;
  } catch {
    return null;
  }
}

// Install the built-in addons (Cinemeta) on first run, without holding up startup.
ensureBuiltins().catch((err: unknown) => console.warn('Could not install built-in addons yet', err));

/**
 * Background work that needs the network starts after the first page is
 * painted, a little apart, so it doesn't compete with the page's own rows
 * for the connection and the addons (each is quiet about failures).
 */
function scheduleBackgroundWork(): void {
  const later = (ms: number, work: () => Promise<unknown>, what: string) =>
    window.setTimeout(() => void work().catch((err: unknown) => reportError(what, err, 'warn')), ms);
  // Shows kept downloaded follow watch history from here on (local only).
  later(0, startAutoDownloads, 'Could not start keeping episodes downloaded');
  // Pull what was watched in Stremio, then new episodes of watched series.
  later(0, startAniListSync, 'Could not start AniList sync');
  later(2500, startStremioSync, 'Could not sync with Stremio');
  later(5000, refreshNewEpisodes, 'Could not check for new episodes');
  // The bell's new episodes (and system notifications, if on): now, then every few hours.
  later(7500, startAlerts, 'Could not check for new-episode alerts');
  // Episode reminders (Remind me on an upcoming episode): now, then every hour.
  later(9000, startReminders, 'Could not check episode reminders');
  // Addons change their manifests (new catalogs, a new version) without a reinstall: look once a day.
  later(10_000, refreshManifestsDaily, 'Could not check addons for updates');
}
