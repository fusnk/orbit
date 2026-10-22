/**
 * Settings' categories, in the sidebar's two groups (rooms/settings/index.ts
 * draws them, the command palette lists them), and where the ids used before
 * the clean-up now lead, so older deep links and remembered palette picks
 * still arrive. Setting keys never changed; only where rows are shown did.
 */
import type { IconName } from '../../components/icons';
import type { MessageKey } from '../../i18n';
import { isAndroid } from '../../lib/platform';

export type CategoryGroup = 'everyone' | 'sources';

export interface CategoryTab {
  id: string;
  label: MessageKey;
}

export interface CategoryInfo {
  id: string;
  label: MessageKey;
  /** One line under the category's title saying what it covers. */
  intro: MessageKey;
  /** Other words people may type for it (command palette). */
  keywords: MessageKey;
  icon: IconName;
  group: CategoryGroup;
  /** Pages within the category; the first opens unless a link asks for another. */
  tabs?: readonly CategoryTab[];
}

/** In the sidebar's order: what anyone comes to change first, then sources and connections. */
const ALL_CATEGORIES: readonly CategoryInfo[] = [
  { id: 'general', label: 'settings.nav.general', intro: 'settingshome.intro.general', keywords: 'palette.keywords.general', icon: 'sliders', group: 'everyone' },
  { id: 'appearance', label: 'settings.nav.appearance', intro: 'settingslayout.intro.appearance', keywords: 'palette.keywords.appearance', icon: 'palette', group: 'everyone' },
  { id: 'home-library', label: 'settings.nav.home-library', intro: 'settingshome.intro.home-library', keywords: 'palette.keywords.home-library', icon: 'list', group: 'everyone' },
  { id: 'playback', label: 'settings.nav.playback', intro: 'settingslayout.intro.playback', keywords: 'palette.keywords.playback', icon: 'play', group: 'everyone' },
  // How the player looks and how its controls behave, apart from what plays when (Playback).
  { id: 'player', label: 'playerlook.nav', intro: 'settingslayout.intro.player', keywords: 'settingslayout.keywords.player', icon: 'fullscreen', group: 'everyone' },
  { id: 'subtitles', label: 'settings.nav.subtitles', intro: 'settingshome.intro.subtitles', keywords: 'palette.keywords.subtitles', icon: 'subtitles', group: 'everyone' },
  { id: 'picture-sound', label: 'settings.nav.picture-sound', intro: 'settingshome.intro.picture-sound', keywords: 'palette.keywords.picture-sound', icon: 'film', group: 'everyone' },
  {
    id: 'addons',
    label: 'settings.nav.addons',
    intro: 'settingshome.intro.addons',
    keywords: 'palette.keywords.addons',
    icon: 'addons',
    group: 'sources',
    tabs: [
      { id: 'installed', label: 'integrations.addons.installed' },
      { id: 'sources', label: 'settings.sources.tab' },
    ],
  },
  { id: 'accounts', label: 'settings.nav.accounts', intro: 'settingshome.intro.accounts', keywords: 'palette.keywords.accounts', icon: 'link', group: 'sources' },
  { id: 'downloads', label: 'downloads.settings.nav', intro: 'settingshome.intro.downloads', keywords: 'palette.keywords.downloads', icon: 'download', group: 'sources' },
  { id: 'shortcuts', label: 'settings.nav.shortcuts', intro: 'settingshome.intro.shortcuts', keywords: 'palette.keywords.shortcuts', icon: 'keyboard', group: 'sources' },
];

/** Android plays in its own player, which none of Picture & Sound's settings (all mpv's) reach. */
export const CATEGORIES: readonly CategoryInfo[] = isAndroid ? ALL_CATEGORIES.filter((c) => c.id !== 'picture-sound') : ALL_CATEGORIES;

/** Dispatched on a tabbed category's panel, with a tab id as `detail`, to show that tab. */
export const SHOW_TAB = 'orbit:settings-tab';

export const GROUPS: readonly { id: CategoryGroup; label: MessageKey }[] = [
  { id: 'everyone', label: 'settings.group.everyone' },
  { id: 'sources', label: 'settings.group.sources' },
];

/** Where a link to Settings lands: a category, maybe one of its tabs, maybe a part of the page (a selector). */
export interface SettingsPlace {
  category: string;
  tab?: string;
  section?: string;
}

/**
 * The categories before the clean-up, by their old ids: links built into
 * Orbit (`openSettingsTo('integrations', …)`) and palette picks remembered as
 * `video` or `library/…` keep working.
 */
export const LEGACY_CATEGORIES: Readonly<Record<string, SettingsPlace>> = {
  video: { category: 'picture-sound' },
  audio: { category: 'subtitles' },
  library: { category: 'home-library' },
  integrations: { category: 'accounts' },
  livetv: { category: 'accounts', section: '.live-tv-section' },
  advanced: { category: 'general', section: '.backup-section' },
};

/**
 * Where `id` (a category id, old or new) leads, with `tab` and `section` if
 * given; a tabbed category without a tab asked for opens its first. Null for
 * an id Settings doesn't know.
 */
export function resolvePlace(id: string, tab?: string, section?: string): SettingsPlace | null {
  const place = CATEGORIES.some((c) => c.id === id) ? { category: id } : LEGACY_CATEGORIES[id];
  // An old id for a category this platform doesn't show (Picture & Sound on Android).
  if (!place || !CATEGORIES.some((c) => c.id === place.category)) return null;
  const tabs = CATEGORIES.find((c) => c.id === place.category)!.tabs;
  const chosen = tab ?? place.tab;
  const resolved: SettingsPlace = { category: place.category };
  if (tabs) resolved.tab = tabs.some((t) => t.id === chosen) ? chosen! : tabs[0]!.id;
  const where = section ?? place.section;
  if (where) resolved.section = where;
  return resolved;
}
