/**
 * Franchise collections, from TMDB (optional in Orbit; without a token they
 * simply don't appear on title pages): "Part of …" on a movie's page, with the
 * films in release order, and the collection's own page.
 */
import { markActivity } from '../../app/activity';
import type { RoomContext } from '../../app/router';
import { titleCollection, tmdbCollection, type Franchise } from '../../catalog/tmdb';
import type { Title } from '../../catalog/titles';
import { artImage, rail } from '../../components/cards';
import { icon } from '../../components/icons';
import { connectTmdbButton, errorState, stateMessage } from '../../components/state-message';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { isWatched } from '../../library/watch';
import { titleHandlers } from '../detail/open';
import { titleCard } from '../title-card';
import { playInOrder, queueInOrder } from './parts';
import './collections.css';

function actions(franchise: Franchise, ctx: RoomContext, withOpen: boolean): HTMLElement {
  const play = h('button', { class: 'button primary', 'data-focus-id': 'franchise-play' }, icon('play', { filled: true }), t('collections.franchise.play'));
  play.addEventListener('click', () => void playInOrder(franchise.parts, ctx));
  const queue = h('button', { class: 'button glass', 'data-focus-id': 'franchise-queue' }, icon('plus'), t('collections.franchise.queue'));
  queue.addEventListener('click', () => void queueInOrder(franchise.parts));
  const open = withOpen ? h('button', { class: 'button glass', 'data-focus-id': 'franchise-open' }, t('collections.franchise.view')) : '';
  if (open) open.addEventListener('click', () => ctx.open(createFranchisePage(franchise, ctx)));
  return h('div', { class: 'hero-actions' }, play, queue, open);
}

/** A film's card, with its watched mark, and "This one" on the title being looked at. */
function partCard(title: Title, current: string | undefined, ctx: RoomContext): HTMLElement {
  const { openDetail, withMenu } = titleHandlers(ctx);
  const here = title.id === current;
  return titleCard(title, () => openDetail(title), { watched: isWatched(title), ...(here ? { badge: t('collections.franchise.this-one') } : {}) }, (card) => {
    if (here) {
      card.classList.add('franchise-current');
      card.setAttribute('aria-current', 'true');
    }
    return withMenu(card, title);
  });
}

/**
 * Fills `slot` (on a movie's page) with its franchise, if TMDB knows one.
 * Returns a redraw for when watch marks change.
 */
export function fillFranchise(slot: HTMLElement, title: Title, ctx: RoomContext): () => void {
  let franchise: Franchise | undefined;
  const draw = () => {
    if (!franchise || franchise.parts.length < 2) return;
    const focusId = document.activeElement instanceof HTMLElement && slot.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    const watched = franchise.parts.filter(isWatched).length;
    slot.hidden = false;
    slot.replaceChildren(
      h(
        'div',
        { class: 'franchise-header' },
        h('div', { class: 'rail-titles' }, h('span', { class: 'eyebrow' }, t('collections.franchise.part-of')), h('h2', { class: 'section-title' }, franchise.name), h('span', { class: 'rail-source' }, tn('collections.franchise.watched', franchise.parts.length, { watched }))),
        actions(franchise, ctx, true),
      ),
      rail({ title: '', cards: franchise.parts.map((part) => partCard(part, title.id, ctx)) }),
    );
    if (focusId) slot.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
  };
  // No token, or not part of a franchise: nothing shows (no hint on title pages).
  titleCollection(title)
    .then((found) => {
      franchise = found ?? undefined;
      draw();
    })
    .catch((err: unknown) => console.warn('No franchise', err));
  return draw;
}

/** A franchise's page: backdrop, overview, its films in order. */
export function createFranchisePage(from: Franchise | number, ctx: RoomContext): HTMLElement {
  const page = h('div', { class: 'collection-page' }, h('div', { class: 'skeleton person-skeleton', 'aria-hidden': 'true' }));
  markActivity(page, t('collections.activity'));

  function render(franchise: Franchise): void {
    page.replaceChildren(
      h(
        'header',
        { class: 'collection-hero' },
        franchise.backdrop ? artImage(franchise.backdrop, 'collection-hero-art', true) : '',
        h('div', { class: 'collection-hero-shade', 'aria-hidden': 'true' }),
        h(
          'div',
          { class: 'collection-hero-text' },
          h('span', { class: 'eyebrow' }, t('collections.franchise.eyebrow')),
          h('h1', { class: 'page-title' }, franchise.name),
          h('p', { class: 'muted' }, tn('collections.franchise.count', franchise.parts.length)),
          franchise.overview ? h('p', { class: 'collection-overview' }, franchise.overview) : '',
          franchise.parts.length ? actions(franchise, ctx, false) : '',
        ),
      ),
      h('div', { class: 'title-grid' }, ...franchise.parts.map((part) => partCard(part, undefined, ctx))),
      h('p', { class: 'facts-source' }, t('titles.person.from-tmdb')),
    );
    page.querySelector<HTMLElement>('[data-focus-id="franchise-play"]')?.setAttribute('data-autofocus', '');
  }

  const load = (id: number): void =>
    void tmdbCollection(id)
      .then((franchise) => (franchise ? render(franchise) : page.replaceChildren(stateMessage({ icon: 'link', title: t('states.tmdb.title'), detail: t('states.tmdb.detail'), action: connectTmdbButton(ctx.go) }))))
      .catch((err: unknown) => page.replaceChildren(errorState({ title: t('collections.page.failed'), err, retry: () => load(id), go: ctx.go, service: 'tmdb' })));
  if (typeof from !== 'number') render(from);
  else load(from);
  return page;
}
