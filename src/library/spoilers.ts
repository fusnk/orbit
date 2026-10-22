/**
 * Spoiler protection (Settings → Library & Metadata → Spoilers): what to hide
 * about episodes the viewer hasn't seen, kept per profile. It applies
 * wherever episodes are listed: a show's page (both layouts), the player's
 * episode list and dock, the Next Up card, and Continue Watching's next
 * episode. Hidden text is replaced (not just hidden by CSS), so it can't be
 * read by selecting or hovering; blurred pictures clear on hover.
 */
import { t } from '../i18n';
import { profileStore } from '../rooms/player/profile-store';
import { appearance } from '../theme/appearance';
import type { EpisodeState } from './watch';

export interface Spoilers {
  /** "Episode 4" instead of the episode's name. */
  titles: boolean;
  descriptions: boolean;
  thumbnails: boolean;
  ratings: boolean;
  /** Upcoming episodes say only "Not yet aired", not when. */
  unaired: boolean;
  /** Only episodes not watched (nor started), or every episode. */
  scope: 'unwatched' | 'all';
}

export const SPOILERS_PREFIX = 'library.spoilers';

/** The two switches that came before (Settings → Library & Metadata, saved in `appearance`). */
export interface LegacySpoilers {
  /** "Hide spoilers": blurred the pictures and descriptions of unwatched episodes. Was on by default. */
  spoilers: boolean;
  /** "Hide episode descriptions": left every episode's description out. */
  hideEpisodeDescriptions: boolean;
}

/**
 * A saved value with every unknown or invalid field reset. Nothing saved yet
 * (the first read for this profile) takes the old switches' meaning: blurred
 * pictures and hidden descriptions for unwatched episodes, or descriptions
 * hidden for every episode when only that was on.
 */
export function parseSpoilers(value: unknown, legacy: LegacySpoilers): Spoilers {
  if (value === null || value === undefined) {
    return { titles: false, descriptions: legacy.spoilers || legacy.hideEpisodeDescriptions, thumbnails: legacy.spoilers, ratings: false, unaired: false, scope: legacy.hideEpisodeDescriptions && !legacy.spoilers ? 'all' : 'unwatched' };
  }
  const saved = typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    titles: saved.titles === true,
    descriptions: saved.descriptions === true,
    thumbnails: saved.thumbnails === true,
    ratings: saved.ratings === true,
    unaired: saved.unaired === true,
    scope: saved.scope === 'all' ? 'all' : 'unwatched',
  };
}

const store = profileStore(SPOILERS_PREFIX, (value) => parseSpoilers(value, appearance()));

/** Reads the profile's choices (after the profile is chosen; the defaults until then). */
export const loadSpoilers = (): Promise<void> => store.load();
export const spoilers = (): Spoilers => store.get();
export const setSpoilers = (patch: Partial<Spoilers>): Promise<void> => store.update((current) => ({ ...current, ...patch }));

export interface Hidden {
  title: boolean;
  description: boolean;
  thumbnail: boolean;
  rating: boolean;
  airDate: boolean;
}

const NOTHING: Hidden = { title: false, description: false, thumbnail: false, rating: false, airDate: false };

/**
 * What to hide for an episode in state `kind`: with the scope on unwatched
 * episodes, one the viewer finished or started shows everything (the one up
 * next counts as unwatched: its name is still a surprise).
 */
export function hiddenFor(kind: EpisodeState['kind'], s: Spoilers = spoilers()): Hidden {
  if (s.scope === 'unwatched' && (kind === 'watched' || kind === 'in-progress')) return NOTHING;
  return { title: s.titles, description: s.descriptions, thumbnail: s.thumbnails, rating: s.ratings, airDate: s.unaired };
}

/** The episode's name, or "Episode 4" while names are hidden. */
export const episodeName = (number: number, title: string, hide: boolean): string => (hide ? t('player.episodes.episode', { number: String(number) }) : title);
