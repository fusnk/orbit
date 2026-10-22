/**
 * A mood's page, opened from Home's "Today on Orbit" tiles: the same titles
 * the mood's row would show (row-render.ts `moodTitles`), as a grid.
 */
import { t } from '../../i18n';
import type { RoomContext } from '../../app/router';
import type { CatalogRef } from '../../catalog/titles';
import { settleCards } from '../../catalog/parental';
import { gridSkeletons } from '../../components/cards';
import { h } from '../../lib/dom';
import { titleHandlers } from '../detail/open';
import { titleCard } from '../title-card';
import type { MoodId } from './moods';
import { moodLabel, moodTitles } from './row-render';

/** Skeletons while the titles load, as many as a row of the grid roughly holds. */
const SKELETONS = 14;

export function createMoodPage(mood: MoodId, refs: readonly CatalogRef[], ctx: RoomContext): HTMLElement {
  const { openDetail, withMenu } = titleHandlers(ctx);
  const label = moodLabel(mood);
  const grid = h('div', { class: 'title-grid', 'aria-busy': 'true' });
  const status = h('div', { class: 'grid-status' });
  const root = h(
    'div',
    { class: 'discover mood-page' },
    h('h1', { class: 'page-title discover-title' }, label),
    h('p', { class: 'muted discover-note' }, t(`homerows.mood.${mood}.hint`)),
    grid,
    status,
  );

  function load(): void {
    status.replaceChildren();
    grid.setAttribute('aria-busy', 'true');
    grid.replaceChildren(...gridSkeletons(SKELETONS));
    moodTitles(mood, refs)
      // Waits briefly for the profile's content limit, so the grid doesn't shrink as ratings arrive.
      .then((titles) => settleCards(titles.map((title) => titleCard(title, () => openDetail(title), {}, (card) => withMenu(card, title)))))
      .then((cards) => {
        grid.replaceChildren(...cards);
        if (!cards.length) status.replaceChildren(message(t('homerows.mood.empty'), t('homerows.mood.empty-detail')));
      })
      .catch((err: unknown) => {
        console.warn('Could not load a mood', err);
        grid.replaceChildren();
        const retry = h('button', { class: 'button' }, t('browse.search.retry'));
        retry.addEventListener('click', load);
        status.replaceChildren(message(t('homerows.mood.failed'), t('homerows.mood.failed-detail'), retry));
      })
      .finally(() => grid.removeAttribute('aria-busy'));
  }
  load();
  return root;
}

function message(title: string, detail: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'grid-message' }, h('span', { class: 'home-message-title' }, title), h('p', { class: 'muted' }, detail), action ?? '');
}
