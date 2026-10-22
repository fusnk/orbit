/**
 * The Episodes list docked on the right (Settings → Player → Episodes list:
 * Docked), for shows: a season picker, then each episode with its picture,
 * number and length, name and synopsis. It folds away to a slim "S1 · E3" tab.
 *
 * It lies over the picture, fading in from the right, rather than shrinking
 * the video beside it. Shrinking would mean moving mpv's picture (its video
 * margins) each time the list opens or folds: the picture and its subtitles
 * would jump and re-wrap mid-line, and subtitles would end up in a narrower
 * frame. Over the picture, mpv is never touched, subtitles stay exactly where
 * they were (the gradient keeps the list readable over a bright scene), and
 * folding it is instant.
 */
import type { Episode, Title } from '../../catalog/titles';
import { favouriteHeart } from '../../components/favourite-heart';
import { icon } from '../../components/icons';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { episodeName, hiddenFor } from '../../library/spoilers';
import { episodeState, onWatchChange } from '../../library/watch';
import type { EpisodeRef } from '../detail/title-actions';
import { watchedMarks, watchedToggle } from './episode-marks';
import './favourite.css';

export const EPISODES_DOCKED_KEY = 'player.episodes-docked';

export interface DockHost {
  request(): { title: Title; episode?: EpisodeRef | undefined; live?: boolean | undefined };
  play(season: number, episode: Episode): void;
  showControls(): void;
}

export function createEpisodeDock(host: DockHost) {
  let enabled = false;
  let open = false;
  let season = 1;
  let seasonsOpen = false;

  const seasonButton = h('button', { class: 'dock-season', 'aria-expanded': 'false', 'data-focus-id': 'dock-season' });
  const collapse = h('button', { class: 'dock-collapse', title: t('playerplus.dock.collapse'), 'aria-label': t('playerplus.dock.collapse') }, icon('chevronRight'));
  const seasons = h('div', { class: 'dock-seasons', role: 'group', 'aria-label': t('player.episodes.season-group'), hidden: true });
  const list = h('div', { class: 'dock-list' });
  const element = h('aside', { class: 'episode-dock', 'aria-label': t('player.panel.episodes'), hidden: true }, h('div', { class: 'dock-head' }, seasonButton, collapse), seasons, list);
  const tab = h('button', { class: 'dock-tab', hidden: true, title: t('playerplus.dock.expand') });

  const seasonName = (n: number) => (n === 0 ? t('player.episodes.specials') : t('player.episodes.season', { number: String(n) }));

  seasonButton.addEventListener('click', () => {
    seasonsOpen = !seasonsOpen;
    draw();
    if (seasonsOpen) seasons.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  });
  collapse.addEventListener('click', () => setOpen(false, true));
  tab.addEventListener('click', () => setOpen(true, true));

  function draw(): void {
    const { title, episode } = host.request();
    const all = title.seasons ?? [];
    const shown = enabled && !!all.length;
    element.hidden = !shown || !open;
    tab.hidden = !shown || open;
    if (!shown) return;
    tab.replaceChildren(icon('chevronLeft'), h('span', {}, episode ? t('titles.common.episode-code', { season: episode.season, episode: episode.episode.number }) : t('player.panel.episodes')));
    tab.setAttribute('aria-label', t('playerplus.dock.expand'));
    seasonButton.replaceChildren(h('span', {}, seasonName(season)), icon(seasonsOpen ? 'chevronUp' : 'chevronDown'));
    seasonButton.setAttribute('aria-expanded', String(seasonsOpen));
    seasonButton.disabled = all.length < 2;
    seasons.hidden = !seasonsOpen;
    seasons.replaceChildren(
      ...all.map((s) => {
        const b = h('button', { class: 'dock-season-option', 'aria-pressed': String(s.number === season), 'data-focus-id': `dock-season-${s.number}` }, seasonName(s.number), h('span', { class: 'dock-season-count' }, String(s.episodes.length)));
        b.addEventListener('click', () => {
          season = s.number;
          seasonsOpen = false;
          draw();
          list.scrollTop = 0;
          seasonButton.focus({ preventScroll: true });
        });
        return b;
      }),
    );
    const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    const runtime = title.runtime;
    list.replaceChildren(
      ...(all.find((s) => s.number === season)?.episodes ?? []).map((ep) => {
        const playing = episode?.season === season && episode.episode.number === ep.number;
        const state = episodeState(title, season, ep);
        // Spoiler protection, as on the show's page; the episode playing is never hidden.
        const hide = playing ? hiddenFor('in-progress') : hiddenFor(state.kind);
        const thumb = h('span', { class: `dock-thumb${hide.thumbnail ? ' spoiler-art' : ''}` });
        if (ep.thumbnail) {
          const img = h('img', { src: ep.thumbnail, alt: '', loading: 'lazy', decoding: 'async' });
          img.addEventListener('error', () => img.remove(), { once: true });
          thumb.append(img);
        }
        // The one playing has its own ring; its saved progress would lag behind.
        thumb.append(...watchedMarks(playing && state.kind === 'in-progress' ? { kind: 'unwatched' } : state));
        const number = t('playerplus.dock.number', { number: String(ep.number) });
        const watched = state.kind === 'watched' ? t('pstream.episodes.watched') : '';
        const meta = playing ? t('player.episodes.playing', { number: String(ep.number) }) : ep.airs ? (hide.airDate ? `${number} · ${t('titles.detail.not-aired')}` : t('player.episodes.airs', { number: String(ep.number), date: ep.airs })) : [number, runtime, watched].filter(Boolean).join(' · ');
        const row = h(
          'button',
          { class: `dock-row${playing ? ' playing' : ''}`, 'aria-current': playing ? 'true' : 'false', disabled: !!ep.airs, 'data-focus-id': `dock-ep-${season}-${ep.number}` },
          thumb,
          h('span', { class: 'dock-row-text' }, h('span', { class: 'dock-row-meta' }, meta), h('span', { class: 'dock-row-title' }, episodeName(ep.number, ep.title, hide.title)), ep.overview && !hide.description ? h('span', { class: 'dock-row-synopsis' }, ep.overview) : ''),
        );
        row.addEventListener('click', () => host.play(season, ep));
        // Aired episodes get the favourite heart and the watched check on the row's end, each its own focus stop.
        if (ep.airs) return row;
        return h(
          'div',
          { class: 'dock-item' },
          row,
          h(
            'div',
            { class: 'dock-item-actions' },
            favouriteHeart(title, season, ep, { className: 'dock-fav', focusId: `dock-fav-${season}-${ep.number}` }),
            watchedToggle(title, season, ep, state.kind === 'watched', { className: 'dock-watched', focusId: `dock-watched-${season}-${ep.number}` }),
          ),
        );
      }),
    );
    if (focused) list.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  // Marked watched here or elsewhere, or progress saved: the open list follows.
  const stopWatching = onWatchChange(() => {
    if (open && !element.hidden) draw();
  });

  function setOpen(next: boolean, moveFocus: boolean): void {
    open = next;
    if (next) {
      const { episode } = host.request();
      if (episode) season = episode.season;
      seasonsOpen = false;
    }
    draw();
    host.showControls();
    if (!moveFocus) return;
    if (next) {
      const current = list.querySelector<HTMLElement>('[aria-current="true"]') ?? list.querySelector<HTMLElement>('button');
      current?.focus({ preventScroll: false });
      current?.scrollIntoView({ block: 'center' });
    } else tab.focus({ preventScroll: true });
  }

  return {
    element,
    tab,
    /** Whether the Episodes button works the dock rather than the panel. */
    enabled: () => enabled && !!host.request().title.seasons?.length,
    isOpen: () => enabled && open && !element.hidden,
    configure(on: boolean): void {
      enabled = on;
      draw();
    },
    /** The Episodes button or its tab: opens or folds the list. */
    toggle(): void {
      setOpen(!open, true);
    },
    /** Esc with focus in the list: folds it; true if it did. */
    dismiss(): boolean {
      if (!open || !element.contains(document.activeElement)) return false;
      setOpen(false, true);
      return true;
    },
    dispose: stopWatching,
    /** Another title or episode is playing. */
    renderRequest(): void {
      const { episode } = host.request();
      if (episode) season = episode.season;
      draw();
    },
  };
}
