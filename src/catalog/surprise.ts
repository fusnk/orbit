/**
 * Surprise Me (Movies / TV Shows): which loaded titles fit the chosen
 * constraints, and a random pick among them that hasn't been shown yet.
 * Pure, so it can be tested without the page.
 */
import { decodeEntities } from '../addons/schema';
import { releaseYear } from '../library/filters';
import { runtimeMinutes } from './runtime';
import type { Title } from './titles';

export type RuntimeLimit = 'any' | 'under-100' | 'under-120';
export const RUNTIME_LIMITS: Record<RuntimeLimit, number> = { any: Infinity, 'under-100': 100, 'under-120': 120 };

export type EraId = 'any' | '2020s' | '2010s' | '2000s' | '1990s' | 'earlier';
export const ERAS: Record<EraId, { from: number; to: number }> = {
  any: { from: -Infinity, to: Infinity },
  '2020s': { from: 2020, to: Infinity },
  '2010s': { from: 2010, to: 2019 },
  '2000s': { from: 2000, to: 2009 },
  '1990s': { from: 1990, to: 1999 },
  earlier: { from: -Infinity, to: 1989 },
};

export interface SurpriseConstraints {
  type: 'movie' | 'series';
  genre: string | null;
  runtime: RuntimeLimit;
  era: EraId;
  unwatchedOnly: boolean;
}

/** A loaded title, and the genre its catalog was asked for (addons don't always list genres on previews). */
export interface Candidate {
  title: Title;
  genre?: string | undefined;
}

/** One catalog's pages loaded for one genre. */
export interface LoadedPages {
  titles: Candidate[];
  done: boolean;
  pages: number;
  /** Titles the addon has sent, repeats included: where its next page starts (`skip`). */
  received: number;
}

/**
 * Adds a page the addon sent, each title once. The next page starts past
 * every title sent: counting only the new ones would ask again for titles
 * already sent whenever the addon repeated one.
 */
export function addPage(state: LoadedPages, page: readonly Title[], genre: string | undefined): void {
  state.pages++;
  state.received += page.length;
  const known = new Set(state.titles.map((x) => x.title.id));
  const fresh = page.filter((title) => !known.has(title.id) && !!known.add(title.id));
  state.done = fresh.length === 0;
  state.titles.push(...fresh.map((title) => ({ title, genre })));
}

/**
 * Whether a title fits. A limit on runtime or year leaves out titles that
 * don't say theirs: a surprise should keep the promise. Runtime only limits
 * movies (a show's runtime is per episode).
 */
export function fits(candidate: Candidate, c: SurpriseConstraints, started: (title: Title) => boolean): boolean {
  const { title } = candidate;
  if (title.type !== c.type) return false;
  // A catalog asked for a genre can still return titles whose own genres
  // don't include it (Cinemeta's do): the title's list wins when it has one.
  // The genre is the catalog's option as the addon sent it (maybe HTML-escaped); a title's own genres are decoded.
  if (c.genre !== null && (title.genres.length ? !title.genres.includes(c.genre) && !title.genres.includes(decodeEntities(c.genre)) : candidate.genre !== c.genre)) return false;
  if (c.type === 'movie' && c.runtime !== 'any') {
    const minutes = runtimeMinutes(title.runtime);
    if (!minutes || minutes >= RUNTIME_LIMITS[c.runtime]) return false;
  }
  if (c.era !== 'any') {
    const year = releaseYear(title.year);
    const { from, to } = ERAS[c.era];
    if (!year || year < from || year > to) return false;
  }
  return !(c.unwatchedOnly && started(title));
}

/**
 * A random title from `pool` that fits and isn't in `exclude` (already
 * shown); undefined if none is left.
 */
export function pickSurprise(
  pool: readonly Candidate[],
  c: SurpriseConstraints,
  options: { exclude: ReadonlySet<string>; started: (title: Title) => boolean; random?: () => number },
): Title | undefined {
  const seen = new Set<string>();
  const matches: Title[] = [];
  for (const candidate of pool) {
    const { id } = candidate.title;
    if (options.exclude.has(id) || !fits(candidate, c, options.started)) continue;
    // The same title from two catalogs counts once, so it's not twice as likely.
    if (seen.has(id)) continue;
    seen.add(id);
    matches.push(candidate.title);
  }
  if (!matches.length) return undefined;
  const random = options.random ?? Math.random;
  return matches[Math.min(matches.length - 1, Math.floor(random() * matches.length))];
}
