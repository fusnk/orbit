/**
 * My Library → Release Radar (the tab once called Calendar): what comes out
 * when. For you: episodes of the series you follow (saved in My Library, or
 * watched) by air date, and the cinema / digital / physical releases of
 * recent films saved in My Library (from TMDB, with a token). Matched adds
 * TMDB's new and upcoming titles in your favourite genres; Everything adds
 * what's popular too. Drawn as the featured release, This week, Coming soon
 * and, under Later, the month grid. The Upcoming layout lists the followed
 * series' episodes instead (upcoming.ts).
 *
 * Episode lists come from the catalog addons (Cinemeta), fetched once per
 * session for up to 40 series; see release-dates.ts for the films.
 */
import type { GenreKey } from '../../catalog/explore';
import { allowedTitles } from '../../catalog/parental';
import { calendarDay, calendarFilms, CALENDAR_SHOWS, parseCalendarFilter, RELEASE_KINDS, showsFilms, type CalendarFilter, type FilmRelease } from '../../catalog/release-calendar';
import { discoveredReleases, savedFilmReleases, type Discovered } from '../../catalog/release-dates';
import { episodeDay, featuredRelease, RADAR_SCOPES, radarReleases, upcomingCount, type RadarRank, type RadarScope } from '../../catalog/release-radar';
import { airTimesOn, exactAirTime, loadAirTimes } from '../../catalog/air-times';
import { loadMeta } from '../../catalog/service';
import { favouriteGenres, taste } from '../../catalog/taste';
import { isShowType, type Title } from '../../catalog/titles';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { buildCalendar } from '../../catalog/ical';
import { icon } from '../../components/icons';
import { toast } from '../../components/toast';
import { connectTmdbButton, errorText, retryWhenOnline } from '../../components/state-message';
import { settings, withDialog } from '../../lib/ipc';
import { settleWithin } from '../../lib/timeout';
import { firstDayOfWeek, leadingDays, weekdayOrder } from '../../lib/week-start';
import { libraryEntries } from '../../library/library';
import { profileSetting } from '../../library/profiles';
import { episodeName, hiddenFor } from '../../library/spoilers';
import { recentlyWatched } from '../../library/watch';
import { calendarEvents, featuredCard, releaseCode, soonSection, weekSection, type RadarActions, type RadarItem } from './radar';
import { upcomingSection } from './upcoming';
import { reducedMotion } from '../../theme/appearance';

const MAX_SERIES = 40;
/** A series' metadata that hasn't come after this is left out (the addon's own limits apply too). */
const META_TIMEOUT_MS = 20_000;
/** Releases shown in a month day's cell before "+N more". */
const PER_DAY = 3;
/** profiles.rs `PROFILE_SETTINGS`. */
const FILTER_KEY = 'calendar.filter';
/** Titles read for Matched's favourite genres, and how many of those genres it asks TMDB for. */
const TASTE_SAMPLE = 60;
const MATCHED_GENRES = 3;

/** The series to follow: saved ones first, then recently watched; ids only. */
function followedSeries(): Title[] {
  const seen = new Set<string>();
  return [...libraryEntries().map((e) => e.title), ...recentlyWatched()].filter((t) => isShowType(t.type) && !seen.has(t.id) && seen.add(t.id)).slice(0, MAX_SERIES);
}

/** Whether Release Radar has anything to look up (followed series, saved films): its tab shows while it does. */
export const calendarSources = () =>
  followedSeries().length +
  calendarFilms(
    libraryEntries().map((e) => e.title),
    new Date(),
  ).length;

/** Your releases from today on, as the Radar last worked them out; undefined until it has the episodes. */
let upcoming: number | undefined;
/** What the Release Radar tab counts: your releases coming (see `upcomingCount`), once known. */
export const calendarCount = (): number | undefined => upcoming;

let cache: { key: string; airings: Promise<RadarItem[]> } | null = null;

/** Every dated episode of the followed series, as For you releases; asked again each day, as addons add episodes. */
function airings(): Promise<RadarItem[]> {
  const series = followedSeries();
  // Turning exact air times on or off (Settings) changes every episode's time: asked again.
  const key = `${new Date().toDateString()}:${airTimesOn()}:${series.map((t) => t.id).join()}`;
  if (cache?.key !== key) {
    // A show whose details didn't come (offline, timed out) isn't remembered as having none: the next draw asks again.
    // Only shows this profile may watch (its content limit): the Radar doesn't name the rest.
    const load = allowedTitles(series).then((allowed) => Promise.all(
      allowed.map(async (t) => {
        const full = await settleWithin(loadMeta(t.type, t.id), META_TIMEOUT_MS, null);
        // Exact air times, when they're looked up (Settings → General → Notifications).
        if (full) await settleWithin(loadAirTimes(full), META_TIMEOUT_MS, false);
        return full;
      }),
    )).then((metas) => {
      if (metas.includes(null) && cache?.airings === load) cache = null;
      return metas.flatMap((full) =>
        (full?.seasons ?? [])
          .filter((s) => s.number > 0)
          .flatMap((s) =>
            s.episodes.flatMap((episode): RadarItem[] => {
              const exact = exactAirTime(full!.id, s.number, episode.number, episode.released);
              const day = episodeDay(episode.released, exact);
              if (!day) return [];
              return [{ title: full!, day, rank: 0, release: { type: 'episode', season: s.number, number: episode.number, episode, at: exact } }];
            }),
          ),
      );
    });
    cache = { key, airings: load };
  }
  return cache.airings;
}

const filmItems = (films: readonly FilmRelease<Title>[], rank: RadarRank): RadarItem[] => films.map((f) => ({ title: f.title, day: f.day, rank, release: { type: 'film', kind: f.kind } }));

/** TMDB's titles as Radar releases. */
function discoveredItems(found: Discovered, rank: RadarRank): RadarItem[] {
  const premieres = found.premieres.flatMap((show): RadarItem[] => {
    const day = calendarDay(show.released?.slice(0, 10) ?? '');
    return day ? [{ title: show, day, rank, release: { type: 'episode', season: 1, number: 1 } }] : [];
  });
  return [...filmItems(found.films, rank), ...premieres];
}

/** A load's state: under way, no TMDB token, failed, nothing to match (Matched), or its releases. */
type Loaded = 'loading' | 'connect' | 'error' | 'no-taste' | RadarItem[];

/**
 * What the Radar knew when it last drew. My Library redraws the tab whenever
 * the library or history changes; drawing what's known at once (then
 * refreshing) keeps the page's height, so its scroll position, in place.
 */
const known: { filter?: CalendarFilter; episodes?: RadarItem[]; films?: Loaded; matched?: Loaded; popular?: Loaded } = {};
/** This week's opened columns, by day offset; kept while Orbit runs. */
const expanded = new Set<number>();
/** Why the last lookup failed, for the line under "Couldn't load…". */
let lastError: unknown = null;
/** The Radar's layout: the overview, or Upcoming's list of episodes (upcoming.ts); kept while Orbit runs. */
const VIEWS = ['radar', 'upcoming'] as const;
type RadarView = (typeof VIEWS)[number];
let view: RadarView = 'radar';
/** Where the page was scrolled in each layout, put back on switching to it. */
const scrolled: Partial<Record<RadarView, number>> = {};

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const monthName = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' });
const dayName = new Intl.DateTimeFormat(locale(), { weekday: 'short', month: 'short', day: 'numeric' });
/**
 * One day of the month grid: its date, the first few of its releases and, when there are more,
 * a "+N more" button (focusable like the chips, keyed by its date) that shows the rest in place.
 */
export function dayCell(classes: string, day: Date, chips: HTMLElement[]): HTMLElement {
  const cell = h('div', { class: classes }, h('span', { class: 'calendar-date' }, String(day.getDate())), ...chips.slice(0, PER_DAY));
  const rest = chips.slice(PER_DAY);
  if (rest.length) {
    const more = h('button', { class: 'calendar-more', 'data-focus-id': `calendar-more:${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}` }, t('titles.calendar.more', { count: rest.length }));
    more.addEventListener('click', () => {
      more.replaceWith(...rest);
      rest[0]!.focus({ preventScroll: true });
    });
    cell.append(more);
  }
  return cell;
}

/** The grid's weeks start on the day the person's region does (Monday for most, Sunday in the US…). */
const FIRST_DAY = firstDayOfWeek(locale());
/** Short weekday names in grid order, in the interface language (4 Jan 1970 was a Sunday). */
const WEEKDAYS = weekdayOrder(FIRST_DAY).map((day) => new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(1970, 0, 4 + day)));
const SCOPE_LABELS = { 'for-you': 'radar.scope.for-you', matched: 'radar.scope.matched', everything: 'radar.scope.everything' } as const;
const SHOW_LABELS = { all: 'calendar.filter.all', episodes: 'calendar.filter.episodes', movies: 'calendar.filter.movies' } as const;
const KIND_LABELS = { cinema: 'calendar.kind.cinema', digital: 'calendar.kind.digital', physical: 'calendar.kind.physical' } as const;
const VIEW_LABELS = { radar: 'radar.view.radar', upcoming: 'radar.view.upcoming' } as const;

/** The Radar: header and scope, filters, featured release, This week, Coming soon, then the month grid. `month` is any date in the month shown. */
export function createCalendar(options: RadarActions & { month: Date; onMonth(month: Date): void; focusId?: string | undefined; go(room: string): void; onCount?(count: number): void }): HTMLElement {
  const element = h('div', { class: 'calendar radar' }, h('p', { class: 'muted' }, t('titles.calendar.loading')));
  let filter = known.filter;
  let filterKey = FILTER_KEY;
  /** The filter control the calendar this replaces had focused: focused once drawn, if focus hasn't gone elsewhere. */
  let pendingFocus = options.focusId;
  /** Titles turned down on Discover (thumbs down, not interested): never suggested here either. */
  let skip: ReadonlySet<string> = new Set();
  /** The releases the Radar shows now, for Export to calendar. */
  let shown: RadarItem[] = [];

  void profileSetting(FILTER_KEY).then(({ key, value }) => {
    filterKey = key;
    // Only the first read decides: a scope picked since (in this Radar or the one it replaced) is newer than what was read.
    filter = known.filter ??= parseCalendarFilter(value);
    load(filter);
    draw();
  });
  void airings().then((all) => {
    known.episodes = all;
    draw();
  });
  void taste()
    .then((saved) => (skip = new Set([...saved.down, ...saved.hidden])))
    .catch(() => {})
    .then(draw);

  /** Starts the lookups a filter needs (each is remembered, so asking again is cheap). */
  function load(current: CalendarFilter): void {
    const yours = current.scope !== 'matched';
    if (yours && showsFilms(current)) {
      known.films ??= 'loading';
      savedFilmReleases(libraryEntries().map((e) => e.title)).then(
        (found) => {
          known.films = found ? filmItems(found, 0) : 'connect';
          draw();
        },
        (err: unknown) => {
          console.warn('Could not load film release dates', err);
          lastError = err;
          known.films = 'error';
          draw();
        },
      );
    }
    if (current.scope !== 'for-you') loadDiscovered('matched');
    if (current.scope === 'everything') loadDiscovered('popular');
  }

  function loadDiscovered(which: 'matched' | 'popular'): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let genres: GenreKey[] = [];
    if (which === 'matched') {
      genres = favouriteGenres([
        ...recentlyWatched().slice(0, TASTE_SAMPLE),
        ...libraryEntries()
          .slice(0, TASTE_SAMPLE)
          .map((e) => e.title),
      ]).slice(0, MATCHED_GENRES);
      if (!genres.length) {
        known.matched = 'no-taste';
        return;
      }
    }
    known[which] ??= 'loading';
    discoveredReleases(genres, today).then(
      (found) => {
        known[which] = found ? discoveredItems(found, which === 'matched' ? 1 : 2) : 'connect';
        draw();
      },
      (err: unknown) => {
        console.warn('Could not load upcoming releases', err);
        lastError = err;
        known[which] = 'error';
        draw();
      },
    );
  }

  function setFilter(next: CalendarFilter): void {
    filter = known.filter = next;
    load(next);
    settings.set(filterKey, next).catch((err: unknown) => console.warn('Could not save the Release Radar filter', err));
    draw();
  }

  const open = (button: HTMLElement, title: Title) => {
    button.addEventListener('click', () => options.openDetail(title));
    return button;
  };
  const kindTag = (kind: keyof typeof KIND_LABELS) => h('span', { class: `calendar-tag ${kind}` }, t(KIND_LABELS[kind]));
  const entryChip = (r: RadarItem) =>
    r.release.type === 'episode'
      ? open(
          h(
            'button',
            { class: 'calendar-chip', 'data-focus-id': `calendar-chip:${r.title.id}:${releaseCode(r)}`, title: `${r.title.name} · ${releaseCode(r)}${r.release.episode ? ` · ${episodeName(r.release.episode.number, r.release.episode.title, hiddenFor('unwatched').title)}` : ''}` },
            h('span', { class: 'calendar-show' }, r.title.name),
            h('span', { class: 'calendar-ep' }, releaseCode(r)),
          ),
          r.title,
        )
      : open(h('button', { class: 'calendar-chip calendar-chip-film', 'data-focus-id': `calendar-chip:${r.title.id}:${r.release.kind}`, title: `${r.title.name} · ${t(KIND_LABELS[r.release.kind])} · ${dayName.format(r.day)}` }, h('span', { class: 'calendar-show' }, r.title.name), kindTag(r.release.kind)), r.title);

  /** Switches layout, each keeping its own scroll position. */
  function setView(next: RadarView): void {
    if (next === view) return;
    const scroller = element.closest<HTMLElement>('.outlet');
    if (scroller) scrolled[view] = scroller.scrollTop;
    view = next;
    draw();
    const top = scrolled[next];
    if (scroller && top !== undefined) scroller.scrollTop = top;
  }

  function header(current: CalendarFilter): HTMLElement {
    const views = VIEWS.map((id) => {
      const button = h('button', { class: 'segment', 'aria-pressed': String(view === id), 'data-focus-id': `calendar-view-${id}` }, t(VIEW_LABELS[id]));
      button.addEventListener('click', () => setView(id));
      return button;
    });
    // Upcoming is For you's episodes only, so the scopes are the overview's.
    const scopes =
      view === 'radar'
        ? h(
            'div',
            { class: 'segments radar-scopes', role: 'group', 'aria-label': t('radar.scope.label') },
            ...RADAR_SCOPES.map((scope: RadarScope) => {
              const button = h('button', { class: 'segment', 'aria-pressed': String(current.scope === scope), 'data-focus-id': `calendar-scope-${scope}` }, t(SCOPE_LABELS[scope]));
              button.addEventListener('click', () => setFilter({ ...current, scope }));
              return button;
            }),
          )
        : '';
    // Saves what the Radar shows (this scope and filter) as an .ics file for any calendar app.
    const exportButton =
      view === 'radar'
        ? h('button', { class: 'button glass small', 'data-focus-id': 'calendar-export', disabled: !shown.length, title: t('radar.export.hint') }, icon('download'), t('radar.export'))
        : '';
    if (exportButton) {
      exportButton.addEventListener('click', () => {
        const text = buildCalendar(calendarEvents(shown), t('radar.export.name'), new Date());
        void withDialog('calendar_export_save', { text })
          .then((path) => path && toast(t('settings.common.saved-to', { path })))
          .catch((err: unknown) => toast(errorText(err)));
      });
    }
    return h(
      'header',
      { class: 'radar-head' },
      h('div', { class: 'radar-titles' }, h('span', { class: 'radar-eyebrow' }, t('radar.eyebrow')), h('h2', { class: 'radar-heading' }, t('radar.heading')), h('p', { class: 'radar-sub' }, t(view === 'radar' ? 'radar.subtitle' : 'upcoming.subtitle'))),
      h('div', { class: 'radar-head-controls' }, h('div', { class: 'segments radar-views', role: 'group', 'aria-label': t('radar.view.label') }, ...views), scopes, exportButton),
    );
  }

  function filters(current: CalendarFilter): HTMLElement {
    const shows = CALENDAR_SHOWS.map((show) => {
      const button = h('button', { class: 'segment', 'aria-pressed': String(current.show === show), 'data-focus-id': `calendar-show-${show}` }, t(SHOW_LABELS[show]));
      button.addEventListener('click', () => setFilter({ ...current, show }));
      return button;
    });
    const kinds = RELEASE_KINDS.map((kind) => {
      const on = current.kinds.includes(kind);
      const chip = h('button', { class: 'chip', 'aria-pressed': String(on), 'data-focus-id': `calendar-kind-${kind}` }, t(KIND_LABELS[kind]));
      chip.addEventListener('click', () => setFilter({ ...current, kinds: RELEASE_KINDS.filter((k) => (k === kind ? !on : current.kinds.includes(k))) }));
      return chip;
    });
    return h(
      'div',
      { class: 'calendar-filters' },
      h('div', { class: 'segments', role: 'group', 'aria-label': t('calendar.filter.label') }, ...shows),
      showsFilms(current) ? h('div', { class: 'chips', role: 'group', 'aria-label': t('calendar.filter.kinds') }, ...kinds) : '',
    );
  }

  /** What's still loading or missing for the scope shown, one line each. */
  function notes(current: CalendarFilter): HTMLElement[] {
    const lines = new Set<string>();
    const yours = current.scope !== 'matched';
    if (yours && !known.episodes && current.show !== 'movies') lines.add(t('titles.calendar.loading'));
    if (yours && showsFilms(current)) {
      if (!current.kinds.length) lines.add(t('calendar.films.no-kinds'));
      else if (known.films === 'loading' || known.films === undefined) lines.add(t('calendar.films.loading'));
      else if (known.films === 'connect') lines.add(t('calendar.films.connect'));
      else if (known.films === 'error') lines.add(t('calendar.films.error'));
    }
    const found = current.scope === 'for-you' ? [] : current.scope === 'matched' ? [known.matched] : [known.matched, known.popular];
    for (const state of found) {
      if (state === 'loading' || state === undefined) lines.add(t('radar.loading'));
      else if (state === 'connect') lines.add(t('radar.connect'));
      else if (state === 'error') lines.add(t('radar.error'));
      else if (state === 'no-taste' && current.scope === 'matched') lines.add(t('radar.matched.empty'));
    }
    const shown = [known.films, ...found];
    const out: HTMLElement[] = [...lines].map((line) => h('p', { class: 'muted radar-note' }, line));
    // Each line says what's missing; one action says what to do about it.
    if (shown.includes('error')) {
      out.push(h('p', { class: 'muted radar-note' }, errorText(lastError)));
      const retry = h('button', { class: 'button small', 'data-focus-id': 'radar-retry' }, t('browse.search.retry'));
      retry.addEventListener('click', retryFailed);
      retryWhenOnline(retry, retryFailed);
      out.push(h('div', { class: 'radar-note-actions' }, retry));
    } else if (shown.includes('connect')) out.push(h('div', { class: 'radar-note-actions' }, connectTmdbButton(options.go)));
    return out;
  }

  /** Asks again for whatever failed (each lookup is otherwise remembered). */
  function retryFailed(): void {
    if (!filter) return;
    if (known.films === 'error') delete known.films;
    if (known.matched === 'error') delete known.matched;
    if (known.popular === 'error') delete known.popular;
    load(filter);
    draw();
  }

  /** Draws what's known so far, keeping keyboard focus on the same control. */
  function draw(): void {
    if (!filter) return;
    const current = filter;
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    const focusId = active instanceof HTMLElement && element.contains(active) ? active.dataset.focusId : lost ? pendingFocus : undefined;
    pendingFocus = undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // A redraw replaced the focused control: focus its replacement.
    const refocus = () => {
      if (focusId && !element.contains(document.activeElement)) element.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
    };
    const items = (state: Loaded | undefined) => (Array.isArray(state) ? state : undefined);
    if (known.episodes) {
      const count = upcomingCount([...known.episodes, ...(items(known.films) ?? [])], current, today);
      if (count !== upcoming) {
        upcoming = count;
        options.onCount?.(count);
      }
    }
    if (view === 'upcoming') {
      element.replaceChildren(header(current), upcomingSection(known.episodes, today, options));
      refocus();
      return;
    }
    const matched = items(known.matched)?.filter((r) => !skip.has(r.title.id));
    const popular = items(known.popular)?.filter((r) => !skip.has(r.title.id));
    const releases = radarReleases(current.scope, { forYou: [...(known.episodes ?? []), ...(items(known.films) ?? [])], matched, popular }, current);
    shown = releases;
    const featured = featuredRelease(releases, today);

    // Month grid, weeks from the region's first day.
    const first = new Date(options.month.getFullYear(), options.month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - leadingDays(first, FIRST_DAY));
    const cells: HTMLElement[] = [];
    for (let i = 0; i < 42; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (i >= 35 && day.getMonth() !== first.getMonth()) break;
      const onDay = releases.filter((r) => sameDay(r.day, day));
      cells.push(dayCell(`calendar-day${day.getMonth() === first.getMonth() ? '' : ' outside'}${sameDay(day, today) ? ' today' : ''}${day < today ? ' past' : ''}`, day, onDay.map(entryChip)));
    }

    const nav = (by: number, text: string, aria: string, id: string) => {
      const button = h('button', { class: 'button glass small', 'aria-label': aria, 'data-focus-id': `calendar-month-${id}` }, text);
      button.addEventListener('click', () => options.onMonth(new Date(first.getFullYear(), first.getMonth() + by, 1)));
      return button;
    };
    const todayButton = h('button', { class: 'button glass small', 'data-focus-id': 'calendar-month-today' }, t('titles.common.today'));
    todayButton.addEventListener('click', () => options.onMonth(new Date()));
    const later = h(
      'section',
      { class: 'radar-later' },
      h(
        'div',
        { class: 'calendar-header' },
        h('h2', { class: 'library-heading' }, t('radar.later.heading'), h('span', { class: 'radar-month' }, monthName.format(first))),
        h('div', { class: 'calendar-nav' }, nav(-1, '‹', t('titles.calendar.previous'), 'previous'), todayButton, nav(1, '›', t('titles.calendar.next'), 'next')),
      ),
      h('div', { class: 'calendar-weekdays', 'aria-hidden': 'true' }, ...WEEKDAYS.map((d) => h('span', {}, d))),
      h('div', { class: 'calendar-grid' }, ...cells),
    );
    const seeAll = () => {
      later.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      todayButton.focus({ preventScroll: true });
    };

    const loading = notes(current);
    element.replaceChildren(
      header(current),
      filters(current),
      ...loading,
      featured ? featuredCard(featured, today, options) : !loading.length ? h('p', { class: 'muted radar-note' }, current.scope === 'for-you' ? t('states.radar.empty') : t('radar.empty')) : '',
      weekSection(releases, today, expanded, draw, options.openDetail),
      soonSection(releases, today, options.openDetail, seeAll),
      later,
    );
    refocus();
  }

  draw();
  return element;
}
