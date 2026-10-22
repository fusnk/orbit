/**
 * The top of the Settings sidebar, kept short so every category fits beside
 * it: whose settings these are, one quiet line about the services the profile
 * is connected to, the way to switch, and one line with the profile's library
 * at a glance (each count a link into My Library).
 *
 * Nothing here asks the network: Stremio's state is what the last sync (or a
 * visit to Integrations) found out, Jellyfin's, Plex's, the debrid accounts' and
 * Letterboxd's are saved locally. Each line is redrawn when its service says it changed;
 * the counts are redrawn when the library or watch history changes.
 */
import type { RoomContext } from '../../app/router';
import { reportError } from '../../app/errors';
import { LETTERBOXD_CHANGED, letterboxdProfile } from '../../catalog/letterboxd';
import { icon } from '../../components/icons';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { CLOUD_CHANGED, cloudAccounts } from '../../library/cloud';
import { JELLYFIN_CHANGED, jellyfinStatus } from '../../library/jellyfin';
import { libraryEntries, onLibraryChange } from '../../library/library';
import { PLEX_CHANGED, plexStatus } from '../../library/plex';
import { activeProfileId, listProfiles } from '../../library/profiles';
import { computeStats } from '../../library/stats';
import { STREMIO_SYNC_CHANGED, stremioSyncState } from '../../library/stremio-sync';
import { continueWatching, onWatchChange, watchedTitles, watchHistory } from '../../library/watch';
import { openLibraryTab, type LibraryTab } from '../library/index';
import { hoursOf } from '../library/review';
import { avatar, openProfileSwitcher } from '../profiles/picker';
import { statusLines } from './status-lines';

/** The header, and `refresh` to redraw its lines (e.g. each time Settings is shown, so "5 minutes ago" stays true). */
export function createProfileHeader(ctx: RoomContext): { element: HTMLElement; refresh(): void } {
  const lines = h('ul', { class: 'settings-profile-status', 'aria-label': t('settingshome.connections') });
  const stats = h('div', { class: 'settings-profile-stats', role: 'group', 'aria-label': t('profile.stats.label') });
  const element = h('div', { class: 'settings-profile', hidden: true });

  let drawn = 0;
  async function refresh(): Promise<void> {
    drawTiles();
    const generation = ++drawn;
    const [jellyfin, plex, cloud, letterboxd] = await Promise.all([jellyfinStatus(), plexStatus(), cloudAccounts(), letterboxdProfile().catch(() => null)]);
    if (generation !== drawn) return;
    const shown = statusLines({ stremio: stremioSyncState(), jellyfin, plex, cloud, letterboxd }, Date.now(), locale());
    lines.replaceChildren(...shown.map((line) => h('li', {}, line)));
    // They share one line; the pointer shows them all.
    lines.title = shown.join('\n');
    lines.hidden = !shown.length;
  }

  /** Counts from what's already loaded (My Library's own sums: library/stats for the hours), each a link to its view. */
  function drawTiles(): void {
    const counts: { label: string; value: number; tab: LibraryTab }[] = [
      { label: t('profile.stats.watchlist'), value: libraryEntries().length, tab: 'all' },
      { label: t('profile.stats.watching'), value: continueWatching().length, tab: 'continue' },
      { label: t('profile.stats.completed'), value: watchedTitles().length, tab: 'watched' },
      { label: t('profile.stats.hours'), value: hoursOf(computeStats(watchHistory(), 'all').minutes), tab: 'stats' },
    ];
    stats.replaceChildren(
      ...counts.map((stat) => {
        const name = stat.tab === 'stats' ? t('insights.stats.tab') : stat.label;
        // Its text ("142 Watchlist") is its name; the tooltip says where it goes.
        const link = h('button', { class: 'settings-profile-stat', title: t('profile.stats.open-named', { tab: name }) }, h('span', { class: 'settings-stat-value' }, stat.value.toLocaleString(locale())), ' ', h('span', { class: 'settings-stat-label' }, stat.label));
        link.addEventListener('click', () => {
          openLibraryTab(stat.tab);
          // To My Library itself: a title page left open on top of it would hide the view asked for.
          ctx.go('library', { root: true });
        });
        return link;
      }),
    );
  }

  void Promise.all([listProfiles(), activeProfileId()])
    .then(([profiles, id]) => {
      const profile = profiles.find((p) => p.id === id);
      if (!profile) return;
      const switcher = h('button', { class: 'settings-profile-switch', title: t('palette.action.profile'), 'aria-label': t('palette.action.profile') }, icon('swap'));
      switcher.addEventListener('click', () => void openProfileSwitcher().catch((err: unknown) => reportError('Could not open the profile switcher', err)));
      element.replaceChildren(
        avatar(profile, 'avatar settings-profile-avatar'),
        h('div', { class: 'settings-profile-text' }, h('span', { class: 'settings-profile-name' }, profile.name), lines),
        switcher,
        stats,
      );
      element.hidden = false;
    })
    .catch((err: unknown) => reportError('Could not show the profile in Settings', err, 'warn'));

  for (const type of [STREMIO_SYNC_CHANGED, JELLYFIN_CHANGED, PLEX_CHANGED, CLOUD_CHANGED, LETTERBOXD_CHANGED]) document.addEventListener(type, () => void refresh());
  onLibraryChange(drawTiles);
  onWatchChange(drawTiles);
  void refresh();
  return { element, refresh: () => void refresh() };
}
