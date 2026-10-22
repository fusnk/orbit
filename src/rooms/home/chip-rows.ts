/**
 * Two of Home's own rows that open a row of titles under themselves:
 *
 * - Mood chips ("What are you in the mood for?"): pick one and a row of
 *   matching films appears below; pick it again to close it. With TMDB the
 *   films come from its discover (through Rust, which keeps the token);
 *   without it, from the catalogs Home already uses (see extras.ts).
 * - "Only on…": the region's streaming services as logo tiles; the picked
 *   one's popular titles show below.
 *
 * Service names and titles come from TMDB or addons: text nodes only.
 */
import { t } from '../../i18n';
import type { RoomContext } from '../../app/router';
import { regionName, regionShortName, streamingRegion } from '../../catalog/streaming';
import { streamingCatalog, streamingServices, tmdbSourcePage, type StreamingService } from '../../catalog/tmdb';
import type { CatalogRef, Title } from '../../catalog/titles';
import { rail } from '../../components/cards';
import { icon, type IconName } from '../../components/icons';
import { serviceLogo } from '../../components/service-logo';
import { h } from '../../lib/dom';
import { appearance, ROW_STYLE_CHANGED } from '../../theme/appearance';
import { createServicePage } from '../streaming/service';
import { HOME_SHOWN } from './dashboard';
import { CHIPS, chipFallback, chipQuery, type ChipFallback, type ChipId } from './extras';
import { runtimeMinutes } from './moods';
import { catalogGenres, loadCatalogGenre, moodPool, moodTitles, styledRail } from './row-render';
import type { TitleActions } from './sections';

const CHIP_ICONS: Record<ChipId, IconName> = {
  action: 'bolt',
  funny: 'smile',
  'feel-good': 'sun',
  edge: 'pulse',
  scare: 'ghost',
  'mind-bending': 'spiral',
  romance: 'heart',
  short: 'clock',
  greats: 'star',
  country: 'globe',
};

/** Titles a chip's row shows at most (a catalog page, or TMDB's first page). */
const CHIP_TITLES = 20;

const chipLabel = (chip: ChipId, region: string) => (chip === 'country' ? t('homerows.chips.country', { country: regionName(region) }) : t(`homerows.chips.${chip}`));

/** The catalog genre a fallback names: the first movie catalog (else any) offering a matching genre. */
function fallbackGenre(refs: readonly CatalogRef[], pattern: RegExp): { ref: CatalogRef; genre: string } | null {
  const rails = refs.filter((ref) => ref.catalog.type === 'movie' || ref.catalog.type === 'series');
  for (const ref of [...rails.filter((r) => r.catalog.type === 'movie'), ...rails]) {
    const genre = catalogGenres(ref).find((name) => pattern.test(name));
    if (genre) return { ref, genre };
  }
  return null;
}

/** How a chip loads without TMDB, or null when the catalogs can't answer it. */
function fallbackLoader(fallback: ChipFallback, refs: readonly CatalogRef[]): (() => Promise<Title[]>) | null {
  if (!fallback) return null;
  if ('genre' in fallback) {
    const found = fallbackGenre(refs, fallback.genre);
    return found ? () => loadCatalogGenre(found.ref, found.genre) : null;
  }
  if ('mood' in fallback) return () => moodTitles(fallback.mood, refs);
  // A filter over the catalogs' first pages, one entry per film.
  return async () => {
    const seen = new Set<string>();
    const films = (await moodPool('short', refs)).map(({ title }) => title).filter((title) => title.type === 'movie' && !seen.has(title.id) && seen.add(title.id));
    if ('maxMinutes' in fallback) return films.filter((title) => (runtimeMinutes(title.runtime) ?? Infinity) <= fallback.maxMinutes);
    const rating = (title: Title) => Number.parseFloat(title.rating ?? '') || 0;
    return films.filter((title) => rating(title) >= fallback.minRating).sort((a, b) => rating(b) - rating(a));
  };
}

/** A row's heading as text with `{name}` in the accent colour (wherever the language puts it). */
function accentHeading(key: 'homerows.only-on.heading', name: string): (Node | string)[] {
  const mark = '\u0001';
  const [before = '', after = ''] = t(key, { name: mark }).split(mark);
  return [before, h('span', { class: 'accent-name' }, name), after];
}

/** A mood chip Home can offer: its name and how its row loads. */
export interface MoodChip {
  chip: ChipId;
  label: string;
  load(): Promise<Title[]>;
}

/**
 * The chips that can load (with TMDB, all of them; without, those the catalogs can answer),
 * and the person's region (for the country chip). Shared with the phone remote's picker.
 */
export async function moodChips(refs: readonly CatalogRef[], tmdb: boolean): Promise<{ region: string; chips: MoodChip[] }> {
  const region = tmdb ? await streamingRegion() : '';
  const chips = CHIPS.flatMap((chip) => {
    const load = tmdb ? async () => ((await tmdbSourcePage(chipQuery(chip, region), 1))?.titles ?? []).slice(0, CHIP_TITLES) : fallbackLoader(chipFallback(chip), refs);
    return load ? [{ chip, label: chipLabel(chip, region), load }] : [];
  });
  return { region, chips };
}

/**
 * The mood chips row. `refresh()` offers the chips again from `refs()` as it
 * is then (Home calls it when addons or the streaming region change); a
 * picked chip still offered stays picked and its row loads again. Aborting
 * `signal` stops it following the card shape.
 */
export function moodChipsRow(options: { refs: () => readonly CatalogRef[]; tmdb: boolean; actions: TitleActions; signal?: AbortSignal }): HTMLElement & { refresh(): void } {
  const title = t('homerows.chips.title');
  const group = h('div', {
    class: 'chips mood-chips',
    role: 'group',
    'aria-label': title,
  });
  const results = h('div', { class: 'mood-chips-results' });
  const section = h('section', { class: 'rail mood-chips-row' }, h('div', { class: 'rail-header' }, h('div', { class: 'rail-titles' }, h('h2', { class: 'rail-heading' }, title), h('span', { class: 'rail-source' }, t('homerows.chips.hint')))), group, results);
  let picked: ChipId | null = null;
  /** Draws the open chip's row again, in a new card shape. */
  let redraw: (() => void) | null = null;
  document.addEventListener(ROW_STYLE_CHANGED, () => redraw?.(), options.signal ? { signal: options.signal } : {});

  // A chip's row says when nothing fits rather than hide: the chip stays lit, and an empty space under it looks broken.
  // Without TMDB the picks come from the catalogs' first pages, which the detail explains.
  const empty = { title: t('homerows.mood.empty'), ...(options.tmdb ? {} : { detail: t('homerows.mood.empty-detail') }) };
  const rowOf = ({ label, load }: MoodChip) => () => results.replaceChildren(styledRail({ title: label, style: appearance().rowStyle, load, empty }, options.actions));
  let fills = 0;
  const fill = () => {
    const run = ++fills;
    void moodChips(options.refs(), options.tmdb).then(({ region, chips: offered }) => {
      // Refreshes can overlap; an older answer mustn't replace a newer one.
      if (run !== fills) return;
      const chips = offered.map((offer) => {
        const { chip, label } = offer;
        // The country chip shows just the country's short name beside its globe, so it isn't twice
        // as wide as the rest (and reads right in every language); its name and tooltip say it whole.
        const country = chip === 'country';
        const button = h(
          'button',
          {
            class: 'chip mood-chip',
            'aria-pressed': String(picked === chip),
            'data-focus-id': `mood-chip:${chip}`,
            ...(country ? { title: label, 'aria-label': label } : {}),
          },
          icon(CHIP_ICONS[chip]),
          h('span', {}, country ? regionShortName(region) : label),
        );
        button.addEventListener('click', () => {
          picked = picked === chip ? null : chip;
          for (const other of group.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button && picked === chip));
          redraw = picked ? rowOf(offer) : null;
          if (redraw) redraw();
          else results.replaceChildren();
        });
        return button;
      });
      // A picked chip still offered loads again from the catalogs as they are now; one that's gone closes its row.
      const still = offered.find((offer) => offer.chip === picked);
      if (!still) picked = null;
      redraw = still ? rowOf(still) : null;
      if (redraw) redraw();
      else results.replaceChildren();
      // Redrawing replaces the chips; focus goes back to the same one.
      const focused = document.activeElement instanceof HTMLElement && group.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
      group.replaceChildren(...chips);
      if (focused) chips.find((chip) => chip.dataset.focusId === focused)?.focus();
      section.hidden = !chips.length;
    });
  };
  fill();
  return Object.assign(section, { refresh: fill });
}

/**
 * "Only on…": the region's services as tiles (the first one picked), with the picked one's popular titles below.
 * `refresh()` offers the services again if the streaming region changed (the picked one stays picked if it's still
 * offered). Aborting `signal` stops it following the card shape.
 */
export function onlyOnRow(actions: TitleActions, ctx: RoomContext, signal?: AbortSignal): HTMLElement & { refresh(): void } {
  const results = h('div', { class: 'only-on-results' });
  const section = h('div', { class: 'only-on-row', hidden: true });

  let shown: (() => void) | null = null;
  let picked: string | null = null;
  // The picked service's row follows the card shape.
  document.addEventListener(ROW_STYLE_CHANGED, () => shown?.(), signal ? { signal } : {});
  const show = (service: StreamingService, region: string) => {
    shown = () => show(service, region);
    picked = service.key;
    for (const tile of section.querySelectorAll<HTMLElement>('.only-on-tile')) tile.setAttribute('aria-pressed', String(tile.dataset.service === service.key));
    const row = styledRail(
      {
        title: t('homerows.only-on.heading', { name: service.name }),
        style: appearance().rowStyle,
        onSeeAll: () => ctx.open(createServicePage(service, region, ctx)),
        load: async () => (await streamingCatalog(service.key, region)) ?? [],
      },
      actions,
    );
    row.querySelector('.rail-heading')?.replaceChildren(...accentHeading('homerows.only-on.heading', service.name));
    results.replaceChildren(row);
  };

  /** The region the services shown are for, and which listing is the latest asked for. */
  let shownRegion: string | null = null;
  let fills = 0;
  const fill = () => {
    const run = ++fills;
    void streamingRegion()
      .then(async (region) => {
        // Picking services (which also says the streaming settings changed) doesn't change this row.
        if (region === shownRegion) return;
        const services = (await streamingServices(region)) ?? [];
        if (run !== fills) return;
        shownRegion = region;
        const tiles = services.map((service) => {
          const tile = h(
            'button',
            {
              class: 'service-card only-on-tile',
              'aria-pressed': 'false',
              'data-service': service.key,
              'data-focus-id': `only-on:${service.key}`,
            },
            serviceLogo(service),
            h('span', {}, service.name),
          );
          tile.addEventListener('click', () => show(service, region));
          return tile;
        });
        // Redrawing replaces the tiles; focus goes back to the same one if it's still there.
        const focused = document.activeElement instanceof HTMLElement && section.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
        section.replaceChildren(rail({ title: t('homerows.only-on.title'), cards: tiles }), results);
        section.hidden = !services.length;
        const first = services.find((service) => service.key === picked) ?? services[0];
        if (first) show(first, region);
        else {
          shown = null;
          picked = null;
          results.replaceChildren();
        }
        if (focused) tiles.find((tile) => tile.dataset.focusId === focused)?.focus();
      })
      .catch((err: unknown) => {
        console.warn('Could not list the streaming services', err);
        if (run !== fills || waiting) return;
        // Offline or TMDB didn't answer: asked again once back online or the next time Home shows, whichever comes first.
        waiting = new AbortController();
        const again = () => {
          waiting?.abort();
          waiting = null;
          if (!signal?.aborted) fill();
        };
        window.addEventListener('online', again, { signal: waiting.signal });
        document.addEventListener(HOME_SHOWN, again, { signal: waiting.signal });
      });
  };
  /** Set while a failed listing waits to be asked again. */
  let waiting: AbortController | null = null;
  fill();
  return Object.assign(section, { refresh: fill });
}
