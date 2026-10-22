/**
 * A Home genre tile's page: the genre's movies or shows, with a Movies | TV
 * Shows switch that's remembered for the next tile. Each type comes from a
 * catalog that has the genre (genre-targets.ts); a type without it is left out.
 */
import type { RoomContext } from '../../app/router';
import { allowedTitles } from '../../catalog/parental';
import { loadCatalog } from '../../catalog/service';
import type { CatalogRef } from '../../catalog/titles';
import { t } from '../../i18n';
import { settings } from '../../lib/ipc';
import { createGridPage, type Kind, type PageLoader } from '../explore/grid';
import { genreTargets, type GenreTarget } from './genre-targets';

/** The type picked last on a genre page. */
const KIND_KEY = 'home.genre-kind';
let lastKind: Kind | undefined;
let savedKind: Promise<void> | undefined;

/** Pages of one catalog's genre, asked by offset (`skip`) where the catalog pages at all. */
export function catalogPages(target: GenreTarget): PageLoader {
  const ref: CatalogRef = { ...target.ref, extra: target.ref.extra.filter(([name]) => name !== 'genre') };
  const pages = target.ref.catalog.extra.some((e) => e.name === 'skip');
  // Where each page starts: the titles before it (a catalog's pages needn't be the same size).
  const starts = [0, 0];
  // Titles from earlier pages: an addon that ignores `skip` sends its first page again, and the
  // grid, finding nothing new, would ask for the next page (and the next) without end.
  const seen = new Set<string>();
  return async (_kind, page) => {
    const skip = starts[page];
    if (skip === undefined || (page > 1 && !pages)) return { titles: [], done: true };
    // The grid starting over (Movies → TV Shows → Movies) asks for page 1 again: what it saw before isn't shown now.
    if (page === 1) seen.clear();
    const titles = await loadCatalog(ref, [['genre', target.genre], ...(skip ? [['skip', String(skip)] as [string, string]] : [])]);
    starts[page + 1] = skip + titles.length;
    const fresh = titles.filter((title) => !seen.has(title.id));
    for (const title of fresh) seen.add(title.id);
    return { titles: await allowedTitles(titles), done: !fresh.length || !pages };
  };
}

/** Opens `genre` (a tile's name, from `from`'s catalog) for movies and shows; nothing when no catalog has it. */
export async function openGenrePage(ctx: RoomContext, genre: string, refs: readonly CatalogRef[], from: CatalogRef): Promise<void> {
  const targets = genreTargets(genre, refs, from.addon.key);
  const kinds = (['movie', 'series'] as const).filter((kind) => targets[kind]);
  if (!kinds.length) return;
  const loaders = new Map(kinds.map((kind) => [kind, catalogPages(targets[kind]!)]));
  await (savedKind ??= settings
    .get(KIND_KEY)
    .then((value) => {
      lastKind ??= value === 'series' ? 'series' : 'movie';
    })
    .catch(() => {}));
  ctx.open(
    createGridPage(
      {
        title: genre,
        eyebrow: t('browse.home.genres'),
        kinds,
        service: 'addon',
        load: (kind, page) => loaders.get(kind)!(kind, page),
        onKind: (kind) => {
          lastKind = kind;
          settings.set(KIND_KEY, kind).catch((err: unknown) => console.warn('Could not remember the genre page’s type', err));
        },
      },
      ctx,
      lastKind,
    ),
  );
}
