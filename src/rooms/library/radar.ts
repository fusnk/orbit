/**
 * Release Radar's sections (calendar.ts puts them together): the featured
 * release, This week's day columns and the Coming soon row. Names, episode
 * titles and art come from addons and TMDB: text nodes and image sources only.
 */
import { airTimeLabel } from '../../catalog/air-times';
import { formatClock } from '../../lib/clock';
import { releaseMoment, type CalendarEvent } from '../../catalog/ical';
import { chipUntil, comingSoon, dayOffset, isOut, premiere, shortUntil, weekColumns, whenLine, type RadarRelease } from '../../catalog/release-radar';
import type { Episode, Title } from '../../catalog/titles';
import { artImage, backdropImage, posterCard, rail } from '../../components/cards';
import { openDrawer } from '../../components/drawer';
import { icon } from '../../components/icons';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { inLibrary, toggleLibrary } from '../../library/library';
import { episodeName, hiddenFor } from '../../library/spoilers';
import { createMyRating } from '../detail/my-rating';
import type { EpisodeRef } from '../detail/title-actions';

export type RadarItem = RadarRelease<Title, Episode>;

export interface RadarActions {
  openDetail(title: Title): void;
  /** Plays the film, the episode, or (a show TMDB listed) its next episode. */
  play(title: Title, episode?: EpisodeRef): void;
}

const KIND_LABELS = { cinema: 'calendar.kind.cinema', digital: 'calendar.kind.digital', physical: 'calendar.kind.physical' } as const;
/** Releases shown in a day's column before "+N more". */
const PER_COLUMN = 3;

const weekday = new Intl.DateTimeFormat(locale(), { weekday: 'short' });
const weekdayLong = new Intl.DateTimeFormat(locale(), { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' });
const fullDate = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dayLabel = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' });

/** "S1 · E1", or "Film". */
export const releaseCode = (r: RadarItem) => (r.release.type === 'episode' ? t('titles.common.episode-code', { season: r.release.season, episode: r.release.number }) : t('radar.film'));

/** A stable id for a release, for focus to find it again after a redraw. */
export const releaseId = (r: RadarItem) => `${r.title.id}:${r.release.type === 'episode' ? `${r.release.season}x${r.release.number}` : r.release.kind}`;

/** What the release is: the episode's title (unless spoiler settings hide it) or premiere, or the film's release type. */
function releaseLine(r: RadarItem): string {
  if (r.release.type === 'film') return `${t('radar.film')} · ${t(KIND_LABELS[r.release.kind])}`;
  const code = releaseCode(r);
  const first = premiere(r.release.season, r.release.number);
  const episode = r.release.episode;
  const name = first === 'series' ? t('radar.series-premiere') : first === 'season' ? t('radar.season-premiere') : episode?.title && episodeName(episode.number, episode.title, hiddenFor('unwatched').title);
  return name ? `${code} · ${name}` : code;
}

/**
 * The releases as calendar events (Export to calendar): "Show · S1 · E5 ·
 * Episode name", the name left out while spoiler settings hide unwatched
 * episodes' names; "Film · Cinema" for a film. All day, unless the episode's
 * metadata gives a time.
 */
export function calendarEvents(releases: readonly RadarItem[]): CalendarEvent[] {
  const hideNames = hiddenFor('unwatched').title;
  return releases.map((r) => {
    if (r.release.type === 'film') return { uid: releaseId(r), summary: `${r.title.name} · ${t(KIND_LABELS[r.release.kind])}`, day: r.day };
    const name = hideNames ? undefined : r.release.episode?.title;
    return { uid: releaseId(r), summary: [r.title.name, releaseCode(r), name].filter(Boolean).join(' · '), day: r.day, at: r.release.at !== undefined ? new Date(r.release.at) : releaseMoment(r.release.episode?.released) };
  });
}

function whenText(offset: number, day: Date, at?: number): string {
  // An exact air time (catalog/air-times.ts) still to come says when to the minute.
  if (at !== undefined && offset >= 0 && offset < 7) return airTimeLabel(at);
  const when = whenLine(offset, day);
  switch (when.key) {
    case 'today':
      return t('radar.when.today');
    case 'tomorrow':
      return t('radar.when.tomorrow');
    case 'weekday':
      return t('radar.when.weekday', { day: weekdayLong.format(when.day) });
    case 'date':
      return t('radar.when.date', { date: dayMonth.format(when.day) });
    case 'past':
      return t('radar.when.past', { ago: new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(-when.days, 'day') });
  }
}

/** The title's logo, or its name when there's none (or it doesn't load). */
function titleMark(title: Title): HTMLElement {
  const name = h('h3', { class: 'radar-featured-title' }, title.name);
  if (!title.logo) return name;
  const logo = h('img', { class: 'radar-featured-logo', src: title.logo, alt: title.name, decoding: 'async' });
  logo.addEventListener('error', () => logo.replaceWith(name), { once: true });
  return h('h3', { class: 'radar-featured-title has-logo' }, logo);
}

/** Your own stars for a title, in a drawer (as on its page). */
function openRating(title: Title): void {
  const rating = createMyRating(title);
  const done = h('button', { class: 'button primary' }, t('radar.done'));
  const close = openDrawer(h('div', { class: 'radar-rate' }, h('h2', { class: 'radar-rate-title' }, title.name), rating.element, h('div', { class: 'radar-rate-actions' }, done)), t('ratings.label'), rating.dispose);
  done.addEventListener('click', close);
  requestAnimationFrame(() => rating.element.querySelector<HTMLElement>('[role="slider"]')?.focus());
}

/** The featured release: today's or the next, over its backdrop. */
export function featuredCard(r: RadarItem, today: Date, actions: RadarActions): HTMLElement {
  const offset = dayOffset(today, r.day);
  // An episode airing later today isn't out yet: no Play until it is.
  const out = isOut(offset, r.release.type === 'episode' ? r.release.at : undefined);
  const button = (id: string, label: string, content: (Node | string)[], className = 'button glass') => h('button', { class: className, 'data-focus-id': `calendar-featured-${id}`, 'aria-label': label, title: label }, ...content);

  const main = out
    ? button('play', t('titles.actions.play'), [icon('play', { filled: true }), t('titles.actions.play')], 'button primary')
    : button('details', t('titles.actions.view-details'), [icon('info'), t('titles.actions.view-details')], 'button primary');
  const episode = r.release.type === 'episode' ? r.release : undefined;
  main.addEventListener('click', () => {
    if (!out) return actions.openDetail(r.title);
    actions.play(r.title, episode?.episode ? { season: episode.season, episode: episode.episode } : undefined);
  });
  const saved = inLibrary(r.title.id);
  const savedLabel = saved ? t('titles.actions.remove-library') : t('titles.actions.add-library');
  const watchlist = button('watchlist', savedLabel, [icon(saved ? 'check' : 'plus'), t('radar.watchlist')]);
  watchlist.setAttribute('aria-pressed', String(saved));
  // My Library's change redraws the Radar, and focus finds this button again.
  watchlist.addEventListener('click', () => void toggleLibrary(r.title));
  const rate = button('rate', t('ratings.rate'), [icon('star')], 'button glass icon-only');
  rate.addEventListener('click', () => openRating(r.title));
  const titleButton = h('button', { class: 'radar-featured-name', 'data-focus-id': 'calendar-featured-title', title: t('titles.actions.view-details') }, titleMark(r.title));
  titleButton.addEventListener('click', () => actions.openDetail(r.title));

  return h(
    'section',
    { class: 'radar-featured', 'aria-label': t('radar.featured') },
    h('div', { class: 'radar-featured-art', 'aria-hidden': 'true' }, backdropImage(r.title, 'radar-featured-image', true)),
    h(
      'div',
      { class: 'radar-featured-body' },
      h('div', { class: 'radar-chips' }, h('span', { class: 'radar-chip accent' }, out ? t('calendar.films.out-now') : (chipUntil(offset, locale()) ?? t('titles.common.today'))), h('span', { class: 'radar-chip' }, releaseCode(r))),
      titleButton,
      h('p', { class: 'radar-featured-line' }, releaseLine(r)),
      h('p', { class: 'radar-featured-when' }, whenText(offset, r.day, r.release.type === 'episode' ? r.release.at : undefined)),
      h('p', { class: 'radar-featured-date' }, fullDate.format(r.day)),
      h('div', { class: 'radar-actions' }, main, watchlist, rate),
    ),
  );
}

/** A compact release in a day's column: poster, name, episode or "Film", its air time when known, and "Out" once it is. */
function weekRow(r: RadarItem, today: boolean, openDetail: (title: Title) => void): HTMLElement {
  const at = r.release.type === 'episode' ? r.release.at : undefined;
  // Today's releases are out, unless an exact air time says it's still to come.
  const out = today && isOut(0, at);
  const row = h(
    'button',
    { class: 'radar-row', 'data-focus-id': `calendar-week-${releaseId(r)}`, title: `${r.title.name} · ${releaseLine(r)}` },
    r.title.poster ? artImage(r.title.poster, 'radar-row-poster') : h('span', { class: 'radar-row-poster' }),
    h('span', { class: 'radar-row-text' }, h('span', { class: 'radar-row-name' }, r.title.name), h('span', { class: 'radar-row-code' }, releaseCode(r), at !== undefined && !out ? ` · ${formatClock(at)}` : '', out ? h('span', { class: 'radar-out' }, t('radar.out')) : '')),
  );
  row.addEventListener('click', () => openDetail(r.title));
  return row;
}

/** This week: a column per day from today, each with its count and first few releases; "+N more" opens a column. */
export function weekSection(releases: readonly RadarItem[], today: Date, expanded: Set<number>, onToggle: () => void, openDetail: (title: Title) => void): HTMLElement {
  const columns = weekColumns(releases, today).map(({ day, offset, releases: onDay }) => {
    const open = expanded.has(offset);
    const shown = open ? onDay : onDay.slice(0, PER_COLUMN);
    const more =
      onDay.length > PER_COLUMN ? h('button', { class: 'radar-more', 'data-focus-id': `calendar-more-${offset}`, 'aria-expanded': String(open) }, open ? t('radar.less') : t('titles.calendar.more', { count: onDay.length - PER_COLUMN })) : '';
    if (more) {
      more.addEventListener('click', () => {
        if (open) expanded.delete(offset);
        else expanded.add(offset);
        onToggle();
      });
    }
    return h(
      'div',
      { class: `radar-day${offset === 0 ? ' today' : ''}`, role: 'group', 'aria-label': `${offset === 0 ? t('titles.common.today') : dayLabel.format(day)} (${onDay.length})` },
      h('div', { class: 'radar-day-head' }, h('span', { class: 'radar-day-name' }, offset === 0 ? t('titles.common.today') : weekday.format(day)), h('span', { class: 'radar-count' }, String(onDay.length))),
      ...(shown.length ? shown.map((r) => weekRow(r, offset === 0, openDetail)) : [h('span', { class: 'radar-none' }, t('radar.week.none'))]),
      more,
    );
  });
  return h('section', { class: 'radar-week' }, h('h2', { class: 'library-heading' }, t('radar.week.heading')), h('div', { class: 'radar-days' }, ...columns));
}

/** Coming soon: posters after this week with "in 2w" badges; "See all" goes to the month grid. */
export function soonSection(releases: readonly RadarItem[], today: Date, openDetail: (title: Title) => void, onSeeAll: () => void): HTMLElement | '' {
  const soon = comingSoon(releases, today);
  if (!soon.length) return '';
  const row = rail({
    title: t('radar.soon.heading'),
    onSeeAll,
    cards: soon.map((r) => {
      const card = posterCard(r.title, () => openDetail(r.title), { badge: shortUntil(dayOffset(today, r.day), locale()) });
      card.title = `${r.title.name} · ${releaseLine(r)} · ${fullDate.format(r.day)}`;
      return card;
    }),
  });
  row.classList.add('radar-soon');
  row.querySelector('.rail-heading')?.append(' ', h('span', { class: 'radar-count' }, String(soon.length)));
  return row;
}
