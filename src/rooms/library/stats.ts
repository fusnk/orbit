/**
 * My Library → Stats: totals, a month-by-month chart, top genres and shows,
 * and watching habits, for this year, the last 12 months or all time. All
 * worked out on this device from watch history (library/stats).
 */
import { shownNow } from '../../catalog/parental';
import { fallbackHue, type Title } from '../../catalog/titles';
import { artImage, withHue } from '../../components/cards';
import { locale, t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { fillMissingGenres } from '../../library/genre-fill';
import { computeStats, hasActivity, type StatsRange, type WatchStats } from '../../library/stats';
import { watchHistory } from '../../library/watch';
import { hourLabel, hoursOf, openYearReview, weekday } from './review';

const RANGES: { id: StatsRange; label: string }[] = [
  { id: 'year', label: t('insights.stats.range-year') },
  { id: '12m', label: t('insights.stats.range-12m') },
  { id: 'all', label: t('insights.stats.range-all') },
];

const number = (n: number) => n.toLocaleString(locale());
const monthShort = new Intl.DateTimeFormat(locale(), { month: 'short' });
const monthLong = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' });

export interface StatsOptions {
  range: StatsRange;
  onRange(range: StatsRange): void;
  openDetail(title: Title): void;
  onBrowse(): void;
  /** Draws the page again: once the ratings of titles still being looked up for the content limit are in. */
  redraw(): void;
}

/** Top shows and titles the profile's content limit allows: History leaves the rest out, so these do too (counts still include them). */
function allowed(stats: WatchStats, redraw: () => void): WatchStats {
  const shown = <T extends { title: Title }>(list: T[]) => shownNow(list, (entry) => entry.title, redraw);
  return { ...stats, shows: shown(stats.shows), top: shown(stats.top) };
}

export function createStats(options: StatsOptions): HTMLElement {
  const history = watchHistory();
  if (!hasActivity(computeStats(history, 'all'))) return teach(options.onBrowse);

  const now = new Date();
  const stats = allowed(computeStats(history, options.range, now), options.redraw);
  const thisYear = options.range === 'year' ? stats : allowed(computeStats(history, 'year', now), options.redraw);

  const ranges = h(
    'div',
    { class: 'segments', role: 'group', 'aria-label': t('insights.stats.range') },
    ...RANGES.map((range) => {
      const button = h('button', { class: 'segment', 'aria-pressed': String(range.id === options.range), 'data-focus-id': `stats-range-${range.id}` }, range.label);
      button.addEventListener('click', () => options.onRange(range.id));
      return button;
    }),
  );
  const review = h('button', { class: 'button glass', hidden: !hasActivity(thisYear) }, t('insights.review.title', { year: String(now.getFullYear()) }));
  review.addEventListener('click', () => openYearReview(now.getFullYear(), thisYear));

  const bar = h('div', { class: 'stats-bar' }, ranges, review);
  if (!hasActivity(stats)) {
    const all = h('button', { class: 'button glass' }, t('insights.stats.show-all'));
    all.addEventListener('click', () => options.onRange('all'));
    return h('div', { class: 'stats' }, bar, h('div', { class: 'library-empty' }, h('span', { class: 'library-empty-title' }, t('insights.stats.none-in-range')), h('p', { class: 'muted' }, t('insights.stats.none-in-range-body')), h('div', { class: 'hero-actions' }, all)));
  }

  // Imported history often lacks genres: look some up in the background (the page redraws when they're saved).
  if (stats.missingGenres) void fillMissingGenres();
  const hours = hoursOf(stats.minutes);
  return h(
    'div',
    { class: 'stats' },
    bar,
    h(
      'div',
      { class: 'stats-tiles' },
      tile(number(stats.movies), tn('insights.stats.movies', stats.movies)),
      tile(number(stats.episodes), tn('insights.stats.episodes', stats.episodes)),
      tile(number(hours), tn('insights.stats.hours', hours)),
      tile(number(stats.streak), tn('insights.stats.streak', stats.streak)),
    ),
    stats.estimated ? h('p', { class: 'stats-note muted' }, t('insights.stats.estimated')) : '',
    section(options.range === 'year' ? t('insights.stats.by-month-year', { year: String(now.getFullYear()) }) : t('insights.stats.by-month'), chart(stats)),
    h(
      'div',
      { class: 'stats-columns' },
      section(t('insights.stats.top-genres'), genres(stats)),
      section(t('insights.stats.top-shows'), shows(stats, options.openDetail)),
    ),
    section(t('insights.stats.habits'), habits(stats)),
  );
}

/** For people with no history yet: what fills this page, and how. */
function teach(onBrowse: () => void): HTMLElement {
  const browse = h('button', { class: 'button large primary' }, t('titles.library.browse-home'));
  browse.addEventListener('click', onBrowse);
  return h(
    'div',
    { class: 'library-empty' },
    h('span', { class: 'library-empty-title' }, t('insights.stats.empty')),
    h('p', { class: 'muted' }, t('insights.stats.empty-body')),
    h('p', { class: 'muted' }, t('insights.stats.empty-private')),
    h('div', { class: 'hero-actions' }, browse),
  );
}

function tile(value: string, label: string): HTMLElement {
  return h('div', { class: 'stats-tile' }, h('span', { class: 'stats-tile-value' }, value), h('span', { class: 'stats-tile-label' }, label));
}

function section(heading: string, content: HTMLElement): HTMLElement {
  return h('section', { class: 'library-section' }, h('h2', { class: 'library-heading' }, heading), content);
}

/**
 * Hours per month as bars. A timeline, so it runs left to right in every
 * language; each month is a list item whose label carries the value.
 */
function chart(stats: WatchStats): HTMLElement {
  const peak = Math.max(...stats.months.map((m) => m.minutes), 1);
  return h(
    'ol',
    { class: 'stats-chart', dir: 'ltr' },
    ...stats.months.map((month) => {
      const date = new Date(month.start);
      const hours = hoursOf(month.minutes);
      const value = tn('insights.stats.hours-value', hours);
      const fill = h('span', { class: 'stats-chart-fill' });
      fill.style.height = `${(month.minutes / peak) * 100}%`;
      return h(
        'li',
        { class: 'stats-chart-month', 'aria-label': t('insights.stats.month-value', { month: monthLong.format(date), value }) },
        h('span', { class: 'stats-chart-value', 'aria-hidden': 'true' }, month.minutes ? number(hours) : ''),
        h('span', { class: 'stats-chart-track', 'aria-hidden': 'true' }, fill),
        h('span', { class: 'stats-chart-label', 'aria-hidden': 'true' }, monthShort.format(date)),
      );
    }),
  );
}

function genres(stats: WatchStats): HTMLElement {
  if (!stats.genres.length) return h('p', { class: 'muted' }, t('insights.stats.no-genres'));
  const peak = stats.genres[0]!.count;
  const list = h(
    'ol',
    { class: 'stats-list' },
    ...stats.genres.map(({ genre, count }) => {
      const fill = h('span', { class: 'stats-meter-fill' });
      fill.style.inlineSize = `${(count / peak) * 100}%`;
      return h(
        'li',
        { class: 'stats-genre' },
        h('span', { class: 'stats-genre-name' }, genre),
        h('span', { class: 'stats-meter', 'aria-hidden': 'true' }, fill),
        h('span', { class: 'stats-count' }, tn('insights.stats.titles', count)),
      );
    }),
  );
  return stats.missingGenres ? h('div', {}, list, h('p', { class: 'stats-genres-note muted' }, t('insights.stats.genres-incomplete'))) : list;
}

function shows(stats: WatchStats, openDetail: (title: Title) => void): HTMLElement {
  if (!stats.shows.length) return h('p', { class: 'muted' }, t('insights.stats.no-shows'));
  return h(
    'ol',
    { class: 'stats-list' },
    ...stats.shows.map(({ title, episodes }) => {
      const button = h(
        'button',
        { class: 'stats-show', 'data-focus-id': `stats-show:${title.id}` },
        withHue(h('span', { class: 'stats-show-art', 'aria-hidden': 'true' }, title.poster ? artImage(title.poster, 'art') : ''), fallbackHue(title.id)),
        h('span', { class: 'stats-show-name' }, title.name),
        h('span', { class: 'stats-count' }, tn('insights.stats.episodes-count', episodes)),
      );
      button.addEventListener('click', () => openDetail(title));
      return h('li', {}, button);
    }),
  );
}

function habits(stats: WatchStats): HTMLElement {
  const fact = (label: string, value: string) => h('div', { class: 'stats-fact' }, h('dt', {}, label), h('dd', {}, value));
  return h(
    'dl',
    { class: 'stats-facts' },
    stats.busiestWeekday !== null ? fact(t('insights.stats.busiest-day'), weekday(stats.busiestWeekday)) : '',
    stats.busiestHour !== null ? fact(t('insights.stats.busiest-hour'), hourLabel(stats.busiestHour)) : '',
    fact(t('insights.stats.days'), tn('insights.stats.days-value', stats.days)),
  );
}
