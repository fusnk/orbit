/**
 * How a collection's sources map to what this Orbit can show (installed
 * addons, a TMDB token), and loading their titles page by page.
 */
import type { UsableAddon } from '../addons/types';
import { loadCatalog } from '../catalog/service';
import { tmdbSourcePage } from '../catalog/tmdb';
import type { CatalogRef, Title } from '../catalog/titles';
import { normalizeType, type AddonSource, type Collection, type CollectionSource } from './collections';

export type SourceStatus =
  | { state: 'ok' }
  /** The addon (by manifest id) isn't installed; `name` is what the file called it. */
  | { state: 'needs-addon'; addon: string; name?: string | undefined }
  /** The addon is installed but no longer has the catalog (or it needs input Orbit can't give). */
  | { state: 'missing-catalog'; addonName: string }
  | { state: 'needs-tmdb' }
  | { state: 'unsupported'; reason: 'trakt' | 'tmdb-shows' };

export interface SourceContext {
  addons: readonly UsableAddon[];
  /** Whether a TMDB token is saved. */
  tmdb: boolean;
}

/**
 * The installed catalog a source names: by addon id, type and catalog id;
 * else the same addon's catalog with that id under another type; else any
 * addon's catalog with that type and id (another install of the same
 * addon, under a different id).
 */
export function findSourceCatalog(addons: readonly UsableAddon[], source: Pick<AddonSource, 'addon' | 'type' | 'catalog'>): { addon: UsableAddon; catalog: UsableAddon['manifest']['catalogs'][number] } | undefined {
  const type = normalizeType(source.type);
  const all = addons.flatMap((addon) => addon.manifest.catalogs.map((catalog) => ({ addon, catalog })));
  return (
    all.find(({ addon, catalog }) => addon.manifest.id === source.addon && catalog.id === source.catalog && catalog.type === type) ??
    all.find(({ addon, catalog }) => addon.manifest.id === source.addon && catalog.id === source.catalog) ??
    all.find(({ catalog }) => catalog.id === source.catalog && catalog.type === type)
  );
}

/**
 * The request for a source's catalog: its genre if the catalog offers it
 * (else none, or the first option when the catalog needs one). Null when the
 * catalog needs other input (a search, an id).
 */
export function catalogRefFor(found: NonNullable<ReturnType<typeof findSourceCatalog>>, genre: string | undefined): CatalogRef | null {
  const extra: [string, string][] = [];
  const genres = found.catalog.extra.find((e) => e.name === 'genre');
  const offered = genre && genres && (!genres.options?.length || genres.options.includes(genre));
  if (offered) extra.push(['genre', genre]);
  for (const e of found.catalog.extra.filter((x) => x.isRequired)) {
    if (e.name === 'genre') {
      const first = e.options?.[0];
      if (!offered && first) extra.push(['genre', first]);
      else if (!offered) return null;
    } else return null;
  }
  return { addon: found.addon, catalog: found.catalog, extra };
}

export function sourceStatus(source: CollectionSource, ctx: SourceContext): SourceStatus {
  switch (source.kind) {
    case 'addon': {
      const found = findSourceCatalog(ctx.addons, source);
      if (found) return catalogRefFor(found, source.genre) ? { state: 'ok' } : { state: 'missing-catalog', addonName: found.addon.manifest.name };
      const addon = ctx.addons.find((a) => a.manifest.id === source.addon);
      return addon ? { state: 'missing-catalog', addonName: addon.manifest.name } : { state: 'needs-addon', addon: source.addon, name: source.addonName };
    }
    case 'tmdb':
      // TMDB's discover finds people's films, not their shows.
      if ((source.tmdb === 'person' || source.tmdb === 'director') && source.media === 'tv') return { state: 'unsupported', reason: 'tmdb-shows' };
      return ctx.tmdb ? { state: 'ok' } : { state: 'needs-tmdb' };
    case 'trakt':
      return { state: 'unsupported', reason: 'trakt' };
  }
}

/** Whether a collection has anything to show: fixed titles, or a source that resolves. */
export function showable(c: Pick<Collection, 'sources' | 'titles'>, ctx: SourceContext): boolean {
  return c.sources.length ? c.sources.some((s) => sourceStatus(s, ctx).state === 'ok') : c.titles.length > 0;
}

export interface Pager {
  /** The next page of titles; `done` once there are no more. */
  next(): Promise<{ titles: Title[]; done: boolean }>;
}

/**
 * Whether paging stops after `result`, of which `fresh` titles weren't shown yet. A page with
 * nothing new ends it: an addon that declares `skip` but ignores it would otherwise answer the
 * same page forever. A page the content limit emptied doesn't: the next may have titles. That
 * can't run on forever: an addon's empty page says done, and TMDB's pages end at the last one.
 */
export const pagingDone = (result: { titles: readonly unknown[]; done: boolean }, fresh: number): boolean => result.done || (result.titles.length > 0 && fresh === 0);

/** Titles from one source, a page at a time. Sources that can't be shown have none. */
export function sourcePager(source: CollectionSource, ctx: SourceContext): Pager {
  let page = 0;
  let offset = 0;
  const empty = async () => ({ titles: [] as Title[], done: true });
  if (sourceStatus(source, ctx).state !== 'ok') return { next: empty };
  if (source.kind === 'tmdb') {
    return {
      next: async () => {
        // Counted only once the page arrives, so "Try again" after a failure asks for the same page.
        const result = await tmdbSourcePage({ kind: source.tmdb, id: source.id, media: source.media, sort: source.sort, filters: source.filters }, page + 1);
        page += 1;
        return result ?? { titles: [], done: true };
      },
    };
  }
  if (source.kind !== 'addon') return { next: empty };
  const found = findSourceCatalog(ctx.addons, source);
  const ref = found && catalogRefFor(found, source.genre);
  if (!ref) return { next: empty };
  // Paging only works if the catalog declares `skip`.
  const pages = ref.catalog.extra.some((e) => e.name === 'skip');
  return {
    next: async () => {
      const titles = await loadCatalog(ref, offset ? [['skip', String(offset)]] : []);
      offset += titles.length;
      return { titles, done: !pages || titles.length === 0 };
    },
  };
}

/** A source's name to show: its own label, the catalog's name, or what it is. */
export function sourceLabel(source: CollectionSource, ctx: SourceContext, fallback: (source: CollectionSource) => string): string {
  if (source.label) return source.label;
  if (source.kind === 'addon') {
    const found = findSourceCatalog(ctx.addons, source);
    if (found?.catalog.name) return found.catalog.name;
  }
  return fallback(source);
}
