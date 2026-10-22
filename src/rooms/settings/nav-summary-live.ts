/**
 * Reads what each Settings category is set to now, for the line under its
 * name in the sidebar (nav-summary.ts builds the lines), and redraws them
 * when something they show changes: any saved setting, the addons, the
 * downloads, the connected services or the library.
 *
 * Nothing here asks the network or reads a secret: settings and services'
 * states are local, as the profile header's are (profile-header.ts).
 */
import { list as installedAddons, onAddonsChange } from '../../addons/registry';
import { LETTERBOXD_CHANGED, letterboxdProfile } from '../../catalog/letterboxd';
import { FUN_LANGUAGES, isFunLanguage, language, languageChoice, LANGUAGES, t } from '../../i18n';
import { SETTING_SAVED, settings } from '../../lib/ipc';
import { ACTION_IDS, keymap } from '../../lib/keymap';
import { languageName } from '../../lib/languages';
import { anilistState, onAniListChange } from '../../library/anilist';
import { CLOUD_CHANGED, cloudAccounts } from '../../library/cloud';
import { allDownloads, onDownloadsChange } from '../../library/downloads';
import { JELLYFIN_CHANGED, jellyfinStatus } from '../../library/jellyfin';
import { PLEX_CHANGED, plexStatus } from '../../library/plex';
import { spoilers } from '../../library/spoilers';
import { askStremioAccount, STREMIO_SYNC_CHANGED, stremioSyncState } from '../../library/stremio-sync';
import { watchPrefs } from '../../library/watch';
import { appearance } from '../../theme/appearance';
import { currentFonts, currentThemeId, myThemes } from '../../theme/engine';
import { findFontPair } from '../../theme/fonts';
import { findPreset } from '../../theme/palette';
import { loadPlayerLayout } from '../player/layout';
import { parseAutoplayMode, PLAYBACK_SETTINGS } from '../player/next-up';
import { QUALITY_NAMES } from '../player/panels';
import { parsePictureQuality, PICTURE_QUALITY_KEY } from '../player/picture';
import { HDR_KEY } from '../player/player-settings';
import { LANGUAGE_SETTINGS, parseLanguages } from '../player/preferred-language';
import { SIZE_DEFAULT, SUBTITLE_FONTS, subtitleStyle } from '../player/subtitle-style';
import { HERO_STYLE } from '../studio/look-choices';
import { PRESET_NAMES } from './player';
import { accountsSummary, addonsSummary, connectedServices, appearanceSummary, downloadsSummary, generalSummary, homeLibrarySummary, pictureSoundSummary, playbackSummary, playerSummary, shortcutsSummary, subtitlesSummary } from './nav-summary';

const get = (key: string): Promise<unknown> => settings.get(key).catch(() => null);

function languageNow(): string {
  const choice = languageChoice();
  if (isFunLanguage(choice)) return t(FUN_LANGUAGES.find((l) => l.id === choice)!.name);
  return LANGUAGES.find((l) => l.id === language())?.name ?? '';
}

function themeName(): string {
  const id = currentThemeId();
  return findPreset(id)?.name ?? myThemes().find((theme) => theme.id === id)?.name ?? '';
}

/** Each category's line, by category id. */
async function readSummaries(): Promise<Record<string, string>> {
  const look = appearance();
  const hidden = spoilers();
  const downloads = allDownloads();
  const [autoplay, player, subtitleLanguages, subtitle, picture, hdr, addons, jellyfin, plex, cloud, letterboxd] = await Promise.all([
    get(PLAYBACK_SETTINGS.autoplay),
    loadPlayerLayout(),
    get(LANGUAGE_SETTINGS.subtitle),
    subtitleStyle(),
    get(PICTURE_QUALITY_KEY),
    get(HDR_KEY),
    installedAddons().catch(() => []),
    jellyfinStatus().catch(() => null),
    plexStatus().catch(() => null),
    cloudAccounts().catch(() => []),
    letterboxdProfile().catch(() => null),
  ]);
  const banner = HERO_STYLE.options.find(([value]) => value === look.heroStyle)?.[1] ?? 'settings.appearance.hero-card';
  const enabled = addons.filter((addon) => addon.enabled && addon.manifest);
  return {
    general: generalSummary({ language: languageNow(), scale: look.scale }),
    appearance: appearanceSummary({ theme: themeName(), fonts: findFontPair(currentFonts()).label, banner: t(banner) }),
    'home-library': homeLibrarySummary({ watchedAt: watchPrefs().watchedAt, spoilersHidden: hidden.titles || hidden.descriptions || hidden.thumbnails || hidden.ratings || hidden.unaired }),
    playback: playbackSummary({ autoplay: t(`watching.autoplay.${parseAutoplayMode(autoplay)}`) }),
    player: playerSummary({ layout: PRESET_NAMES[player.preset] }),
    subtitles: subtitlesSummary({
      languages: parseLanguages(subtitleLanguages).map((key) => languageName(key)),
      font: subtitle.font === 'default' ? undefined : SUBTITLE_FONTS.find(([id]) => id === subtitle.font)?.[1],
      size: subtitle.size / SIZE_DEFAULT,
    }),
    'picture-sound': pictureSoundSummary({ quality: t(QUALITY_NAMES[parsePictureQuality(picture)]), hdr: hdr === true }),
    // The person's own addons first: the built-ins are there for everyone.
    addons: addonsSummary([...enabled.filter((a) => !a.builtIn), ...enabled.filter((a) => a.builtIn)].map((a) => a.manifest!.name)),
    // Service names only: a server's or account's own name stays in the profile card above.
    accounts: accountsSummary(
      connectedServices({ stremio: stremioSyncState().signedIn === true, anilist: !!anilistState().account, jellyfin: !!jellyfin, plex: !!plex, cloud: cloud.map((account) => account.name), letterboxd: !!letterboxd }),
    ),
    downloads: downloadsSummary({ done: downloads.filter((d) => d.state === 'done').length, active: downloads.filter((d) => d.state === 'queued' || d.state === 'running' || d.state === 'paused').length }),
    shortcuts: shortcutsSummary(ACTION_IDS.filter((id) => keymap()[id].length > 0).length),
  };
}

/**
 * Keeps `draw` fed with the lines: once now, then after each change (several
 * settings saved together, as a Look does, redraw once). Returns `refresh`,
 * for when Settings is shown again.
 */
export function watchSummaries(draw: (lines: Record<string, string>) => void): () => void {
  let drawn = 0;
  let timer: number | undefined;
  const refresh = () => {
    const generation = ++drawn;
    void readSummaries()
      .then((lines) => generation === drawn && draw(lines))
      .catch((err: unknown) => console.warn('Could not read the Settings summaries', err));
  };
  const soon = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 150);
  };
  for (const type of [SETTING_SAVED, STREMIO_SYNC_CHANGED, JELLYFIN_CHANGED, PLEX_CHANGED, CLOUD_CHANGED, LETTERBOXD_CHANGED]) document.addEventListener(type, soon);
  onAddonsChange(soon);
  onDownloadsChange(soon);
  onAniListChange(soon);
  // With sync off nothing has asked yet, and Stremio would be left out here (and in the profile card) until Accounts was opened.
  askStremioAccount();
  refresh();
  return refresh;
}
