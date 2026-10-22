/**
 * What Play shows while it finds a source: each stream addon in a rolling
 * list, with a ring while it's being asked, then a tick and how many sources
 * it had, "no results", or a cross if it failed. Answered addons move up,
 * the one still being waited on sits in the middle, and the rest fade with
 * their distance from it. It closes when the player opens (whose loading
 * screen then says which addon the video comes from), and Cancel stops the
 * search.
 *
 * streams.ts reports the round as it goes (`SearchWatch`); nothing here
 * changes what's found or how it's ranked.
 */
import type { AddonOrigin, AggregateEvent, Stream } from '../../addons/types';
import { onBack } from '../../app/back';
import type { Title } from '../../catalog/titles';
import { artImage } from '../../components/cards';
import { quipLine } from '../../components/fun-lines';
import { icon } from '../../components/icons';
import { titleHeading } from '../../components/title-logo';
import { t, tn } from '../../i18n';
import { episodeLine } from './format';
import { h } from '../../lib/dom';
import type { EpisodeRef } from '../detail/title-actions';
import { motionReduced } from './grayscale-pause';
import { fadeFor, searchList, sourcesFrom, type AddonState } from './search-list';
import './source-search.css';

/** How Play's search reports each addon (see rankedSources in detail/streams.ts). */
export interface SearchWatch {
  /** The addons being asked, in the person's order. */
  addons(list: readonly AddonOrigin[]): void;
  event(event: AggregateEvent<Stream>): void;
}

const ROW_HEIGHT = 52;

export function showSourceSearch(title: Title, episode: EpisodeRef | undefined) {
  const controller = new AbortController();
  let addons: AddonOrigin[] = [];
  const answered = new Map<string, AddonState>();
  let done = false;
  // Play (or the card) that started the search: focus goes back there when it closes, so it's what Back from the player finds again.
  const returnFocus = document.activeElement;

  const reel = h('ol', { class: 'search-reel' });
  const status = h('p', { class: 'search-status', role: 'status' }, t('playerplus.search.finding'));
  const cancel = h('button', { class: 'button glass small search-cancel' }, t('player.next-up.cancel'));
  const name = titleHeading('span', 'search-title', title);
  const element = h(
    'div',
    { class: 'source-search', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('playerplus.search.label', { name: title.name }) },
    title.background ? artImage(title.background, 'search-art', true) : '',
    h('div', { class: 'search-shade', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'search-card' },
      name,
      episode ? h('span', { class: 'search-episode' }, episodeLine(episode.season, episode.episode.number, episode.episode.title)) : '',
      h('div', { class: 'search-window' }, reel),
      status,
      quipLine('search-quip'),
      cancel,
    ),
  );
  element.classList.toggle('still', motionReduced());

  function draw(): void {
    const { rows, active } = searchList(addons, answered);
    reel.replaceChildren(
      ...rows.map((row, i) => {
        const distance = i - active;
        const mark =
          row.state === 'asking'
            ? h('span', { class: 'search-ring', 'aria-hidden': 'true' })
            : h('span', { class: `search-mark ${row.state}`, 'aria-hidden': 'true' }, icon(row.state === 'failed' ? 'close' : row.state === 'empty' ? 'more' : 'check'));
        const note =
          row.state === 'asking' ? t('playerplus.search.asking') : row.state === 'found' ? tn('playerplus.search.sources', row.count) : row.state === 'empty' ? t('playerplus.search.none') : t('playerplus.search.failed');
        const li = h('li', { class: `search-row ${row.state}${distance === 0 ? ' active' : ''}` }, mark, h('span', { class: 'search-name' }, row.name || t('player.source.unnamed')), h('span', { class: 'search-note' }, note));
        li.style.opacity = String(fadeFor(distance));
        li.style.setProperty('--scale', String(1 - Math.min(3, Math.abs(distance)) * 0.04));
        return li;
      }),
    );
    // The active row sits in the middle of the window.
    reel.style.transform = `translateY(${-active * ROW_HEIGHT}px)`;
    const found = [...answered.values()].reduce((sum, a) => sum + (a.state === 'found' ? a.count : 0), 0);
    status.textContent = !addons.length ? t('playerplus.search.finding') : tn('playerplus.search.progress', answered.size, { total: String(addons.length), found: String(found) });
  }

  const stopBack = onBack(() => controller.abort());
  cancel.addEventListener('click', () => controller.abort());
  controller.signal.addEventListener('abort', () => close(), { once: true });

  function close(): void {
    if (done) return;
    done = true;
    stopBack();
    if (element.contains(document.activeElement) && returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    element.classList.add('leaving');
    window.setTimeout(() => element.remove(), motionReduced() ? 0 : 180);
  }

  document.body.append(element);
  draw();
  cancel.focus({ preventScroll: true });

  const watch: SearchWatch = {
    addons(list) {
      addons = [...list];
      if (!done) draw();
    },
    event(event) {
      if (event.type === 'done') return;
      const { key, name: addonName } = event.origin;
      const count = event.type === 'partial' ? sourcesFrom(event) : 0;
      answered.set(key, event.type === 'error' ? { key, name: addonName, state: 'failed' } : count ? { key, name: addonName, state: 'found', count } : { key, name: addonName, state: 'empty' });
      if (!done) draw();
    },
  };

  return {
    signal: controller.signal,
    watch,
    /** Cancel was pressed (or Esc / Back). */
    cancelled: () => controller.signal.aborted,
    /** Closes it; call before opening the player, so the player's Back returns to what started the search rather than Cancel. */
    close,
  };
}
