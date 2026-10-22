/**
 * Discover's "What's new" rows and its seasonal row, as TMDB discover
 * queries: in cinemas now, new to stream, airing this week and upcoming
 * (by release type and date in the person's region), and a keyword list
 * that follows the time of year. Kept free of the page so it can be tested.
 */
import type { MessageKey } from '../i18n';

export type WhatsNewId = 'in-cinemas' | 'new-to-stream' | 'airing-week' | 'upcoming';
export const WHATS_NEW: readonly WhatsNewId[] = ['in-cinemas', 'new-to-stream', 'airing-week', 'upcoming'];

/** TMDB's release types: 2 limited and 3 wide in cinemas, 4 digital. */
const THEATRICAL = '2|3';
const DIGITAL = '4';
/** How long a film counts as "in cinemas" or "new to stream", and how far ahead "upcoming" looks. */
const IN_CINEMAS_DAYS = 42;
const NEW_TO_STREAM_DAYS = 45;
const UPCOMING_DAYS = 90;

/** `day` (YYYY-MM-DD) moved by `days`. */
export const daysFrom = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export interface DiscoverQuery {
  media: 'movie' | 'tv';
  sort: string;
  filters: Record<string, string | number>;
}

/** A What's new row's query; `today` is the person's own day, `region` their country. */
export function whatsNewQuery(id: WhatsNewId, today: string, region: string): DiscoverQuery {
  switch (id) {
    case 'in-cinemas':
      return { media: 'movie', sort: 'popularity.desc', filters: { withReleaseType: THEATRICAL, region, regionReleaseDateGte: daysFrom(today, -IN_CINEMAS_DAYS), regionReleaseDateLte: today } };
    case 'new-to-stream':
      return { media: 'movie', sort: 'popularity.desc', filters: { withReleaseType: DIGITAL, region, regionReleaseDateGte: daysFrom(today, -NEW_TO_STREAM_DAYS), regionReleaseDateLte: today } };
    // A show with an episode out in the next seven days.
    case 'airing-week':
      return { media: 'tv', sort: 'popularity.desc', filters: { airDateGte: today, airDateLte: daysFrom(today, 7) } };
    case 'upcoming':
      return { media: 'movie', sort: 'popularity.desc', filters: { withReleaseType: THEATRICAL, region, regionReleaseDateGte: daysFrom(today, 1), regionReleaseDateLte: daysFrom(today, UPCOMING_DAYS) } };
  }
}

export interface SeasonalList {
  id: 'halloween' | 'christmas' | 'true-story';
  /** TMDB keyword ids ("a|b": any of them). */
  keywords: string;
  title: MessageKey;
  sub: MessageKey;
}

/**
 * The seasonal row's list for the date: Halloween in October, Christmas in
 * December, and the rest of the year films based on a true story.
 */
export function seasonalList(now: Date): SeasonalList {
  const month = now.getMonth();
  // TMDB keywords: 3335 "halloween", 207317 "christmas", 9672 "based on true story".
  if (month === 9) return { id: 'halloween', keywords: '3335', title: 'pages.seasonal.halloween', sub: 'pages.seasonal.halloween-sub' };
  if (month === 11) return { id: 'christmas', keywords: '207317', title: 'pages.seasonal.christmas', sub: 'pages.seasonal.christmas-sub' };
  return { id: 'true-story', keywords: '9672', title: 'pages.seasonal.true-story', sub: 'pages.seasonal.true-story-sub' };
}

/** The seasonal row's query. */
export function seasonalQuery(list: SeasonalList, media: 'movie' | 'tv'): DiscoverQuery {
  // Enough votes that the list isn't led by obscure titles that merely carry the keyword.
  return { media, sort: 'popularity.desc', filters: { withKeywords: list.keywords, voteCountGte: media === 'movie' ? 50 : 20 } };
}
