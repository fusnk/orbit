/**
 * The heart that keeps an episode in My Library → Favourite episodes (see
 * library/favourite-episodes.ts): outlined, or filled while it's a
 * favourite. Its own focus stop, so pressing it never plays the episode
 * beside it. Every heart for the same episode follows a change made by any
 * of them (the player's bar and its episode lists, say).
 */
import type { Episode, Title } from '../catalog/titles';
import { t } from '../i18n';
import { h } from '../lib/dom';
import { isFavouriteEpisode, onFavouriteEpisodesChange, toggleFavouriteEpisode } from '../library/favourite-episodes';
import { icon } from './icons';
import './favourite-heart.css';

export function favouriteHeart(show: Title, season: number, episode: Episode, options: { className?: string; focusId?: string } = {}): HTMLButtonElement {
  const button = h('button', { class: `favourite-heart${options.className ? ` ${options.className}` : ''}`, ...(options.focusId ? { 'data-focus-id': options.focusId } : {}) });
  // Names the episode by number only: its name may be hidden as a spoiler.
  button.setAttribute('aria-label', t('favourites.toggle', { episode: t('titles.common.episode-code', { season, episode: episode.number }) }));

  const draw = (el: HTMLButtonElement): void => {
    const on = isFavouriteEpisode(show.id, season, episode.number);
    el.setAttribute('aria-pressed', String(on));
    el.title = t(on ? 'favourites.remove' : 'favourites.add');
    el.replaceChildren(icon('heart', { filled: on }));
  };

  button.addEventListener('click', (event) => {
    // Inside a row that plays (the player's lists): the heart only hearts.
    event.stopPropagation();
    void toggleFavouriteEpisode(show, season, episode);
  });
  follow(button, () => draw(button));
  draw(button);
  return button;
}

/**
 * Every heart drawn, held weakly, so one gone with a redraw can be freed. One
 * merely out of the page (a title page kept behind another view) keeps
 * following, so it's right on Back. One subscription serves them all: a
 * subscription per heart was only dropped at the next change to the
 * favourites, so with none made in a long session every heart ever drawn
 * (with its show and episode) stayed listed.
 */
const hearts = new Set<WeakRef<HTMLButtonElement>>();
/** Each heart's redraw, kept only as long as the heart. */
const redraws = new WeakMap<HTMLButtonElement, () => void>();
/** The list is swept of freed hearts once it reaches this size; then twice what's left. */
let sweepAt = 64;
let following = false;

function follow(button: HTMLButtonElement, redraw: () => void): void {
  redraws.set(button, redraw);
  hearts.add(new WeakRef(button));
  if (hearts.size >= sweepAt) {
    for (const ref of hearts) if (!ref.deref()) hearts.delete(ref);
    sweepAt = Math.max(64, hearts.size * 2);
  }
  if (following) return;
  following = true;
  onFavouriteEpisodesChange(() => {
    for (const ref of hearts) {
      const el = ref.deref();
      if (el) redraws.get(el)?.();
      else hearts.delete(ref);
    }
  });
}
