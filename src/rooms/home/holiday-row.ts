/**
 * The holiday row (Settings → Appearance → Little extras → Seasonal touches):
 * while the title bar shows a season's glyph, Home has that season's TMDB list
 * ("Thanksgiving films", "Christmas films") after Continue Watching, headed
 * by the same glyph. Not when the person already added the time of year's
 * mood row to Home (it would be the same titles twice), nor without a TMDB
 * token. It comes and goes with the season and the switch, without a restart.
 */
import { t } from '../../i18n';
import { seasonalList } from '../../catalog/whats-new';
import { tmdbConnected } from '../../catalog/tmdb';
import { seasonGlyph, seasonNow } from '../../app/seasonal';
import type { Season } from '../../lib/fun';
import { moodTitles, styledRail } from './row-render';
import { homeLayout, type HomeLayout } from './rows';
import type { TitleActions } from './sections';

/**
 * Whether Home gets the holiday row: a season shown, and no time-of-year mood
 * row of the person's own (shown, or hidden on purpose).
 */
export function holidayRowShown(season: Season | null, layout: Pick<HomeLayout, 'added'>): boolean {
  if (!season) return false;
  return !layout.added.some((row) => row.source.kind === 'mood' && row.source.mood === 'seasonal');
}

let generation = 0;

/** Draws (or clears) the holiday row in `slot`. */
export async function renderHolidayRow(slot: HTMLElement, actions: TitleActions): Promise<void> {
  const current = ++generation;
  const season = seasonNow();
  const [layout, tmdb] = await Promise.all([homeLayout().catch(() => null), tmdbConnected().catch(() => false)]);
  if (current !== generation) return;
  if (!tmdb || !layout || !holidayRowShown(season, layout)) return void slot.replaceChildren();
  const shownSeason = season!;
  if (slot.dataset['season'] === shownSeason && slot.childElementCount) return;
  slot.dataset['season'] = shownSeason;
  const list = seasonalList(new Date());
  const row = styledRail({ title: t(list.title), source: t(list.sub), style: 'poster', load: () => moodTitles('seasonal', []) }, actions);
  row.classList.add('holiday-rail');
  row.querySelector('.rail-heading')?.prepend(seasonGlyph(shownSeason, false));
  slot.replaceChildren(row);
}
