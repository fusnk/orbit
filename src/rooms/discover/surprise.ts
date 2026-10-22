/**
 * Surprise Me (Movies / TV Shows), and My Library's "Pick for me": a drawer of constraints, then one random
 * title from the person's catalogs that fits, with Play, Details and
 * Another. The choosing itself is catalog/surprise; this loads the pool,
 * a page per catalog at a time, until something fits or the catalogs run
 * out.
 */
import { decodeEntities } from '../../addons/schema';
import { allowedTitles, verdictNow } from '../../catalog/parental';
import { loadCatalog, usableAddons } from '../../catalog/service';
import { addPage, ERAS, fits, pickSurprise, type Candidate, type EraId, type LoadedPages, type RuntimeLimit, type SurpriseConstraints } from '../../catalog/surprise';
import { browsableCatalogs, fallbackHue, genreLine, railTitle, showKind, type CatalogRef, type Title } from '../../catalog/titles';
import { artImage, titleMeta, withHue } from '../../components/cards';
import { openDrawer } from '../../components/drawer';
import { icon } from '../../components/icons';
import { createSwitch } from '../../components/switch';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { genresOf } from '../../library/filters';
import { lastWatchedAt } from '../../library/watch';
import { funPrefs } from '../../app/fun-settings';
import { reducedMotion } from '../../theme/appearance';
import { spinRoulette } from './roulette';

type Kind = SurpriseConstraints['type'];

/** Pages fetched per catalog before giving up on a match. */
const MAX_PAGES = 4;

/** Titles already offered this session, so "Another" never repeats one. */
const shown = new Set<string>();
/** The last choices per type, kept for the session. */
const remembered = new Map<Kind, SurpriseConstraints>();
/** The same for picks from My Library, kept apart: its genres and titles aren't the catalogs'. */
const libraryShown = new Set<string>();
const libraryRemembered = new Map<Kind, SurpriseConstraints>();
/** Catalogs switched off, by key. */
const off = new Set<string>();

interface Source {
  ref: CatalogRef;
  /** Addon, type and catalog id: Cinemeta has a "top" catalog for both movies and shows. */
  key: string;
  label: string;
  /** Genres the catalog can be asked for (not a required genre, which is a year on Cinemeta's "New"). */
  genres: readonly string[];
}

const RUNTIMES: { id: RuntimeLimit; label: MessageKey }[] = [
  { id: 'any', label: 'insights.surprise.any' },
  { id: 'under-100', label: 'insights.surprise.under-100' },
  { id: 'under-120', label: 'insights.surprise.under-120' },
];
const ERA_LABELS: Record<EraId, MessageKey> = {
  any: 'insights.surprise.any',
  '2020s': 'insights.surprise.era-2020s',
  '2010s': 'insights.surprise.era-2010s',
  '2000s': 'insights.surprise.era-2000s',
  '1990s': 'insights.surprise.era-1990s',
  earlier: 'insights.surprise.era-earlier',
};

const started = (title: Title) => lastWatchedAt(title.id) > 0;

/** Addon, type and catalog id: Cinemeta has a "top" catalog for both movies and shows. */
const sourceKey = (ref: CatalogRef) => `${ref.addon.key}|${ref.catalog.type}|${ref.catalog.id}`;
/** Genres a catalog can be asked for (not a required genre, which is a year on Cinemeta's "New"). */
function genreOptions(ref: CatalogRef): readonly string[] {
  const genre = ref.catalog.extra.find((e) => e.name === 'genre');
  return genre && !genre.isRequired ? (genre.options ?? []) : [];
}

/**
 * One surprise of `type` without the drawer (the phone remote's "Surprise me"): the choices
 * last made for it this session, from the first page of each catalog left switched on, only
 * what the profile's content limit allows, and never one already offered. `failed` when every
 * catalog failed to load.
 */
export async function quickSurprise(type: Kind): Promise<{ pick: Title | undefined; failed: boolean }> {
  const c = constraints(type, remembered);
  const refs = browsableCatalogs(await usableAddons()).filter((ref) => ref.catalog.type === type && !off.has(sourceKey(ref)));
  const pages = await Promise.allSettled(
    refs.map(async (ref): Promise<Candidate[]> => {
      const genre = c.genre !== null && genreOptions(ref).includes(c.genre) ? c.genre : null;
      const page = await allowedTitles(await loadCatalog(ref, genre ? [['genre', genre]] : []));
      return page.map((title) => ({ title, genre: genre ?? undefined }));
    }),
  );
  const pool = pages.flatMap((page) => (page.status === 'fulfilled' ? page.value : []));
  const pick = pickSurprise(pool, c, { exclude: shown, started });
  if (pick) shown.add(pick.id);
  return { pick, failed: pages.length > 0 && pages.every((page) => page.status === 'rejected') };
}

/**
 * Opens the drawer on `type`; `handlers` are the page's own Play and Details.
 * With `library` (My Library's "Pick for me") it picks from those titles
 * instead of the catalogs: nothing to load, and no catalogs to choose.
 */
export function openSurprise(initial: Kind, handlers: { play(title: Title): void; openDetail(title: Title): void }, library?: () => readonly Title[]): void {
  let all: Source[] = [];
  const seen = library ? libraryShown : shown;
  const constraintsFor = (type: Kind) => constraints(type, library ? libraryRemembered : remembered, Boolean(library));
  let c = constraintsFor(initial);
  const loaded = new Map<string, LoadedPages>();
  let generation = 0;

  const body = h('div', { class: 'surprise-body' });
  const live = h('p', { class: 'surprise-status muted', role: 'status', 'aria-live': 'polite' });
  const heading = library ? t('librarylook.pick.title') : t('insights.surprise.title');
  const content = h('div', { class: 'surprise' }, h('h2', { class: 'surprise-title' }, heading), live, body);
  const close = openDrawer(content, heading, () => generation++);
  /** My Library's titles of the chosen type that the profile's content limit allows. */
  const owned = () => (library?.() ?? []).filter((title) => showKind(title.type) === c.type && verdictNow(title) === 'allowed');

  const sources = () => all.filter((s) => s.ref.catalog.type === c.type);
  const chosen = () => sources().filter((s) => !off.has(s.key));
  /** The genre a catalog is asked for, if it can be. */
  const asked = (source: Source, genre: string | null) => (genre !== null && source.genres.includes(genre) ? genre : null);
  const loadedFor = (source: Source, genre: string | null) => `${source.key}|${asked(source, genre) ?? ''}`;

  function segments<T extends string>(label: string, options: { id: T; label: string }[], current: T, select: (id: T) => void): HTMLElement {
    const group = h('div', { class: 'segments', role: 'group', 'aria-label': label });
    for (const option of options) {
      const button = h('button', { class: 'segment', 'aria-pressed': String(option.id === current) }, option.label);
      button.addEventListener('click', () => {
        select(option.id);
        for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button));
      });
      group.append(button);
    }
    return group;
  }

  const field = (label: string, control: HTMLElement) => h('div', { class: 'surprise-field' }, h('span', { class: 'surprise-label' }, label), control);

  /** Redraws the form, keeping focus on the control at `refocus` (a selector) if given. */
  function drawForm(refocus?: string): void {
    live.textContent = '';
    const genres = library ? genresOf(owned()).map((g) => g.genre) : [...new Set(chosen().flatMap((s) => s.genres))];
    if (c.genre !== null && !genres.includes(c.genre)) c.genre = null;
    const genreChips = h('div', { class: 'chips surprise-genres', role: 'group', 'aria-label': t('insights.surprise.genre') });
    for (const genre of [null, ...genres]) {
      // A catalog's options are as the addon sent them (some HTML-escape them); My Library's are titles' own, already decoded.
      const label = genre === null ? t('insights.surprise.any') : library ? genre : decodeEntities(genre);
      const chip = h('button', { class: 'chip', 'aria-pressed': String(c.genre === genre) }, label);
      chip.addEventListener('click', () => {
        c.genre = genre;
        for (const b of genreChips.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === chip));
      });
      genreChips.append(chip);
    }
    const catalogs = h(
      'div',
      { class: 'surprise-catalogs' },
      ...sources().map((source, i) => {
        const toggle = createSwitch(source.label, !off.has(source.key), (on) => {
          if (on) off.delete(source.key);
          else off.add(source.key);
          // The genres on offer follow the catalogs.
          drawForm(`.surprise-catalogs .switch:nth-child(${i + 1})`);
        });
        toggle.classList.add('wide');
        return toggle;
      }),
    );
    const go = h('button', { class: 'button large primary', disabled: library ? !owned().length : !chosen().length }, t('insights.surprise.go'));
    go.addEventListener('click', () => void surprise());
    const types = segments<Kind>(
      t('insights.surprise.type'),
      [
        { id: 'movie', label: t('titles.library.movies') },
        { id: 'series', label: t('titles.library.series') },
      ],
      c.type,
      (id) => {
        if (id === c.type) return;
        // Each type has its own catalogs and genres.
        c = constraintsFor(id);
        drawForm(`.surprise-type [aria-pressed="true"]`);
      },
    );
    types.classList.add('surprise-type');
    body.replaceChildren(
      field(t('insights.surprise.type'), types),
      genres.length ? field(t('insights.surprise.genre'), genreChips) : '',
      // A show's runtime is per episode, so only movies are limited by it.
      c.type === 'movie' ? field(t('insights.surprise.runtime'), segments(t('insights.surprise.runtime'), RUNTIMES.map((r) => ({ id: r.id, label: t(r.label) })), c.runtime, (id) => (c.runtime = id))) : '',
      field(
        t('insights.surprise.era'),
        segments(
          t('insights.surprise.era'),
          (Object.keys(ERAS) as EraId[]).map((id) => ({ id, label: t(ERA_LABELS[id]) })),
          c.era,
          (id) => (c.era = id),
        ),
      ),
      createSwitch(t('insights.surprise.unwatched'), c.unwatchedOnly, (on) => (c.unwatchedOnly = on)),
      !library && sources().length > 1 ? field(t('insights.surprise.catalogs'), catalogs) : '',
      library
        ? owned().length
          ? ''
          : h('p', { class: 'muted' }, t('librarylook.pick.none-type'))
        : sources().length
          ? chosen().length
            ? ''
            : h('p', { class: 'muted' }, t('insights.surprise.pick-catalog'))
          : h('p', { class: 'muted' }, t('insights.surprise.no-catalogs')),
      h('div', { class: 'surprise-actions' }, go),
    );
    if (refocus) body.querySelector<HTMLElement>(refocus)?.focus({ preventScroll: true });
  }

  /** Loads the next page of a catalog (for the chosen genre, when it can be asked for one). */
  async function more(source: Source, genre: string | null): Promise<void> {
    const key = loadedFor(source, genre);
    const state = loaded.get(key) ?? { titles: [], done: false, pages: 0, received: 0 };
    loaded.set(key, state);
    if (state.done || state.pages >= MAX_PAGES) return;
    const skip = state.received;
    // Paging only works if the catalog declares `skip`.
    if (skip > 0 && !source.ref.catalog.extra.some((e) => e.name === 'skip')) {
      state.done = true;
      return;
    }
    const genreAsked = asked(source, genre);
    const extra: [string, string][] = [];
    if (genreAsked) extra.push(['genre', genreAsked]);
    if (skip) extra.push(['skip', String(skip)]);
    const page = await loadCatalog(source.ref, extra);
    // Ratings for the profile's content limit, so `pool` knows which titles it may pick.
    await allowedTitles(page);
    addPage(state, page, genreAsked ?? undefined);
  }

  const pool = (genre: string | null): Candidate[] =>
    library
      ? owned().map((title) => ({ title }))
      : chosen()
      .flatMap((s) => loaded.get(loadedFor(s, genre))?.titles ?? [])
      .filter((c) => verdictNow(c.title) === 'allowed');

  async function surprise(): Promise<void> {
    const current = ++generation;
    const wanted = { ...c };
    live.textContent = t('insights.surprise.looking');
    body.replaceChildren(h('div', { class: 'surprise-loading', 'aria-hidden': 'true' }, h('div', { class: 'skeleton surprise-poster' }), h('div', { class: 'skeleton line' })));
    let pick = pickSurprise(pool(wanted.genre), wanted, { exclude: seen, started });
    let failed = false;
    // My Library's titles are all here already; catalogs load a page more per round.
    for (let round = 0; !pick && !library && round < MAX_PAGES; round++) {
      const results = await Promise.allSettled(chosen().map((s) => more(s, wanted.genre)));
      if (current !== generation) return;
      failed = results.length > 0 && results.every((r) => r.status === 'rejected');
      if (failed) break;
      pick = pickSurprise(pool(wanted.genre), wanted, { exclude: seen, started });
    }
    if (!pick) return drawNone(failed);
    seen.add(pick.id);
    // The roulette (Settings → Appearance → Little extras) spins through the same pool; the pick is already made.
    const picked = pick;
    const unique = (list: Candidate[]) => [...new Map(list.map((x) => [x.title.id, x.title])).values()].filter((title) => title.id !== picked.id);
    // Titles that fit the choices, or the whole pool when too few do.
    const fitting = unique(pool(wanted.genre).filter((x) => fits(x, wanted, started)));
    const others = fitting.length >= 4 ? fitting : unique(pool(wanted.genre));
    if (funPrefs().roulette && !reducedMotion() && others.length >= 2) {
      await spinRoulette(body, picked, others);
      if (current !== generation) return;
    }
    drawPick(picked);
  }

  function drawPick(title: Title): void {
    const genres = genreLine(title);
    live.textContent = t('insights.surprise.found', { name: title.name });
    const play = h('button', { class: 'button large primary' }, icon('play', { filled: true }), t('titles.actions.play'));
    play.addEventListener('click', () => {
      close();
      handlers.play(title);
    });
    const details = h('button', { class: 'button large glass' }, t('browse.hero.details'));
    details.addEventListener('click', () => {
      close();
      handlers.openDetail(title);
    });
    const another = h('button', { class: 'button glass' }, t('insights.surprise.another'));
    another.addEventListener('click', () => void surprise());
    const change = h('button', { class: 'button glass' }, t('insights.surprise.change'));
    change.addEventListener('click', () => drawForm('button'));
    body.replaceChildren(
      h(
        'div',
        { class: 'surprise-pick' },
        withHue(h('div', { class: 'surprise-poster' }, h('span', { class: 'surprise-poster-name' }, title.name), title.poster ? artImage(title.poster, 'art', true) : ''), fallbackHue(title.id)),
        h(
          'div',
          { class: 'surprise-info' },
          h('h3', { class: 'surprise-name' }, title.name),
          // The column is narrow: genres get their own line, so a wrapped meta line never ends on a "·".
          h('div', { class: 'hero-meta' }, ...titleMeta(title, { genres: false })),
          genres ? h('span', { class: 'surprise-genres-line muted' }, genres) : '',
          title.description ? h('p', { class: 'surprise-description muted' }, title.description) : '',
        ),
      ),
      h('div', { class: 'surprise-actions' }, play, details),
      h('div', { class: 'surprise-actions' }, another, change),
    );
    play.focus({ preventScroll: true });
  }

  function drawNone(failed: boolean): void {
    live.textContent = '';
    const change = h('button', { class: 'button primary' }, t('insights.surprise.change'));
    change.addEventListener('click', () => drawForm('button'));
    const again = h('button', { class: 'button glass' }, t('insights.surprise.start-over'));
    again.addEventListener('click', () => {
      seen.clear();
      void surprise();
    });
    body.replaceChildren(
      h(
        'div',
        { class: 'surprise-none' },
        h('span', { class: 'surprise-none-title' }, failed ? t('insights.surprise.failed') : t('insights.surprise.none')),
        h('p', { class: 'muted' }, failed ? t('insights.surprise.failed-body') : library ? t('librarylook.pick.none-body') : t('insights.surprise.none-body')),
      ),
      h('div', { class: 'surprise-actions' }, change, failed || !seen.size ? '' : again),
    );
    change.focus({ preventScroll: true });
  }

  if (library) return drawForm('button');
  live.textContent = t('insights.surprise.loading');
  void usableAddons()
    .then((addons) => {
      all = browsableCatalogs(addons)
        .filter((ref) => ref.catalog.type === 'movie' || ref.catalog.type === 'series')
        .map((ref) => ({
          ref,
          key: sourceKey(ref),
          label: t('insights.surprise.catalog', { name: railTitle(ref.catalog), addon: ref.addon.manifest.name }),
          genres: genreOptions(ref),
        }));
      drawForm('button');
    })
    .catch(() => drawNone(true));
}

/** A pick from My Library starts on titles not yet started: what's begun is in Continue Watching. */
function constraints(type: Kind, saved: Map<Kind, SurpriseConstraints>, unwatchedOnly = false): SurpriseConstraints {
  const found = saved.get(type) ?? { type, genre: null, runtime: 'any', era: 'any', unwatchedOnly };
  saved.set(type, found);
  return found;
}
