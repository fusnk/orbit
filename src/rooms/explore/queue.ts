/**
 * Your Discovery Queue: recommendations one at a time, big, with Add to My
 * Library, Not interested and Next. Every action is a button, so keyboard,
 * remote and controller move between them like anywhere else; after each,
 * focus stays on the same action for the next title.
 */
import type { RoomContext } from '../../app/router';
import { fallbackHue, type Title } from '../../catalog/titles';
import { tmdbRating } from '../../catalog/tmdb';
import { backdropImage, withHue } from '../../components/cards';
import { icon } from '../../components/icons';
import { formatDecimal, t } from '../../i18n';
import { artHue } from '../../lib/art-hue';
import { h } from '../../lib/dom';
import { inLibrary, toggleLibrary } from '../../library/library';
import { lastWatchedAt } from '../../library/watch';
import { setAmbientHue } from '../../theme/ambient';
import { titleHandlers } from '../detail/open';
import { hideTitle, notHidden } from './state';

export function createQueuePage(pool: readonly Title[], ctx: RoomContext): HTMLElement {
  const { openDetail } = titleHandlers(ctx);
  // The pool is put together once per visit to Discover: what was saved or started since (in an
  // earlier run through the queue, or anywhere else) is left out when it opens again.
  const titles = pool.filter((title) => notHidden(title) && !inLibrary(title.id) && lastWatchedAt(title.id) === 0);
  let index = 0;
  const stage = h('div', { class: 'explore-queue-stage' });
  const live = h('p', { class: 'explore-live', role: 'status', 'aria-live': 'polite' });
  const root = h('div', { class: 'explore-queue-view' }, stage, live);

  const button = (label: string, run: () => void, className = 'button large glass', id?: string) => {
    const b = h('button', { class: className, ...(id ? { 'data-queue-action': id } : {}) }, label);
    b.addEventListener('click', run);
    return b;
  };

  /** Shows the title at `index` and puts focus back on the action that was used. */
  function draw(focus?: string): void {
    const title = titles[index];
    if (!title) {
      stage.replaceChildren(
        h('div', { class: 'explore-queue-done' }, h('span', { class: 'home-message-title' }, t('explore.queue.done-title')), h('p', { class: 'muted' }, t('explore.queue.done-body')), button(t('titles.common.back'), () => ctx.back(), 'button primary')),
      );
      stage.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
      return;
    }
    const rating = tmdbRating(title.id);
    const added = inLibrary(title.id);
    const add = h('button', { class: 'button large primary', 'data-queue-action': 'add', disabled: added }, icon(added ? 'check' : 'plus'), added ? t('explore.queue.added') : t('explore.queue.add'));
    add.addEventListener('click', () => {
      if (inLibrary(title.id)) return;
      // A failed save brings Add back, but only on this title: by then Next may
      // have moved on, and focus stays on whatever action the person is on.
      void toggleLibrary(title).then(() => {
        if (titles[index] !== title) return;
        const active = document.activeElement as HTMLElement | null;
        draw(active && stage.contains(active) ? active.dataset.queueAction : undefined);
      });
      draw('add');
    });
    const details = h('button', { class: 'button large glass', 'data-queue-action': 'details' }, icon('info'), t('browse.hero.details'));
    details.addEventListener('click', () => openDetail(title));
    const next = h('button', { class: 'button large glass', 'data-queue-action': 'next' }, t('explore.queue.next'), icon('chevronRight'));
    // Where focus lands when the queue opens: Add, or Next once it's saved.
    (added ? next : add).dataset.autofocus = '';
    next.addEventListener('click', () => {
      index++;
      draw('next');
    });
    const hide = button(
      t('explore.queue.not-interested'),
      () => {
        hideTitle(title);
        titles.splice(index, 1);
        draw('hide');
      },
      'button large glass',
      'hide',
    );
    const art = withHue(h('div', { class: 'explore-queue-art' }, backdropImage(title, 'hero-art active', true), h('div', { class: 'hero-shade title-shade', 'aria-hidden': 'true' })), fallbackHue(title.id));
    stage.replaceChildren(
      art,
      h(
        'div',
        { class: 'explore-queue-content' },
        h('span', { class: 'eyebrow' }, t('explore.queue.title'), ' · ', t('explore.queue.position', { index: index + 1, count: titles.length })),
        h('h1', { class: 'hero-title' }, title.name),
        h('div', { class: 'hero-meta' }, ...[title.year, rating === undefined ? undefined : t('explore.queue.rating', { rating: formatDecimal(rating) })].filter((part): part is string => !!part).flatMap((part, i) => (i ? [h('span', { class: 'meta-dot', 'aria-hidden': 'true' }, '·'), h('span', {}, part)] : [h('span', {}, part)]))),
        title.description ? h('p', { class: 'hero-desc' }, title.description) : '',
        h('div', { class: 'hero-actions' }, add, hide, next, details),
      ),
    );
    live.textContent = title.name;
    const target = focus ? stage.querySelector<HTMLElement>(`[data-queue-action="${focus}"]:not(:disabled)`) : null;
    (target ?? (focus ? next : null))?.focus({ preventScroll: true });
    // The page's glow follows the backdrop, like Home's banner.
    if (title.background) {
      void artHue(title.background).then((hue) => {
        if (hue === null || titles[index] !== title) return;
        root.dataset.hue = String(hue);
        if (root.isConnected) setAmbientHue(hue);
      });
    }
  }

  draw();
  return root;
}
