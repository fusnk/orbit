/**
 * The Cinema layout's own parts (Settings → Player → Cinema). Most of the
 * layout is CSS over the usual controls (cinema.css); this adds what the
 * player lacks: a Close button, the elapsed time under the timeline's start,
 * Subtitles and Audio buttons beside the hub's, and two pills under the
 * timeline. "Info" opens a row with the poster, synopsis, meta and badges,
 * From the beginning and Details; the second pill opens the Episodes panel
 * for a series, or a "More like this" row for a film (TMDB). A film's end
 * is the end screen's, in every layout (end-screen.ts).
 *
 * Nothing here holds playback state: it reads mpv's last status like the
 * rest of the player. Outside Cinema every part stays hidden.
 */
import { loadMeta } from '../../catalog/service';
import { recommendationsFor } from '../../catalog/tmdb';
import type { Title } from '../../catalog/titles';
import { ageRatingSlot } from '../../components/age-rating';
import { artImage, posterCard } from '../../components/cards';
import { icon, type IconName } from '../../components/icons';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';
import type { EpisodeRef } from '../detail/title-actions';
import { continueTarget, infoMeta, streamBadges } from './cinema-info';
import { isFilm } from './end-screen-rules';
import { episodeLine, formatTime } from './format';
import type { PlayableSource } from './panels';
import type { TrackInfo } from './tracks';
import './cinema.css';

/** At most this many titles in the "More like this" row. */
const SIMILAR_MAX = 12;

export interface CinemaHost {
  /** The player root; its data-layout says whether Cinema is on. */
  view: HTMLElement;
  /** Buttons Cinema leaves out (the hub, the pills and the keys cover them). */
  extras: readonly HTMLElement[];
  request(): { title: Title; episode?: EpisodeRef | undefined; source: PlayableSource; live?: boolean | undefined; replay?: boolean | undefined; trailer?: boolean | undefined; local?: boolean | undefined };
  status(): { timePos: number | null; duration: number | null; height: number | null };
  /** Whether the Episodes list (the panel or the docked one) is showing. */
  episodesOpen(): boolean;
  toggleEpisodes(): void;
  openPanel(kind: 'subtitles' | 'audio'): void;
  restart(): void;
  /** Leaves the player for `title`'s page. */
  details(title: Title): void;
  back(): void;
  showControls(): void;
}

export function createCinema(host: CinemaHost) {
  let open: 'info' | 'similar' | null = null;
  let tracks: readonly TrackInfo[] = [];
  /** "More like this" for the playing film: null until TMDB answers (or without a token). */
  let similar: { for: string; titles: Title[] | null } | null = null;
  /** The playing title's full details, when what started playback was a preview without a synopsis or genres. */
  let fullDetails: { for: string; title: Title | null } | null = null;

  for (const el of host.extras) el.classList.add('cinema-extra');

  const active = () => host.view.dataset.layout === 'cinema';

  const iconButton = (label: string, name: IconName, className: string) => h('button', { class: `player-button ${className}`, title: label, 'aria-label': label }, icon(name));
  const pill = (text: string, className: string) => h('button', { class: `cinema-pill ${className}` }, text);

  // ── Top end: Close (Back keeps its key; its button gives way to this one) ──
  const close = iconButton(t('player.controls.close'), 'close', 'cinema-only cinema-close');
  close.addEventListener('click', () => host.back());

  // ── Beside the hub's button: straight to its Subtitles and Audio views ──
  const subtitles = iconButton(t('player.tracks.subtitles'), 'subtitles', 'cinema-only cinema-icon');
  subtitles.addEventListener('click', () => host.openPanel('subtitles'));
  const audio = iconButton(t('player.tracks.audio'), 'volume', 'cinema-only cinema-icon');
  audio.addEventListener('click', () => host.openPanel('audio'));

  // ── Under the timeline's start ──
  const elapsed = h('span', { class: 'cinema-only cinema-elapsed', 'aria-hidden': 'true' });

  // ── The pills, and the row they open ──
  const infoPill = pill(t('playerlook.cinema.info'), 'cinema-info-pill');
  infoPill.addEventListener('click', () => setOpen(open === 'info' ? null : 'info'));
  const morePill = pill('', 'cinema-more-pill');
  morePill.addEventListener('click', () => {
    if (continueTarget(host.request().title, similarCount(), host.request()) === 'episodes') {
      setOpen(null);
      host.toggleEpisodes();
    } else setOpen(open === 'similar' ? null : 'similar');
  });
  const tabs = h('div', { class: 'cinema-only cinema-tabs' }, infoPill, morePill);
  const panel = h('div', { class: 'cinema-only cinema-panel', role: 'region', hidden: true });

  const similarCount = () => (similar?.for === host.request().title.id ? (similar.titles?.length ?? 0) : 0);

  function setOpen(next: typeof open): void {
    open = next;
    renderPanel();
    renderTabs();
    host.showControls();
    if (next) panel.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  function renderTabs(): void {
    const { title } = host.request();
    const target = continueTarget(title, similarCount(), host.request());
    tabs.hidden = !!host.request().live;
    morePill.hidden = !target;
    morePill.textContent = target === 'episodes' ? t('player.controls.episodes') : t('titles.detail.more-like-this');
    infoPill.setAttribute('aria-pressed', String(open === 'info'));
    morePill.setAttribute('aria-pressed', String(target === 'episodes' ? host.episodesOpen() : open === 'similar'));
    if (open === 'similar' && target !== 'similar') setOpen(null);
  }

  /** The playing title, with the addons' details filled in once looked up (see lookUpDetails). */
  function infoTitle(): Title {
    const { title } = host.request();
    const full = fullDetails?.for === title.id ? fullDetails.title : null;
    return full ? { ...title, description: title.description ?? full.description, genres: title.genres.length ? title.genres : full.genres, runtime: title.runtime ?? full.runtime, year: title.year ?? full.year, poster: title.poster ?? full.poster } : title;
  }

  /** A preview (e.g. from search) may lack the synopsis, genres or runtime: the addons' details have them. */
  function lookUpDetails(): void {
    const { title } = host.request();
    if (fullDetails?.for === title.id || (title.description && title.genres.length && title.runtime) || host.request().live) return;
    fullDetails = { for: title.id, title: null };
    loadMeta(title.type, title.id)
      .then((full) => {
        if (fullDetails?.for !== title.id) return;
        fullDetails.title = full;
        if (open === 'info') renderPanel();
      })
      .catch(() => {});
  }

  function infoRow(): Node[] {
    const { episode, source } = host.request();
    const title = infoTitle();
    const summary = episode?.episode.overview?.trim() || title.description?.trim();
    const meta = infoMeta(title, locale());
    const fromStart = pill(t('player.resume.start-over'), 'cinema-action');
    fromStart.addEventListener('click', () => {
      setOpen(null);
      host.restart();
    });
    const details = pill(t('titles.detail.details'), 'cinema-action');
    details.addEventListener('click', () => host.details(title));
    panel.setAttribute('aria-label', title.name);
    return [
      h('span', { class: 'cinema-poster' }, title.poster ? artImage(title.poster, 'art', true) : ''),
      h(
        'div',
        { class: 'cinema-info-text' },
        h('span', { class: 'cinema-info-title' }, title.name),
        episode ? h('span', { class: 'cinema-info-episode' }, episodeLine(episode.season, episode.episode.number, episode.episode.title)) : '',
        summary ? h('p', { class: 'cinema-info-summary' }, summary) : '',
        h(
          'div',
          { class: 'cinema-info-meta' },
          ...meta.flatMap((part, i) => [i ? h('span', { class: 'meta-dot', 'aria-hidden': 'true' }, '·') : '', h('span', {}, part)]),
          ageRatingSlot(title, { dot: meta.length > 0 }),
          h('span', { class: 'cinema-badges' }, ...streamBadges(host.status().height, source, tracks).map((badge) => h('span', { class: 'cinema-badge' }, badge))),
        ),
      ),
      h('div', { class: 'cinema-actions' }, host.request().live ? '' : fromStart, details),
    ];
  }

  function renderPanel(): void {
    // A redraw (details or tracks arriving) keeps focus on the same button.
    const buttons = () => [...panel.querySelectorAll<HTMLElement>('button')];
    const focused = buttons().indexOf(document.activeElement as HTMLElement);
    panel.hidden = !open;
    panel.dataset.view = open ?? '';
    if (open === 'info') {
      lookUpDetails();
      panel.replaceChildren(...infoRow());
    }
    else if (open === 'similar') {
      panel.setAttribute('aria-label', t('titles.detail.more-like-this'));
      const titles = similar?.titles?.slice(0, SIMILAR_MAX) ?? [];
      panel.replaceChildren(h('div', { class: 'cinema-similar' }, ...titles.map((rec) => posterCard(rec, () => host.details(rec)))));
    } else panel.replaceChildren();
    if (focused >= 0) buttons()[focused]?.focus({ preventScroll: true });
  }

  /** Asks TMDB once per film for "More like this" (only while Cinema is on). */
  function lookUpSimilar(): void {
    const { title } = host.request();
    if (!active() || !isFilm(host.request()) || similar?.for === title.id) return;
    similar = { for: title.id, titles: null };
    recommendationsFor(title)
      .then((titles) => {
        if (similar?.for !== title.id) return;
        similar.titles = titles ?? [];
        renderTabs();
      })
      .catch((err: unknown) => console.warn('No recommendations for the player', err));
  }

  return {
    /** Placed by the player: the Close button at the top end, the two icons before the hub's. */
    close,
    icons: [subtitles, audio] as const,
    /** Grid items of the bottom controls (cinema.css places them). */
    bottomParts: [elapsed, tabs, panel] as const,
    /** The pills: controls like the bar's, so the player's keys keep working while one has focus. */
    controls: [tabs] as const,
    /** Where keys work its buttons as in a panel (Space activates, number keys don't jump). */
    regions: [panel] as const,
    /** After each status: the elapsed time and the pill states. */
    render(): void {
      const { timePos, duration } = host.status();
      elapsed.textContent = duration && timePos !== null ? formatTime(timePos) : '';
      lookUpSimilar();
      renderTabs();
      if (!active() && open) setOpen(null);
    },
    /** The title or episode changed. */
    renderRequest(): void {
      if (open) setOpen(null);
      renderTabs();
    },
    setTracks(next: readonly TrackInfo[]): void {
      tracks = next;
      if (open === 'info') renderPanel();
    },
    /** Whether the Info or "More like this" row is open (the controls stay up meanwhile). */
    isOpen: () => open !== null,
    /** Esc or Back: closes the open row and returns to its pill. True if it did. */
    dismiss(): boolean {
      if (!open) return false;
      const pillFor = open === 'info' ? infoPill : morePill;
      setOpen(null);
      pillFor.focus({ preventScroll: true });
      return true;
    },
  };
}
