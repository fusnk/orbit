/**
 * Release Radar → Upcoming: the Radar's episodes of the series you follow or
 * are partway through (calendar.ts loads them), as a list by day under
 * Today, This week and Later (see `upcomingGroups`). Each row opens the
 * series' page. Names and episode titles come from addons: text nodes only.
 */
import { premiere, upcomingGroups, type UpcomingGroup, type UpcomingRow } from '../../catalog/release-radar';
import type { Title } from '../../catalog/titles';
import { artImage } from '../../components/cards';
import { locale, t, tn } from '../../i18n';
import { formatClock } from '../../lib/clock';
import { h } from '../../lib/dom';
import { episodeName, hiddenFor } from '../../library/spoilers';
import { episodeState, newEpisodeCount } from '../../library/watch';
import { releaseCode, releaseId, type RadarItem } from './radar';

const GROUP_LABELS = { today: 'titles.common.today', week: 'radar.week.heading', later: 'radar.later.heading' } as const;

// In the interface language (not Windows'), like the rest of the Radar.
const weekdayLong = new Intl.DateTimeFormat(locale(), { weekday: 'long' });
const shortDate = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
const fullDate = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** What airs: one episode's code and name (or premiere), or the first episode's code and how many. */
function episodeLine(row: UpcomingRow<RadarItem>): string {
  const first = row.releases[0]!;
  const code = releaseCode(first);
  if (row.releases.length > 1) return `${code} · ${tn('upcoming.episodes', row.releases.length)}`;
  if (first.release.type !== 'episode') return code;
  const kind = premiere(first.release.season, first.release.number);
  if (kind) return `${code} · ${t(kind === 'series' ? 'radar.series-premiere' : 'radar.season-premiere')}`;
  const episode = first.release.episode;
  // Not watched yet, so its name follows the spoiler settings.
  return episode?.title ? `${code} · ${episodeName(episode.number, episode.title, hiddenFor('unwatched').title)}` : code;
}

function upcomingRow(row: UpcomingRow<RadarItem>, group: UpcomingGroup, openDetail: (title: Title) => void): HTMLElement {
  const first = row.releases[0]!;
  const title = first.title;
  const line = episodeLine(row);
  const fresh = newEpisodeCount(title.id);
  // An exact air time (catalog/air-times.ts) adds the time today and this week.
  const at = first.release.type === 'episode' && group !== 'later' ? first.release.at : undefined;
  const dayText = group === 'today' ? '' : group === 'week' ? weekdayLong.format(row.day) : shortDate.format(row.day);
  const whenText = at === undefined ? dayText : dayText ? `${dayText} · ${formatClock(at)}` : formatClock(at);
  const when = whenText ? h('time', { class: 'upcoming-when', datetime: at === undefined ? `${row.day.getFullYear()}-${String(row.day.getMonth() + 1).padStart(2, '0')}-${String(row.day.getDate()).padStart(2, '0')}` : new Date(at).toISOString() }, whenText) : '';
  const button = h(
    'button',
    { class: 'radar-row upcoming-row', 'data-focus-id': `calendar-upcoming-${releaseId(first)}`, title: `${title.name} · ${line} · ${fullDate.format(row.day)}` },
    title.poster ? artImage(title.poster, 'radar-row-poster') : h('span', { class: 'radar-row-poster' }),
    h('span', { class: 'radar-row-text' }, h('span', { class: 'radar-row-name' }, title.name), h('span', { class: 'radar-row-code' }, line)),
    // Episodes that already aired since it was last watched (library/watch.ts), still waiting.
    fresh ? h('span', { class: 'radar-out upcoming-new' }, tn('titles.library.new', fresh)) : '',
    when,
  );
  button.addEventListener('click', () => openDetail(title));
  return button;
}

/**
 * The list, from the followed series' dated episodes (undefined while they
 * load). Episodes already watched (e.g. early from another source) are left out.
 */
export function upcomingSection(episodes: readonly RadarItem[] | undefined, today: Date, actions: { openDetail(title: Title): void; go(room: string): void }): HTMLElement {
  if (!episodes) return h('p', { class: 'muted radar-note' }, t('titles.calendar.loading'));
  const unwatched = episodes.filter((r) => r.release.type === 'episode' && !(r.release.episode && episodeState(r.title, r.release.season, r.release.episode).kind === 'watched'));
  const groups = upcomingGroups(unwatched, today);
  if (!groups.length) {
    const browse = h('button', { class: 'button primary', 'data-focus-id': 'calendar-upcoming-browse' }, t('titles.library.browse-home'));
    browse.addEventListener('click', () => actions.go('home'));
    return h('div', { class: 'library-empty' }, h('span', { class: 'library-empty-title' }, t('upcoming.empty')), h('p', { class: 'muted' }, t('upcoming.empty-body')), h('div', { class: 'hero-actions' }, browse));
  }
  return h(
    'div',
    { class: 'upcoming' },
    ...groups.map(({ group, rows }) =>
      h(
        'section',
        { class: `upcoming-group ${group}`, 'aria-label': `${t(GROUP_LABELS[group])} (${rows.length})` },
        h('h2', { class: 'library-heading' }, t(GROUP_LABELS[group]), ' ', h('span', { class: 'radar-count' }, String(rows.length))),
        h('div', { class: 'upcoming-list' }, ...rows.map((row) => upcomingRow(row, group, actions.openDetail))),
      ),
    ),
  );
}
