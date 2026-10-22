/**
 * The Showcase title page's hero (Settings → Appearance → Title page): the
 * art across the whole window behind the title bar, the logo, a meta row
 * (ratings, year, runtime, when it would end, age rating), the synopsis, one
 * context-aware Play button, then Trailer and round buttons. The data and
 * actions are the Classic hero's (index.ts passes them in).
 */
import { networkLogo } from '../../components/title-logo';
import type { TitleExtras } from '../../catalog/extras';
import { runtimeMinutes } from '../../catalog/runtime';
import { episodic, runtimeLabel, type Title } from '../../catalog/titles';
import { ageRatingSlot } from '../../components/age-rating';
import { whereToWatchSlot } from '../../components/where-to-watch';
import { icon } from '../../components/icons';
import { ratingBadge } from '../../components/rating-badge';
import { formatList, t } from '../../i18n';
import { formatClock } from '../../lib/clock';
import { h } from '../../lib/dom';
import { inLibrary } from '../../library/library';
import { episodeState, isWatched, movieProgress } from '../../library/watch';
import type { QualityBadge } from '../../lib/quality-badges';
import { nextEpisode, nothingAired, primaryLabel } from './title-actions';

/** How often "Ends at" catches up with the clock. */
const ENDS_TICK_MS = 30_000;

// "2h 22min" as well as "142 min" (parseInt read the former as 2).
const minutes = runtimeMinutes;

/** The Play button's words: what it does, and a quieter line under it when there's more to say. */
export function primaryAction(title: Title): { label: string; sub?: string | undefined } {
  const total = minutes(title.runtime);
  const left = (progress: number) => (total ? t('titles.detail.min-left', { minutes: Math.max(1, Math.round((1 - progress) * total)) }) : undefined);
  if (!episodic(title)) {
    const progress = movieProgress(title);
    return progress > 0 ? { label: primaryLabel(title), sub: left(progress) } : { label: t('titles.actions.play') };
  }
  const ref = nextEpisode(title);
  if (!ref) return { label: nothingAired(title) ? t('titles.detail.not-aired') : t('titles.actions.play') };
  const code = { season: ref.season, episode: ref.episode.number };
  const state = episodeState(title, ref.season, ref.episode);
  if (state.kind === 'in-progress') return { label: primaryLabel(title), sub: left(state.progress) };
  const started = state.kind === 'up-next' || (title.seasons ?? []).some((s) => s.episodes.some((e) => episodeState(title, s.number, e).kind === 'watched'));
  return started ? { label: t('titles.actions.play-episode', code), sub: t('titles.detail.up-next') } : { label: t('showcase.start-episode', code) };
}

/** Minutes of watching Play would start: what's left of the movie, or of the episode up next (a show's runtime is its episodes'). */
export function minutesToWatch(title: Title): number {
  const total = minutes(title.runtime);
  if (!total) return 0;
  if (!episodic(title)) return Math.round((1 - movieProgress(title)) * total);
  const ref = nextEpisode(title);
  const state = ref ? episodeState(title, ref.season, ref.episode) : undefined;
  return state?.kind === 'in-progress' ? Math.round((1 - state.progress) * total) : total;
}

/** "Ends at 11:32 PM": now plus `minutes`, in the local time format. */
export function endsAt(now: Date, minutes: number): string {
  const end = new Date(now.getTime() + minutes * 60_000);
  return t('showcase.ends-at', { time: formatClock(end) });
}

/** The "Ends at" line, kept in step with the clock while it's on the page (the Classic hero's too, as `className`). */
export function endsAtLine(minutes: number, className = 'sc-meta-item sc-ends'): HTMLElement {
  const line = h('span', { class: className, title: t('showcase.ends-at-hint') }, endsAt(new Date(), minutes));
  // Held weakly: the timer only stops at its next tick, and holding the line kept a title page that
  // was closed (or redrawn) alive with all its artwork for up to that long. Out of the page it only
  // waits: a title page kept behind another view (a person, the player) shows it again on Back.
  const ref = new WeakRef(line);
  const timer = window.setInterval(() => {
    const el = ref.deref();
    if (!el) return window.clearInterval(timer);
    if (el.isConnected) el.textContent = endsAt(new Date(), minutes);
  }, ENDS_TICK_MS);
  return line;
}

export interface ShowcaseHeroParts {
  title: Title;
  /** The episode list is still loading (a show can't start yet). */
  loading: boolean;
  extras: TitleExtras | null;
  quality: QualityBadge[];
  /** The trailer behind the art, and its speaker button (hero-trailer.ts). */
  trailerMedia: readonly HTMLElement[];
  trailerButton: HTMLElement;
  /** Your own rating (my-rating.ts), kept across redraws. */
  myRating: HTMLElement;
  /** The Download button, made compact. */
  download: HTMLElement | '';
  /** "Play on…" another device (Orbit Connect); hidden while there's none to play on. */
  playOn: HTMLElement;
  /** The art and the title's heading, as the Classic hero makes them. */
  art: HTMLElement | '';
  heading: HTMLElement;
  onPlay(): void;
  onTrailer(): void;
  onLibrary(): void;
  onMore(anchor: HTMLElement): void;
  onGenre(genre: string): void;
}

/** The hero's children, ready for `replaceChildren`. */
export function showcaseHero(p: ShowcaseHeroParts): (Node | string)[] {
  const { title } = p;
  const isSeries = episodic(title);
  const action = primaryAction(title);

  const play = h(
    'button',
    { class: 'button large primary sc-play', 'data-autofocus': true, 'data-focus-id': 'play', disabled: (title.type !== 'movie' && p.loading) || nothingAired(title) },
    icon('play', { filled: true }),
    h('span', { class: 'sc-play-text' }, h('span', { class: 'sc-play-label' }, action.label), action.sub ? h('span', { class: 'sc-play-sub' }, action.sub) : ''),
  );
  play.addEventListener('click', p.onPlay);

  // Trailers come with the full details, so the pill waits for them.
  const trailer = title.trailers?.length ? h('button', { class: 'button large glass sc-pill', 'data-focus-id': 'trailer' }, icon('play'), t('titles.detail.trailer')) : '';
  if (trailer) trailer.addEventListener('click', p.onTrailer);

  const saved = inLibrary(title.id);
  const libraryLabel = saved ? t('titles.actions.remove-library') : t('titles.actions.add-library');
  const library = h('button', { class: 'button large glass icon-only sc-round', title: libraryLabel, 'aria-label': libraryLabel, 'aria-pressed': String(saved), 'data-focus-id': 'library' }, icon(saved ? 'check' : 'plus'));
  library.addEventListener('click', p.onLibrary);

  const more = h('button', { class: 'button large glass icon-only sc-round', title: t('titles.detail.more-actions'), 'aria-label': t('titles.detail.more-actions'), 'aria-haspopup': 'menu', 'data-focus-id': 'more' }, icon('more'));
  more.addEventListener('click', () => p.onMore(more));

  const credit = isSeries ? title.writer : title.director;
  const description = p.extras?.overview ?? title.description;
  // TMDB's names once known, so they match Details (translated where the interface isn't English).
  const genres = p.extras?.facts?.genres.length ? p.extras.facts.genres : title.genres;
  return [
    h('div', { class: 'sc-hero-media', 'aria-hidden': 'true' }, p.art, ...p.trailerMedia, h('div', { class: 'detail-shade' })),
    h(
      'div',
      { class: 'detail-content' },
      h(
        'div',
        { class: 'detail-main' },
        p.extras?.logos.length
          ? h('span', { class: 'title-logos' }, ...p.extras.logos.map(networkLogo))
          : '',
        p.heading,
        metaRow(p),
        genres.length
          ? h(
              'div',
              { class: 'genre-chips' },
              ...genres.map((genre) => {
                const chip = h('button', { class: 'genre-chip', dir: 'auto' }, genre);
                chip.addEventListener('click', () => p.onGenre(genre));
                return chip;
              }),
            )
          : '',
        description ? h('p', { class: 'detail-desc sc-desc' }, description) : '',
        h('div', { class: 'hero-actions sc-actions' }, play, trailer, h('span', { class: 'sc-round-group' }, p.playOn, library, p.download, more)),
        p.myRating,
      ),
      credit?.length || title.cast?.length
        ? h(
            'dl',
            { class: 'detail-credits' },
            title.cast?.length ? h('div', {}, h('dt', {}, t('titles.detail.starring')), h('dd', {}, formatList(title.cast.slice(0, 4)))) : '',
            credit?.length ? h('div', {}, h('dt', {}, isSeries ? t('titles.detail.created-by') : t('titles.detail.director')), h('dd', {}, formatList(credit))) : '',
          )
        : '',
    ),
    p.trailerButton,
  ];
}

/** ★ IMDb · TMDB · Letterboxd · year · runtime · ends at · age rating · quality, each when known. */
function metaRow(p: ShowcaseHeroParts): HTMLElement {
  const { title, extras } = p;
  const items: HTMLElement[] = [];
  if (title.rating) items.push(ratingBadge('imdb', title.rating));
  if (extras?.tmdb) items.push(ratingBadge('tmdb', extras.tmdb.toFixed(1), t('titles.detail.tmdb-average')));
  if (extras?.letterboxd) items.push(ratingBadge('letterboxd', extras.letterboxd.toFixed(1), t('titles.detail.letterboxd-average')));
  if (title.year?.trim()) items.push(h('span', { class: 'sc-meta-item' }, title.year.trim()));
  if (title.runtime?.trim()) items.push(h('span', { class: 'sc-meta-item' }, icon('clock'), h('span', { dir: 'auto' }, runtimeLabel(title.runtime.trim()) ?? '')));
  const watchMinutes = minutesToWatch(title);
  if (watchMinutes > 0 && !p.loading) items.push(endsAtLine(watchMinutes));
  const dot = () => h('span', { class: 'meta-dot', 'aria-hidden': 'true' }, '·');
  const quality = p.quality.length ? [h('span', { class: 'quality-badges', title: t('titles.detail.quality-hint') }, ...p.quality.map((badge) => h('span', { class: 'quality-badge' }, badge)))] : [];
  const row = h('div', { class: 'hero-meta sc-meta' }, ...items.flatMap((item, i) => (i ? [dot(), item] : [item])), ageRatingSlot(title, { dot: items.length > 0 }), whereToWatchSlot(title), ...quality);
  if (isWatched(title)) row.append(h('span', { class: 'watched-pill' }, icon('check'), t('titles.common.watched')));
  return row;
}
