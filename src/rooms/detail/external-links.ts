/**
 * "Open on IMDb / TMDB / Letterboxd" in a title page's ⋯ menu. Each address
 * is built here from a checked id (an IMDb `tt` id, TMDB's number), never
 * from addon text, and opens through Rust's `open_external`, which only
 * allows these sites over https.
 */
import { openInBrowser } from '../../lib/browser';
import type { Title } from '../../catalog/titles';
import type { MenuItem } from '../../components/menu';
import { t } from '../../i18n';

export interface ExternalLink {
  site: 'imdb' | 'tmdb' | 'letterboxd';
  url: string;
}

const IMDB_ID = /^tt\d{1,10}$/;
const validTmdb = (id: number | null | undefined): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id >= 1 && id <= 1_000_000_000;

/** The title's pages elsewhere, for the ids it has. Letterboxd lists films only. */
export function externalLinks(title: Pick<Title, 'id' | 'type'>, tmdbId: number | null | undefined): ExternalLink[] {
  const imdb = IMDB_ID.test(title.id) ? title.id : null;
  const tmdb = validTmdb(tmdbId) ? tmdbId : null;
  const links: ExternalLink[] = [];
  if (imdb) links.push({ site: 'imdb', url: `https://www.imdb.com/title/${imdb}/` });
  if (tmdb && (title.type === 'movie' || title.type === 'series')) links.push({ site: 'tmdb', url: `https://www.themoviedb.org/${title.type === 'movie' ? 'movie' : 'tv'}/${tmdb}` });
  // Letterboxd finds a film by its TMDB id, or by its IMDb id without one.
  if (title.type === 'movie' && (tmdb || imdb)) links.push({ site: 'letterboxd', url: tmdb ? `https://letterboxd.com/tmdb/${tmdb}/` : `https://letterboxd.com/imdb/${imdb}/` });
  return links;
}

const LABELS = { imdb: 'pages.open.imdb', tmdb: 'pages.open.tmdb', letterboxd: 'pages.open.letterboxd' } as const;

/** The links as menu items. */
export function externalLinkItems(title: Pick<Title, 'id' | 'type'>, tmdbId: number | null | undefined): MenuItem[] {
  return externalLinks(title, tmdbId).map((link) => ({
    label: t(LABELS[link.site]),
    action: () => void openInBrowser(link.url).catch((err: unknown) => console.warn(`Couldn’t open ${link.site}`, err)),
  }));
}
