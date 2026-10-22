/**
 * Searching by id or by a pasted link: "tt0133093", an imdb.com/title link,
 * a themoviedb.org movie or TV link, "tmdb:603" (optionally ":movie" or
 * ":tv"), or a letterboxd.com/film link. What was typed is only read for an
 * id, checked against a strict pattern; the pasted address itself is never
 * fetched. Lookups go through Rust (TMDB's token stays there; Letterboxd's
 * film page is asked for by its checked slug on letterboxd.com).
 */
import { invoke } from '@tauri-apps/api/core';
import { allowedTitles } from './parental';
import { loadMeta } from './service';
import { titleById } from './tmdb';
import type { Title } from './titles';

export type TitleRef = { kind: 'imdb'; id: string } | { kind: 'tmdb'; id: number; media?: 'movie' | 'tv' | undefined } | { kind: 'letterboxd'; slug: string };

const IMDB_ID = /^tt\d{7,10}$/;
/** TMDB's ids are positive integers; Rust refuses anything past a billion. */
const MAX_TMDB_ID = 1_000_000_000;
const SLUG = /^[a-z0-9-]{1,200}$/;

/** A pasted address without its scheme and "www.", or null when it isn't a plain https/http link. */
function linkPath(text: string): { host: string; path: string[] } | null {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  return { host, path: url.pathname.split('/').filter(Boolean) };
}

const tmdbNumber = (text: string | undefined): number | null => {
  // TMDB's links add the title after the id: /movie/603-the-matrix.
  const digits = /^(\d{1,10})(?:-[\w-]*)?$/.exec(text ?? '')?.[1];
  const id = digits ? Number(digits) : NaN;
  return Number.isSafeInteger(id) && id >= 1 && id <= MAX_TMDB_ID ? id : null;
};

/** The title an id or link names, or null when `query` is an ordinary search. */
export function parseTitleRef(query: string): TitleRef | null {
  const text = query.trim();
  if (!text || text.length > 300 || /\s/.test(text)) return null;
  if (IMDB_ID.test(text.toLowerCase())) return { kind: 'imdb', id: text.toLowerCase() };
  const tmdb = /^tmdb:(\d{1,10})(?::(movie|tv|series|show))?$/i.exec(text);
  if (tmdb) {
    const id = tmdbNumber(tmdb[1]);
    const media = tmdb[2]?.toLowerCase();
    return id === null ? null : { kind: 'tmdb', id, media: media === undefined ? undefined : media === 'movie' ? 'movie' : 'tv' };
  }
  // Only something that looks like an address is read as one ("imdb.com/…", "https://…").
  if (!/^(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}\//i.test(text)) return null;
  const link = linkPath(text);
  if (!link) return null;
  const [first, second] = link.path;
  if (link.host === 'imdb.com') {
    // Localized pages put the language first: imdb.com/de/title/tt0133093.
    const [title, id] = /^[a-z]{2}(?:-[a-z]{2})?$/i.test(first ?? '') ? link.path.slice(1) : link.path;
    return title === 'title' && id && IMDB_ID.test(id.toLowerCase()) ? { kind: 'imdb', id: id.toLowerCase() } : null;
  }
  if (link.host === 'themoviedb.org' && (first === 'movie' || first === 'tv')) {
    const id = tmdbNumber(second);
    return id === null ? null : { kind: 'tmdb', id, media: first };
  }
  if (link.host === 'letterboxd.com' && first === 'film' && second && SLUG.test(second.toLowerCase())) return { kind: 'letterboxd', slug: second.toLowerCase() };
  return null;
}

/**
 * An IMDb id's title from the addons (Cinemeta), as a movie or else a show.
 * Throws when no addon could be asked either way (offline, say): that isn't
 * "no such title".
 */
async function fromAddons(id: string): Promise<Title | null> {
  let answered = false;
  let failure: unknown;
  for (const type of ['movie', 'series']) {
    const found = await loadMeta(type, id).then(
      (title) => ((answered = true), title),
      (err: unknown) => ((failure = err), null),
    );
    if (found) return found;
  }
  if (!answered) throw failure;
  return null;
}

/**
 * The title `ref` names, or null when nothing could be found for it; throws
 * when it couldn't be looked up at all. TMDB answers when connected; an IMDb
 * id is also asked of the addons, so it works without TMDB too.
 */
export async function resolveTitleRef(ref: TitleRef): Promise<Title | null> {
  if (ref.kind === 'tmdb') return (await titleById({ tmdbId: ref.id, kind: ref.media })) ?? null;
  const imdbId = ref.kind === 'imdb' ? ref.id : await invoke<unknown>('letterboxd_film_imdb', { slug: ref.slug });
  if (typeof imdbId !== 'string' || !IMDB_ID.test(imdbId)) return null;
  const found = (await titleById({ imdbId }).catch(() => null)) ?? (await fromAddons(imdbId));
  // The profile's content limit, as for any search result.
  return found ? ((await allowedTitles([found]))[0] ?? null) : null;
}
