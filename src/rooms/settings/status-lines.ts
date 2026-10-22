/** The Settings profile header's service lines, apart from drawing them. */
import type { LetterboxdProfile } from '../../catalog/letterboxd';
import { t } from '../../i18n';
import { agoText } from '../../lib/ago';
import type { CloudAccount } from '../../library/cloud';
import type { JellyfinStatus } from '../../library/jellyfin';
import type { PlexStatus } from '../../library/plex';
import type { StremioSyncState } from '../../library/stremio-sync';

/** At most this many service lines, so the header stays a header. */
export const MAX_STATUS_LINES = 2;

export interface Connections {
  stremio: StremioSyncState;
  jellyfin: JellyfinStatus | null;
  plex: PlexStatus | null;
  cloud: readonly Pick<CloudAccount, 'name'>[];
  letterboxd: LetterboxdProfile | null;
}

/** The lines to show, most telling first: Stremio (it syncs), then Jellyfin, Plex, the debrid cloud, then Letterboxd. */
export function statusLines(c: Connections, now: number, tag: string): string[] {
  const lines: string[] = [];
  if (c.stremio.signedIn) {
    const { lastSync } = c.stremio;
    if (lastSync === null) lines.push(t('settingshome.stremio.signed-in'));
    else {
      const when = agoText(lastSync, now, tag);
      lines.push(when ? t('settingshome.stremio.synced', { when }) : t('settingshome.stremio.synced-now'));
    }
  }
  if (c.jellyfin) lines.push(t('settingshome.jellyfin', { server: c.jellyfin.serverName }));
  if (c.plex) lines.push(t('settingshome.plex', { server: c.plex.serverName }));
  if (c.cloud.length) lines.push(t('cloud.status-line', { providers: c.cloud.map((a) => a.name).join(', ') }));
  if (c.letterboxd) lines.push(t('settingshome.letterboxd', { name: c.letterboxd.name || c.letterboxd.user }));
  return lines.slice(0, MAX_STATUS_LINES);
}
