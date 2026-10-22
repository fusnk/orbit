/**
 * Pause screen (as on Netflix): a few seconds into a pause with no input,
 * the controls give way to what's playing — the title, the episode, its
 * summary, a few genres, the time left and when it ends (allowing for the
 * speed) — over a dimmed picture. Any input brings the controls back.
 */
import { loadMeta } from '../../catalog/service';
import { genreLine, type Title } from '../../catalog/titles';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import { isFavouriteEpisode } from '../../library/favourite-episodes';
import { icon } from '../../components/icons';
import { ageRatingSlot } from '../../components/age-rating';
import { titleHeading } from '../../components/title-logo';
import type { EpisodeRef } from '../detail/title-actions';
import { clockTime, finishTime } from './time-readout';

const DELAY_MS = 5000;

export interface PauseInfoHost {
  /** Swaps the controls for the pause screen, or back. */
  setShown(on: boolean): void;
  /** False while something else needs the screen (a panel, an error, the loading screen). */
  canShow(): boolean;
  /** `speed`: as mpv reports it, for when it ends. */
  current(): { title: Title; episode?: EpisodeRef | undefined; secondsLeft: number | null; speed: number };
}

export function createPauseInfo(host: PauseInfoHost) {
  const element = h('div', { class: 'pause-info', 'aria-hidden': 'true' });
  let timer: number | undefined;

  function show(): void {
    if (!host.canShow()) return;
    const { title, episode, secondsLeft, speed } = host.current();
    const summary = episode?.episode.overview ?? title.description;
    const remaining = secondsLeft !== null && secondsLeft > 0 ? secondsLeft : 0;
    const left = remaining ? t('player.pause.left', { minutes: Math.max(1, Math.round(remaining / 60)) }) : '';
    const ends = remaining ? t('pstream.pause.ends', { time: clockTime(finishTime(Date.now(), 0, remaining, speed), locale()) }) : '';
    const genres = genreLine(title);
    const mark = titleHeading('span', 'pause-info-title', title);
    const about = h('p', { class: 'pause-info-summary', hidden: !summary }, summary ?? '');
    element.replaceChildren(
      h('span', { class: 'eyebrow' }, t('player.pause.watching')),
      mark,
      episode
        ? h(
            'span',
            { class: 'pause-info-episode' },
            t('player.pause.episode', { season: String(episode.season), episode: String(episode.episode.number), title: episode.episode.title }),
            // A favourite episode says so (the heart itself is on the controls).
            isFavouriteEpisode(title.id, episode.season, episode.episode.number) ? icon('heart', { filled: true }) : '',
          )
        : '',
      about,
      h(
        'span',
        { class: 'pause-info-line' },
        ageRatingSlot(title),
        genres ? h('span', { class: 'pause-info-genres' }, genres) : '',
        left ? h('span', { class: 'pause-info-left' }, left) : '',
        ends ? h('span', { class: 'pause-info-ends' }, ends) : '',
      ),
    );
    host.setShown(true);
    // A title opened from a list (Search, a row) may lack its summary: the full details have it (cached).
    if (summary || episode || !/^tt\d+$/.test(title.id)) return;
    void loadMeta(title.type, title.id)
      .then((full) => {
        if (!full || !mark.isConnected) return;
        if (full.description) {
          about.textContent = full.description;
          about.hidden = false;
        }
      })
      .catch(() => {});
  }

  function hide(): void {
    window.clearTimeout(timer);
    host.setShown(false);
  }

  return {
    element,
    /** Paused: show the screen if nothing happens for a few seconds. */
    arm(): void {
      hide();
      timer = window.setTimeout(show, DELAY_MS);
    },
    hide,
    /** Input while paused: back to the controls, and wait again. */
    wake(paused: boolean): void {
      hide();
      if (paused) timer = window.setTimeout(show, DELAY_MS);
    },
  };
}
