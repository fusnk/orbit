/**
 * Watched state in the player's episode lists (the Episodes panel and the
 * docked list): a thin bar on the picture of an episode part-watched, a
 * check on one watched, and a button to mark it watched or not. The button
 * is its own focus stop beside the row (like the favourite heart), so
 * pressing it never plays the episode.
 */
import type { Episode, Title } from '../../catalog/titles';
import { icon } from '../../components/icons';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { setEpisodeWatched, type EpisodeState } from '../../library/watch';

/** What goes over an episode's picture: the bar for one part-watched, the check for one watched. */
export function watchedMarks(state: EpisodeState): HTMLElement[] {
  if (state.kind === 'watched') return [h('span', { class: 'ep-watched', 'aria-hidden': 'true' }, icon('check'))];
  if (state.kind !== 'in-progress') return [];
  const bar = h('span', { class: 'ep-progress', 'aria-hidden': 'true' });
  bar.style.setProperty('--fraction', String(Math.min(1, Math.max(0, state.progress))));
  return [bar];
}

/** Marks the episode watched, or not. The lists redraw when watch history changes. */
export function watchedToggle(show: Title, season: number, episode: Episode, watched: boolean, options: { className: string; focusId: string }): HTMLButtonElement {
  const code = t('titles.common.episode-code', { season, episode: episode.number });
  const label = t(watched ? 'pstream.episodes.mark-unwatched' : 'pstream.episodes.mark-watched', { episode: code });
  const button = h('button', { class: `watched-toggle ${options.className}`, 'aria-pressed': String(watched), 'aria-label': label, title: label, 'data-focus-id': options.focusId }, icon('check'));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setEpisodeWatched(show, season, episode, !watched);
  });
  return button;
}
