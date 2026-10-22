/**
 * Discover: one long page for finding something new, from TMDB (plus
 * Wikidata for award winners and Letterboxd's public lists) rather than the
 * person's addon catalogs. The banner comes first; the other sections follow
 * in the person's order (Customize) and each loads as it scrolls near.
 * Without a TMDB token it says how to connect one, and shows the sections
 * that don't need it.
 */
import { VIEW_SHOWN, type Room, type RoomContext } from '../../app/router';
import { EXPLORE_CHANGED, exploreLayout, listSectionId, SECTIONS } from '../../catalog/explore';
import { pickedServices, STREAMING_CHANGED, streamingRegion } from '../../catalog/streaming';
import { favouriteGenres, interleave, seedsFrom, taste, updateTaste } from '../../catalog/taste';
import { recommendationsFor, streamingServices, tmdbConnected, type StreamingService } from '../../catalog/tmdb';
import type { Title } from '../../catalog/titles';
import { icon } from '../../components/icons';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { inLibrary, libraryEntries } from '../../library/library';
import { lastWatchedAt, recentlyWatched, tasteWatched } from '../../library/watch';
import { titleHandlers } from '../detail/open';
import { heroSkeleton } from '../home/hero';
import { arrange } from '../home/rows';
import { openSettingsTo } from '../settings';
import { createCustomizePage, type CustomizeEntry } from './customize';
import { renderFeatured } from './featured';
import { letterboxdRow, SECTION_BUILDERS, type SectionDeps } from './sections';
import { exploreMenu, hiddenClears, loadHidden, notHidden, removeHiddenCards } from './state';
import '../home/home.css';
import './explore.css';

/** Titles whose recommendations feed the banner and the queue. */
const SEEDS = 4;
/** Titles in the Discovery Queue. */
const QUEUE_SIZE = 40;
/** History and saved titles read for favourite genres. */
const TASTE_SAMPLE = 60;
/** Sections whose titles depend on the streaming country or the picked services. */
const REGION_SECTIONS = ['services', 'in-cinemas', 'new-to-stream', 'airing-week', 'upcoming'];
/** Sections whose titles depend on today's date (`SectionDeps.now`). */
const DATE_SECTIONS = ['in-cinemas', 'new-to-stream', 'airing-week', 'upcoming', 'country', 'genre-mix', 'critics', 'seasonal'];

export const exploreRoom: Room = {
  id: 'explore',
  label: t('explore.nav'),
  keep: true,
  render: (ctx) => explorePage(ctx),
};

function explorePage(ctx: RoomContext): HTMLElement {
  const { openDetail, play, withMenu } = titleHandlers(ctx);
  const heroSlot = h('div', { class: 'hero-slot' }, heroSkeleton());
  const hintSlot = h('div', { class: 'explore-hint-slot' });
  const notice = h('div', { class: 'explore-notice-slot' });
  const sections = h('div', { class: 'explore-sections' });
  const customize = h('button', { class: 'button glass' }, icon('sliders'), t('explore.customize'));
  const page = h(
    'div',
    { class: 'home explore hero-next' },
    heroSlot,
    h('div', { class: 'explore-head' }, h('div', { class: 'explore-head-text' }, h('h1', { class: 'explore-title' }, icon('compass'), t('explore.nav')), h('p', { class: 'muted' }, t('explore.intro'))), customize),
    hintSlot,
    notice,
    sections,
  );
  removeHiddenCards(page);

  let tmdb: boolean | null = null;
  let featuredDrawn = false;
  /** The thumbs-up seeds the last draw saw. */
  let seedKey: string | null = null;
  let clears = hiddenClears();
  const wrappers = new Map<string, HTMLElement>();
  const builders = new Map<Element, () => void>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        builders.get(entry.target)?.();
        builders.delete(entry.target);
      }
    },
    { rootMargin: '400px 0px' },
  );

  // Recommendations from thumbs-up seeds and recent history, asked for once per visit.
  let recLists: Promise<Title[][]> | null = null;
  const recommendations = () =>
    (recLists ??= taste().then(async (saved) => {
      const seeds = seedsFrom(saved.up, [...tasteWatched(), ...libraryEntries().map((e) => e.title)], SEEDS);
      return Promise.all(seeds.map((seed) => recommendationsFor(seed).then((titles) => titles ?? [], () => [] as Title[])));
    }));
  let queue: Promise<Title[]> | null = null;
  let services: Promise<{ services: StreamingService[]; region: string }> | null = null;
  // Another country or other services: the sections built for the old ones are built again.
  document.addEventListener(STREAMING_CHANGED, () => {
    services = null;
    forget(REGION_SECTIONS);
    redraw();
  });

  const deps: SectionDeps = {
    ctx,
    play,
    openDetail,
    menu: exploreMenu(withMenu),
    favourites: favouriteGenres([...recentlyWatched().slice(0, TASTE_SAMPLE), ...libraryEntries().slice(0, TASTE_SAMPLE).map((e) => e.title)]),
    services: () =>
      (services ??= Promise.all([streamingServices().catch(() => null), pickedServices(), streamingRegion()]).then(([all, picked, region]) => ({
        services: picked.flatMap((key) => (all ?? []).filter((s) => s.key === key)),
        region,
      }))),
    // Not yet saved, started or marked Not interested.
    queue: () => (queue ??= recommendations().then((lists) => interleave(lists, (title) => inLibrary(title.id) || lastWatchedAt(title.id) > 0 || !notHidden(title), QUEUE_SIZE))),
    now: Date.now(),
  };

  /** A section's slot: a skeleton until it scrolls near, then the section (or nothing, if it has none). */
  function wrapper(id: string, build: () => HTMLElement | null | Promise<HTMLElement | null>): HTMLElement {
    const slot = h('div', { class: 'explore-section', 'data-section': id }, h('div', { class: 'explore-placeholder', 'aria-hidden': 'true' }, h('div', { class: 'skeleton line' }), h('div', { class: 'skeleton explore-placeholder-track' })));
    builders.set(slot, () => {
      Promise.resolve()
        .then(build)
        .then((element) => {
          if (element) slot.replaceChildren(element);
          else slot.hidden = true;
        })
        .catch((err: unknown) => {
          console.warn(`Discover's ${id} section could not load`, err);
          slot.hidden = true;
        });
    });
    observer.observe(slot);
    return slot;
  }

  /** Drops sections' slots, so the next draw builds them afresh (in the same place). */
  function forget(ids: Iterable<string>): void {
    for (const id of ids) {
      const slot = wrappers.get(id);
      if (!slot) continue;
      observer.unobserve(slot);
      builders.delete(slot);
      wrappers.delete(id);
    }
  }

  async function sectionEntries(): Promise<CustomizeEntry[]> {
    const saved = await taste();
    return [
      { id: 'featured', label: t('explore.featured.label'), pinned: true },
      ...SECTIONS.filter((id) => id !== 'featured').map((id) => ({ id, label: SECTION_BUILDERS[id]!.label() })),
      ...saved.lists.map((list) => ({ id: listSectionId(list), label: list.name })),
    ];
  }
  customize.addEventListener('click', () => ctx.open(createCustomizePage(sectionEntries)));

  let drawing = 0;
  async function draw(): Promise<void> {
    const run = ++drawing;
    const [connected, layout, saved] = await Promise.all([tmdbConnected(), exploreLayout(), taste(), loadHidden()]);
    if (run !== drawing) return;
    if (connected !== tmdb) {
      // Connecting (or removing) TMDB changes what every section can show: start over.
      tmdb = connected;
      featuredDrawn = false;
      for (const slot of wrappers.values()) observer.unobserve(slot);
      wrappers.clear();
      builders.clear();
      recLists = queue = null;
    }
    // The page is kept for the whole session: a thumbs up (or a seed dropped) since the
    // recommendations were asked for brings fresh ones to the banner and the queue.
    const seeds = saved.up.map((seed) => seed.id).join(' ');
    if (seedKey !== null && seeds !== seedKey) {
      recLists = queue = null;
      featuredDrawn = false;
      forget(['queue']);
    }
    seedKey = seeds;
    // The page is kept for the whole session: on a new day, what's in cinemas, the country of the day and the like are looked up again.
    const now = Date.now();
    if (new Date(now).toDateString() !== new Date(deps.now).toDateString()) {
      deps.now = now;
      forget(DATE_SECTIONS);
    }
    // Titles shown again (Customize) were taken out of every built section: all are built again.
    if (hiddenClears() !== clears) {
      clears = hiddenClears();
      recLists = queue = null;
      featuredDrawn = false;
      forget([...wrappers.keys()]);
    }

    const featuredOn = tmdb && !layout.hidden.includes('featured');
    if (!featuredOn) {
      // Turned back on later, it's drawn again.
      heroSlot.replaceChildren();
      featuredDrawn = false;
    } else if (!featuredDrawn) {
      featuredDrawn = true;
      heroSlot.replaceChildren(heroSkeleton());
      void renderFeatured(heroSlot, { play, openDetail, recommendations: () => recommendations().then((lists) => interleave(lists)) }).catch((err: unknown) => {
        console.warn('Could not load Discover’s featured titles', err);
        heroSlot.replaceChildren();
      });
    }
    drawHint(featuredOn && !saved.hintDone);
    notice.replaceChildren(tmdb ? '' : noTmdbNotice());

    const lists = new Map(saved.lists.map((list) => [listSectionId(list), list]));
    const ids = arrange([...SECTIONS.filter((id) => id !== 'featured'), ...lists.keys()], layout.order).filter(
      (id) => !layout.hidden.includes(id) && (lists.has(id) || (SECTION_BUILDERS[id] && (tmdb || !SECTION_BUILDERS[id].tmdb))),
    );
    const slots = ids.map((id) => {
      let slot = wrappers.get(id);
      if (!slot) {
        const list = lists.get(id);
        slot = wrapper(id, list ? () => letterboxdRow(deps, list, list.name) : () => SECTION_BUILDERS[id]!.build(deps));
        wrappers.set(id, slot);
      }
      return slot;
    });
    // Only new or moved sections are (re)inserted, so the rest keep their focus and scroll.
    slots.forEach((slot, i) => {
      if (sections.children[i] !== slot) sections.insertBefore(slot, sections.children[i] ?? null);
    });
    while (sections.children.length > slots.length) sections.lastElementChild!.remove();
  }

  function drawHint(show: boolean): void {
    if (!show) return void hintSlot.replaceChildren();
    const dismiss = h('button', { class: 'button' }, t('explore.hint.dismiss'));
    dismiss.addEventListener('click', () => {
      hintSlot.replaceChildren();
      customize.focus({ preventScroll: true });
      void updateTaste((current) => ({ ...current, hintDone: true })).catch((err: unknown) => console.warn('Could not save the hint', err));
    });
    hintSlot.replaceChildren(
      h(
        'div',
        { class: 'explore-hint', role: 'note' },
        h('span', { class: 'explore-hint-icons', 'aria-hidden': 'true' }, icon('thumbUp'), icon('thumbDown')),
        h('div', { class: 'explore-strip-text' }, h('strong', {}, t('explore.hint.title')), h('span', { class: 'muted' }, t('explore.hint.body'))),
        dismiss,
      ),
    );
  }

  function noTmdbNotice(): HTMLElement {
    const open = h('button', { class: 'button primary' }, t('search.no-tmdb.open'));
    open.addEventListener('click', () => {
      openSettingsTo('integrations', '.tmdb-row');
      ctx.go('settings');
    });
    return h('div', { class: 'home-message explore-notice' }, h('span', { class: 'home-message-title' }, t('explore.no-tmdb.title')), h('p', { class: 'muted' }, t('explore.no-tmdb.body')), open);
  }

  const redraw = () => void draw().catch((err: unknown) => console.warn('Could not draw Discover', err));
  document.addEventListener(EXPLORE_CHANGED, redraw);
  // A TMDB token saved (or removed) in Settings shows up when Discover is next shown.
  page.addEventListener(VIEW_SHOWN, redraw);
  redraw();
  return page;
}
