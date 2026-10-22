/**
 * The filter controls on a Discover grid: Sort and Filters buttons and a
 * Hide watched switch in the grid's bar, and a panel (opened by Filters)
 * with the rest. Built once per grid and updated in place, so focus and a
 * slider being adjusted are never lost to a redraw. Every control is a
 * button, menu or slider: focusing one never changes or edits it.
 */
import { GENRE_LABELS, GENRES, type GenreKey } from '../../catalog/explore';
import { regionName } from '../../catalog/streaming';
import { icon } from '../../components/icons';
import { openMenuFrom, type MenuItem } from '../../components/menu';
import { createSlider } from '../../components/slider';
import { createSwitch } from '../../components/switch';
import { locale, t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { activeCount, DECADES, decadeYears, DEFAULT_FILTERS, FILTER_LANGUAGES, RANGE_FIRST_YEAR, RUNTIME_MAX, RUNTIME_STEP, SORTS, VOTE_CHOICES, type DiscoverFilters, type FilterSort, type Kind } from './filters';
import { createPersonFilter } from './person-filter';

const SORT_LABELS: Record<FilterSort, MessageKey> = {
  default: 'explore.filters.sort-default',
  popularity: 'explore.filters.sort-popularity',
  rating: 'explore.filters.sort-rating',
  newest: 'explore.filters.sort-newest',
  oldest: 'explore.filters.sort-oldest',
  title: 'explore.filters.sort-title',
};

export interface FilterBarOptions {
  filters: DiscoverFilters;
  /** The grid's language, genre or person is its own, so that filter is left out. */
  fixed: { language: boolean; genres: boolean; cast: boolean; director: boolean };
  /** Movie certifications and their country, once loaded (null: none). */
  certifications: Promise<{ country: string; certifications: string[] } | null>;
  onChange(filters: DiscoverFilters): void;
}

export interface FilterBar {
  /** Sort, Filters and Hide watched, for the grid's bar. */
  controls: HTMLElement;
  /** The panel the Filters button opens. */
  panel: HTMLElement;
  /** Shows or hides what only applies to movies. */
  setKind(kind: Kind): void;
}

const languageNames = new Intl.DisplayNames([locale()], { type: 'language' });
const number = new Intl.NumberFormat(locale());
const rating = (value: number) => value.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const mark = (on: boolean, label: string) => (on ? `✓ ${label}` : label);

/** A menu button showing its current choice. */
function menuButton(label: string, items: () => MenuItem[]): { element: HTMLButtonElement; set(text: string, on: boolean): void } {
  const value = h('span', { class: 'filter-value' });
  const element = h('button', { class: 'source-button filter-menu', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, value, icon('chevronDown'));
  element.addEventListener('click', () => openMenuFrom(element, items()));
  return {
    element,
    set(text, on) {
      value.textContent = text;
      element.classList.toggle('on', on);
      element.setAttribute('aria-label', `${label}: ${text}`);
    },
  };
}

function field(label: string, ...controls: (HTMLElement | string)[]): HTMLElement {
  return h('div', { class: 'filter-field', role: 'group', 'aria-label': label }, h('span', { class: 'filter-label', 'aria-hidden': 'true' }, label), h('div', { class: 'filter-controls' }, ...controls));
}

export function createFilterBar(options: FilterBarOptions): FilterBar {
  let f: DiscoverFilters = { ...options.filters, genres: [...options.filters.genres] };
  let kind: Kind = 'movie';
  let certs: { country: string; certifications: string[] } | null = null;

  function change(patch: Partial<DiscoverFilters>): void {
    f = { ...f, ...patch };
    sync();
    options.onChange(f);
  }

  // ── The bar ──
  const sort = menuButton(t('explore.filters.sort'), () => SORTS.map((value) => ({ label: mark(f.sort === value, t(SORT_LABELS[value])), action: () => change({ sort: value }) })));
  const sortGroup = h('span', { class: 'source-picker' }, h('span', { 'aria-hidden': 'true' }, t('explore.filters.sort')), sort.element);
  const count = h('span', { class: 'filter-count' });
  const toggle = h('button', { class: 'source-button filter-toggle', 'aria-expanded': 'false' }, icon('sliders'), t('explore.filters.button'), count);
  const hideWatched = createSwitch(t('explore.filters.hide-watched'), f.hideWatched, (on) => change({ hideWatched: on }));
  hideWatched.classList.add('filter-switch');
  const controls = h('div', { class: 'filter-bar' }, sortGroup, toggle, hideWatched);

  // ── The panel ──
  const ratingFormat = (edge: number) => (value: number) => (value === edge ? t('explore.filters.any') : rating(value));
  const ratingMin = createSlider({ label: t('explore.filters.rating-min'), min: 0, max: 10, step: 0.5, value: f.ratingMin, format: ratingFormat(0), focusId: 'filter-rating-min', onInput: (value) => change({ ratingMin: value, ratingMax: Math.max(value, f.ratingMax) }) });
  const ratingMax = createSlider({ label: t('explore.filters.rating-max'), min: 0, max: 10, step: 0.5, value: f.ratingMax, format: ratingFormat(10), focusId: 'filter-rating-max', onInput: (value) => change({ ratingMax: value, ratingMin: Math.min(value, f.ratingMin) }) });

  const votes = VOTE_CHOICES.map((value) => {
    const button = h('button', { class: 'segment', 'aria-pressed': 'false' }, value ? t('explore.filters.votes-n', { count: number.format(value) }) : t('explore.filters.any'));
    button.addEventListener('click', () => change({ minVotes: value }));
    return [value, button] as const;
  });

  const decadeLabel = (decade: number) => t('explore.filters.decade', { decade: String(decade) });
  const decade = menuButton(t('explore.filters.released'), () => [
    { label: mark(f.decade === null && f.yearFrom === null && f.yearTo === null, t('explore.filters.any-time')), action: () => change({ decade: null, year: null, yearFrom: null, yearTo: null }) },
    // A decade replaces a range of years.
    ...DECADES.map((d) => ({ label: mark(f.decade === d, decadeLabel(d)), action: () => change({ decade: d, year: null, yearFrom: null, yearTo: null }) })),
  ]);
  const year = menuButton(t('explore.filters.year'), () =>
    f.decade === null
      ? []
      : [{ label: mark(f.year === null, t('explore.filters.any-year')), action: () => change({ year: null }) }, ...decadeYears(f.decade).map((y) => ({ label: mark(f.year === y, String(y)), action: () => change({ year: y }) }))],
  );

  // A range of years, instead of a decade: each end of a slider means "any".
  const thisYear = new Date().getFullYear();
  const yearFormat = (edge: number) => (value: number) => (value === edge ? t('explore.filters.any') : String(value));
  const rangeYear = (value: number, edge: number) => (value === edge ? null : value);
  const yearFrom = createSlider({
    label: t('explore.filters.year-from'),
    min: RANGE_FIRST_YEAR,
    max: thisYear,
    value: f.yearFrom ?? RANGE_FIRST_YEAR,
    format: yearFormat(RANGE_FIRST_YEAR),
    focusId: 'filter-year-from',
    onInput: (value) => change({ decade: null, year: null, yearFrom: rangeYear(value, RANGE_FIRST_YEAR), yearTo: f.yearTo !== null && f.yearTo < value ? rangeYear(value, thisYear) : f.yearTo }),
  });
  const yearTo = createSlider({
    label: t('explore.filters.year-to'),
    min: RANGE_FIRST_YEAR,
    max: thisYear,
    value: f.yearTo ?? thisYear,
    format: yearFormat(thisYear),
    focusId: 'filter-year-to',
    onInput: (value) => change({ decade: null, year: null, yearTo: rangeYear(value, thisYear), yearFrom: f.yearFrom !== null && f.yearFrom > value ? rangeYear(value, RANGE_FIRST_YEAR) : f.yearFrom }),
  });

  const minutes = (edge: number) => (value: number) => (value === edge ? t('explore.filters.any') : t('explore.filters.minutes', { count: value }));
  const runtimeMin = createSlider({ label: t('explore.filters.runtime-min'), min: 0, max: RUNTIME_MAX, step: RUNTIME_STEP, value: f.runtimeMin, format: minutes(0), focusId: 'filter-runtime-min', onInput: (value) => change({ runtimeMin: value, runtimeMax: Math.max(value, f.runtimeMax) }) });
  const runtimeMax = createSlider({ label: t('explore.filters.runtime-max'), min: 0, max: RUNTIME_MAX, step: RUNTIME_STEP, value: f.runtimeMax, format: minutes(RUNTIME_MAX), focusId: 'filter-runtime-max', onInput: (value) => change({ runtimeMax: Math.max(value, RUNTIME_STEP), runtimeMin: Math.min(value, f.runtimeMin) }) });

  const cast = createPersonFilter(t('explore.filters.cast'), (person) => change({ cast: person }));
  const director = createPersonFilter(t('explore.filters.director'), (person) => change({ director: person }));
  const castField = field(t('explore.filters.cast'), cast.element);
  const directorField = field(t('explore.filters.director'), director.element);

  const certification = menuButton(t('explore.filters.certification'), () => [
    { label: mark(f.certification === null, t('explore.filters.certification-any')), action: () => change({ certification: null }) },
    ...(certs?.certifications ?? []).map((c) => ({ label: mark(f.certification === c, t('explore.filters.up-to', { rating: c })), action: () => change({ certification: c }) })),
  ]);
  const certHint = h('span', { class: 'filter-hint' });
  const certField = field(t('explore.filters.certification'), certification.element, certHint);

  const languageName = (code: string) => languageNames.of(code) ?? code;
  const language = menuButton(t('explore.filters.language'), () => [
    { label: mark(f.language === null, t('explore.filters.language-any')), action: () => change({ language: null }) },
    ...[...FILTER_LANGUAGES].sort((a, b) => languageName(a).localeCompare(languageName(b), locale())).map((code) => ({ label: mark(f.language === code, languageName(code)), action: () => change({ language: code }) })),
  ]);

  const genreChips = GENRES.map((genre) => {
    const chip = h('button', { class: 'chip', 'aria-pressed': 'false' }, t(GENRE_LABELS[genre.key]));
    chip.addEventListener('click', () => change({ genres: f.genres.includes(genre.key) ? f.genres.filter((g) => g !== genre.key) : [...f.genres, genre.key as GenreKey] }));
    return [genre.key, chip] as const;
  });
  const match = (['all', 'any'] as const).map((value) => {
    const button = h('button', { class: 'segment', 'aria-pressed': 'false' }, value === 'all' ? t('explore.filters.match-all') : t('explore.filters.match-any'));
    button.addEventListener('click', () => change({ genreMatch: value }));
    return [value, button] as const;
  });
  const matchGroup = h('div', { class: 'segments', role: 'group', 'aria-label': t('explore.filters.match') }, ...match.map(([, b]) => b));

  const reset = h('button', { class: 'button' }, t('explore.filters.reset'));
  reset.addEventListener('click', () => {
    // Hide watched and the sort live in the bar; Clear leaves them be.
    change({ ...DEFAULT_FILTERS, sort: f.sort, hideWatched: f.hideWatched });
  });

  const languageField = field(t('explore.filters.language'), language.element);
  const panel = h(
    'div',
    { class: 'filter-panel', hidden: true, id: `filter-panel-${Math.random().toString(36).slice(2)}` },
    h('div', { class: 'filter-grid' }, field(t('explore.filters.rating'), ratingMin, ratingMax), field(t('explore.filters.votes'), h('div', { class: 'segments' }, ...votes.map(([, b]) => b))), field(t('explore.filters.released'), decade.element, year.element, yearFrom, yearTo), field(t('explore.filters.runtime'), runtimeMin, runtimeMax), certField, options.fixed.language ? '' : languageField, castField, directorField),
    field(t('explore.filters.genres'), h('div', { class: 'chips filter-genres' }, ...genreChips.map(([, c]) => c)), options.fixed.genres ? '' : matchGroup),
    h('div', { class: 'filter-actions' }, reset),
  );
  toggle.setAttribute('aria-controls', panel.id);
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });

  function sync(): void {
    sort.set(t(SORT_LABELS[f.sort]), f.sort !== 'default');
    const n = activeCount(f, kind, options.fixed);
    count.textContent = n ? number.format(n) : '';
    count.hidden = !n;
    toggle.classList.toggle('on', n > 0);
    toggle.setAttribute('aria-label', n ? t('explore.filters.button-count', { count: number.format(n) }) : t('explore.filters.button'));
    hideWatched.setAttribute('aria-checked', String(f.hideWatched));
    ratingMin.setValue(f.ratingMin);
    ratingMax.setValue(f.ratingMax);
    for (const [value, button] of votes) button.setAttribute('aria-pressed', String(f.minVotes === value));
    decade.set(f.decade === null ? t('explore.filters.any-time') : decadeLabel(f.decade), f.decade !== null);
    year.set(f.year === null ? t('explore.filters.any-year') : String(f.year), f.year !== null);
    year.element.disabled = f.decade === null;
    yearFrom.setValue(f.yearFrom ?? RANGE_FIRST_YEAR);
    yearTo.setValue(f.yearTo ?? thisYear);
    runtimeMin.setValue(f.runtimeMin);
    runtimeMax.setValue(f.runtimeMax);
    cast.set(f.cast);
    director.set(f.director);
    // TMDB filters films by people, not shows.
    castField.hidden = kind !== 'movie' || options.fixed.cast;
    directorField.hidden = kind !== 'movie' || options.fixed.director;
    const certOn = f.certification !== null && !!certs?.certifications.includes(f.certification);
    certification.set(certOn ? t('explore.filters.up-to', { rating: f.certification! }) : t('explore.filters.certification-any'), certOn);
    certHint.textContent = certs ? t('explore.filters.certification-hint', { country: regionName(certs.country) }) : '';
    // Certifications are TMDB's for movies only.
    certField.hidden = kind !== 'movie' || !certs?.certifications.length;
    language.set(f.language === null ? t('explore.filters.language-any') : languageName(f.language), f.language !== null);
    for (const [key, chip] of genreChips) chip.setAttribute('aria-pressed', String(f.genres.includes(key)));
    for (const [value, button] of match) button.setAttribute('aria-pressed', String(f.genreMatch === value));
    // Clear also clears what this kind hides (counting as for movies counts everything).
    reset.disabled = activeCount({ ...f, hideWatched: false }, 'movie') === 0;
  }

  options.certifications
    .then((found) => {
      certs = found;
      sync();
    })
    .catch((err: unknown) => console.warn('No certifications for Discover’s filters', err));
  sync();
  return {
    controls,
    panel,
    setKind(next) {
      kind = next;
      sync();
    },
  };
}
