/**
 * "Watched" on browsing cards (posters, landscape and Top 10 cards): a check
 * in the artwork's corner and dimmed artwork, so titles the profile finished
 * are easy to pass over. A title part-way through gets a progress bar along
 * the artwork's bottom instead, and a show its episode ("S2 · E4") in the
 * corner (posters and landscape cards). Only from watch history already in
 * memory, so no card asks for anything of its own. Marks follow history as
 * it changes: the page on screen at once, kept pages when they're shown again.
 */
import { VIEW_SHOWN } from '../app/router';
import type { Title } from '../catalog/titles';
import { t } from '../i18n';
import { h } from '../lib/dom';
import { cardProgress, isWatched, newEpisodeCount, onWatchChange } from '../library/watch';
import { showsWatchedMark } from '../library/watched-mark';
import { appearance } from '../theme/appearance';
import { icon } from './icons';

const MARKED = '[data-watch-mark]';
const titles = new WeakMap<HTMLElement, Title>();
/** A card's own accessible name, for cards that set one (Top 10's "No. 1, …"). */
const labels = new WeakMap<HTMLElement, string>();
/** Bumped whenever marks may have changed; a kept page is brought up to date when it's shown. */
let version = 0;
const upToDate = new WeakMap<Element, number>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  onWatchChange(refreshWatchedMarks);
  // VIEW_SHOWN doesn't bubble, but it still passes the document on its way down.
  document.addEventListener(
    VIEW_SHOWN,
    (event) => {
      const view = event.target;
      if (view instanceof Element && upToDate.get(view) !== version) {
        upToDate.set(view, version);
        apply(view);
      }
    },
    true,
  );
}

/** Lets a card carry the mark, and marks it now if its title was watched. */
export function markWatched<T extends HTMLElement>(card: T, title: Title): T {
  listen();
  titles.set(card, title);
  const label = card.getAttribute('aria-label');
  if (label) labels.set(card, label);
  card.dataset.watchMark = '';
  update(card);
  return card;
}

/** Brings every card's mark up to date (after watch history or the setting changed). */
export function refreshWatchedMarks(): void {
  version++;
  apply(document);
}

function apply(root: ParentNode): void {
  for (const card of root.querySelectorAll<HTMLElement>(MARKED)) update(card);
}

function update(card: HTMLElement): void {
  const title = titles.get(card);
  if (!title) return;
  const on = showsWatchedMark({ type: title.type, watched: isWatched(title), newEpisodes: newEpisodeCount(title.id), enabled: appearance().watchedMarks });
  updateProgress(card, title, on);
  if (card.classList.contains('is-watched') === on) return;
  card.classList.toggle('is-watched', on);
  const frame = card.querySelector('.frame');
  if (on) frame?.append(h('span', { class: 'watched-mark', role: 'img', 'aria-label': t('browse.cards.watched'), title: t('browse.cards.watched') }, icon('check')));
  else frame?.querySelector('.watched-mark')?.remove();
  const label = labels.get(card);
  if (label) card.setAttribute('aria-label', on ? t('browse.cards.watched-label', { name: label }) : label);
}

/**
 * The progress bar and episode badge this module adds (marked `data-auto`),
 * kept current. A card whose page drew its own (Continue Watching, My
 * Library) or that has a corner badge already ("New", "2 new") keeps those.
 */
function updateProgress(card: HTMLElement, title: Title, watched: boolean): void {
  const frame = card.querySelector<HTMLElement>('.frame.poster-frame, .frame.still-frame');
  if (!frame) return;
  const found = !watched && appearance().watchedMarks ? cardProgress(title.id) : null;
  const barClass = frame.classList.contains('still-frame') ? 'still-progress' : 'poster-progress';
  let bar = frame.querySelector<HTMLElement>(`.${barClass}[data-auto]`);
  const ownBar = frame.querySelector(`.${barClass}:not([data-auto])`);
  if (found && !ownBar) {
    bar ??= frame.appendChild(h('span', { class: barClass, 'data-auto': '' }, h('span', { class: 'progress-fill' })));
    bar.style.setProperty('--progress', String(found.progress));
  } else bar?.remove();
  let badge = frame.querySelector<HTMLElement>('.poster-badge[data-auto]');
  const ownBadge = frame.querySelector('.poster-badge:not([data-auto])');
  if (found?.episode && !ownBadge) {
    badge ??= frame.appendChild(h('span', { class: 'poster-badge episode-badge', 'data-auto': '' }));
    badge.textContent = found.episode;
  } else badge?.remove();
}
