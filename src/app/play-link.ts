/**
 * "Play this link" in Search and the command palette: a pasted web address
 * or magnet link opens in the player (see lib/pasted-link.ts for what counts).
 *
 * A web address plays as an addon's stream does: Rust checks it's plain http
 * or https before mpv gets it (player_open). Orbit fetches nothing from it
 * itself, so there's no redirect of Orbit's to guard; mpv follows redirects
 * as it does for addon streams (the accepted limit in docs/DEVELOPMENT.md).
 *
 * A magnet link plays through Orbit's own torrent player (torrent.rs), which
 * is off until turned on in Settings; the debrid accounts only browse files
 * already in the cloud and can't take a magnet. While torrents are off, the
 * result says so and leads to the setting.
 *
 * The link isn't a catalog title, so nothing is resumed or saved to watch
 * history (`link` in PlayRequest), and the query is never sent to addons.
 */
import type { RoomContext } from './router';
import { parseTitleRef } from '../catalog/title-ref';
import { t } from '../i18n';
import { parsePastedLink, type PastedLink } from '../lib/pasted-link';
import { torrentMode } from '../rooms/detail/ranking-prefs';
import { openPlayer, type PlayRequest } from '../rooms/player';
import { openSettingsTo } from '../rooms/settings';

/** The link in what was typed, unless it's an IMDb, TMDB or Letterboxd link, which names a title to open instead. */
export function linkIn(query: string): PastedLink | null {
  return parseTitleRef(query.trim()) ? null : parsePastedLink(query);
}

/** Whether Orbit can play `link` now: a magnet needs torrents turned on. */
export const canPlayLink = (link: PastedLink): boolean => link.kind === 'web' || torrentMode() !== 'off';

/** What the result shows: the file's name or host for an address, the magnet's own name for a magnet. Never the address. */
export const linkName = (link: PastedLink): string => link.name ?? t('pastelink.magnet');

/** The result's line: the name, and for an address named by its file, the host it's on. */
export const linkLine = (link: PastedLink): string => (link.kind === 'web' && link.name !== link.host ? `${link.name} · ${link.host}` : linkName(link));

/**
 * The player request: an untitled movie with this link as its only source.
 * Each paste is its own title (a random id, nothing taken from the address),
 * so a second link opened over the first plays as a new video.
 */
export function linkRequest(link: PastedLink): PlayRequest {
  const source = { id: 'link', url: link.url, addon: t('pastelink.source'), label: linkName(link), meta: '' };
  return { title: { id: `link:${crypto.randomUUID()}`, type: 'movie', name: linkName(link), genres: [], origins: [] }, source, sources: [source], link: true };
}

export function playLink(link: PastedLink, ctx: RoomContext): void {
  openPlayer(linkRequest(link), ctx);
}

/** Settings → Addons & Sources → Source preferences, where torrents are turned on. */
export function openTorrentSetting(ctx: RoomContext): void {
  openSettingsTo('addons', undefined, 'sources');
  ctx.go('settings');
}
