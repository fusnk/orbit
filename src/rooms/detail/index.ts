import { networkLogo } from '../../components/title-logo';
import { VIEW_DISCARDED, VIEW_SHOWN, type RoomContext } from '../../app/router';
import { airTimeLabel, exactAirTime, loadAirTimes } from '../../catalog/air-times';
import { reminderButton } from './reminder-button';
import { loadMeta, usableAddons } from '../../catalog/service';
import { arcIndexOf, arcsFor, ratingHeat, seasonRatings, storyArcs, type ArcView, type EpisodeRating } from '../../catalog/episode-extras';
import { titleExtras, type MediaVideo, type TitleExtras, type TitleFacts } from '../../catalog/extras';
import { letterboxdReviews } from '../../catalog/letterboxd';
import { runtimeMinutes } from '../../catalog/runtime';
import { castFor, recommendationsFor, type CastMember } from '../../catalog/tmdb';
import { browsableCatalogs, episodic, fallbackHue, runtimeLabel, type Season, type Title } from '../../catalog/titles';
import { ageRatingSlot } from '../../components/age-rating';
import { whereToWatchSlot } from '../../components/where-to-watch';
import { artImage, backdropImage, rail, titleMeta, withHue } from '../../components/cards';
import { favouriteHeart } from '../../components/favourite-heart';
import { icon } from '../../components/icons';
import { errorText, isOffline, retryWhenOnline } from '../../components/state-message';
import { openMenuFrom, withContextMenu, type MenuItem } from '../../components/menu';
import { ratingBadge } from '../../components/rating-badge';
import { scrollFade, scrollRow } from '../../components/scroll-fade';
import { toast } from '../../components/toast';
import { invoke } from '@tauri-apps/api/core';
import { isAndroid } from '../../lib/platform';
import { formatList, locale, t, tn, type MessageKey } from '../../i18n';
import { artHue } from '../../lib/art-hue';
import { h } from '../../lib/dom';
import { inLibrary, toggleLibrary } from '../../library/library';
import { episodeName, hiddenFor } from '../../library/spoilers';
import { episodeState, isWatched, movieProgress, setEpisodesWatched, setEpisodeWatched, watchVersion } from '../../library/watch';
import { DEFAULT_AMBIENT_HUE, setAmbientHue } from '../../theme/ambient';
import { appearance, reducedMotion } from '../../theme/appearance';
import { createTextField, editingAt, resumeEditing } from '../../components/text-field';
import { isFavouriteEpisode, onFavouriteEpisodesChange } from '../../library/favourite-episodes';
import { findEpisode, jumpTarget, parseEpisodeQuery } from './episode-jump';
import { markActivity } from '../../app/activity';
import './detail.css';
import { createPersonPage } from '../person/person';
import { gateTitlePage } from '../profiles/parental';
import { openPlayer } from '../player';
import { createHeroTrailer } from './hero-trailer';
import { HERO_TRAILER_KEY } from './trailer-settings';
import { fillMedia } from './title-media';
import { fillReviews } from './title-reviews';
import { createMyRating } from './my-rating';
import { knownQuality, loadQuality } from './quality';
import type { QualityBadge } from '../../lib/quality-badges';
import { openStreams, playTitle } from './streams';
import { nextEpisode, nothingAired, primaryLabel, queueMenu, shuffleTitle, titleMenu, type EpisodeRef } from './title-actions';
import { loadQueue } from '../../library/queue';
import { prepareVod } from '../../live/vod';
import { allDownloads, isLiveType, onDownloadsChange } from '../../library/downloads';
import { fillFranchise } from '../collections/franchise';
import { titleCard } from '../title-card';
import { downloadMenuItems, episodeDownloadButton, heroDownloadButton, seasonDownloadButton } from '../downloads/title-downloads';
import { playDownload } from '../downloads/actions';
import { downloadSeason, seasonEpisodes } from '../downloads/auto';
import { titleReleases, titleTopics } from '../../catalog/title-topics';
import { endsAtLine, minutesToWatch, showcaseHero } from './showcase-hero';
import { playOnButton } from '../../app/connect-ui';
import { playMessage } from '../../lib/connect';
import { externalLinkItems } from './external-links';
import { openDiscoverAt } from '../discover';
import { fillExtras, fillPhotos, fillReleases, fillTopics, fillWatch, likeThisRail, seasonPicker } from './showcase-sections';
import './showcase.css';

/** A show with more episodes than this gets "Go to episode…". */
const JUMP_FROM = 24;

/** How long "Mark season as unwatched" waits for its confirming second press. */
const UNMARK_CONFIRM_MS = 4000;

/** How long a movie's page waits before asking for its sources (quality badges). */
const QUALITY_DELAY_MS = 400;

/** Numbers each episode title's id, unique across every title page kept open. */
let episodeTitleIds = 0;
// "2h 22min" as well as "142 min" (parseInt read the former as 2).
const minutes = runtimeMinutes;
const fullDate = new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** The cast as a row, with scroll arrows like the poster rows. */
function castSection(members: HTMLElement[], heading = t('titles.detail.cast')): HTMLElement {
  const row = scrollFade(h('div', { class: 'cast-row' }, ...members));
  const arrow = (dir: 1 | -1) => {
    const button = h('button', { class: 'rail-scroll', title: dir > 0 ? t('titles.detail.scroll-right') : t('titles.detail.scroll-left'), tabindex: '-1' }, icon(dir > 0 ? 'chevronRight' : 'chevronLeft'));
    button.addEventListener('click', () => scrollRow(row, dir));
    return button;
  };
  return h(
    'div',
    { class: 'detail-cast' },
    h('div', { class: 'cast-header' }, h('h2', { class: 'section-title' }, heading), h('span', { class: 'rail-arrows', 'data-nav-skip': true }, arrow(-1), arrow(1))),
    row,
  );
}

const STATUS_LABELS: Record<NonNullable<TitleFacts['status']>, MessageKey> = {
  released: 'titles.detail.status-released',
  returning: 'titles.detail.status-returning',
  ended: 'titles.detail.status-ended',
  canceled: 'titles.detail.status-canceled',
  'in-production': 'titles.detail.status-in-production',
  'post-production': 'titles.detail.status-post-production',
  planned: 'titles.detail.status-planned',
  rumored: 'titles.detail.status-rumored',
  pilot: 'titles.detail.status-pilot',
};

/** "ko" as "Korean", in Orbit's language. */
function languageName(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  try {
    const name = new Intl.DisplayNames(locale(), { type: 'language' }).of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

/** A budget or box office in US dollars, compactly: "$75M". */
const dollars = (amount: number | null | undefined) => (amount ? new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(amount) : undefined);

function formatDate(iso?: string): string | undefined {
  const date = iso ? new Date(iso) : undefined;
  return date && !Number.isNaN(date.getTime()) ? fullDate.format(date) : undefined;
}

/**
 * Title details. Renders at once from the catalog preview, then fills in
 * episodes, credits and facts when the full metadata arrives. A profile's
 * content limit can stop the page (see profiles/parental.ts).
 */
export function createDetail(preview: Title, ctx: RoomContext): HTMLElement {
  return gateTitlePage(preview, ctx, (page) => detailPage(preview, ctx, page));
}

/** The page, drawn into `page` when given. */
function detailPage(preview: Title, ctx: RoomContext, page?: HTMLElement): HTMLElement {
  let title = preview;
  let state: 'loading' | 'ready' | 'failed' = 'loading';
  let season: number | undefined;

  void loadQueue();
  // The IPTV provider's matching films or episodes, ready by the time Play is pressed (see live/vod.ts).
  void prepareVod(preview);
  const root = withHue(page ?? h('article', { class: 'detail' }), fallbackHue(preview.id));
  root.dataset.hue = String(fallbackHue(preview.id));
  // Lets the player's Details button tell whether Back already shows this title's page.
  root.dataset.titleId = preview.id;
  markActivity(root, t('titles.detail.activity'), preview.name, preview.poster);
  const heroSection = h('section', { class: 'detail-hero', 'data-nav-banner': true });
  const episodes = h('section', { class: 'episodes' });
  const lower = h('section', { class: 'detail-lower' });
  const more = h('section', { class: 'detail-more' });
  // TMDB's videos and images, and a film's Letterboxd reviews: hidden until they arrive.
  const media = h('section', { class: 'detail-media', hidden: true });
  const reviews = h('section', { class: 'detail-reviews', hidden: true });
  // "Part of …": the movie's franchise, when TMDB knows one.
  const franchise = h('section', { class: 'detail-franchise', hidden: true });
  // Shown when Settings → Appearance → Title page background is "Blurred backdrop".
  const pageArt = h('div', { class: 'detail-page-art', 'aria-hidden': 'true' });
  // Settings → Appearance → Title page: the Showcase layout's own sections, in its order (see `sections`).
  const showcase = appearance().detailLayout === 'showcase';
  if (showcase) root.classList.add('showcase');
  const extrasSection = h('section', { class: 'detail-media sc-extras', hidden: true });
  const photos = h('section', { class: 'detail-media sc-photos', hidden: true });
  const topics = h('section', { class: 'sc-section sc-topics-section', hidden: true });
  const watch = h('section', { class: 'sc-section sc-watch-section', hidden: true });
  const releases = h('section', { class: 'sc-section sc-releases-section', hidden: true });
  const factsSection = h('section', { class: 'sc-section sc-facts', hidden: true });
  // Why the full details didn't load, under the banner: the catalog's preview stays on screen meanwhile.
  const notice = h('section', { class: 'detail-failure', role: 'status', hidden: true });
  const sections = () =>
    showcase ? [pageArt, heroSection, notice, episodes, extrasSection, lower, photos, more, franchise, topics, watch, releases, reviews, factsSection] : [pageArt, heroSection, notice, episodes, lower, media, reviews, franchise, more];
  const artUrl = preview.background ?? preview.poster;
  // Only plain web addresses, with characters that could end the CSS url() escaped.
  if (artUrl && /^https?:\/\//.test(artUrl)) pageArt.style.setProperty('--detail-art', `url("${artUrl.replace(/["\\\n\r]/g, encodeURIComponent)}")`);

  // A show with nothing aired yet has no episode to start, and without one it would be asked for as a movie.
  const play = (ref?: EpisodeRef) => void (ref || !nothingAired(title) ? playTitle(title, ref ? { episode: ref, ctx } : { ctx }) : undefined);
  /** "Play on…" (Orbit Connect): what Play starts, here or on another device, which finds its own sources. */
  const playOnHero = (className: string) =>
    playOnButton(className, {
      here: () => play(episodic(title) ? nextEpisode(title) : undefined),
      message: () => {
        const ref = episodic(title) ? nextEpisode(title) : undefined;
        return playMessage(title, ref && { season: ref.season, number: ref.episode.number });
      },
      available: () => title.type === 'movie' || (state === 'ready' && !nothingAired(title)),
    });
  const heroTrailer = createHeroTrailer({ setting: HERO_TRAILER_KEY, className: 'detail-trailer' });
  // A dropped page stops its trailer, so nothing it asked for still arrives or downloads.
  root.addEventListener(VIEW_DISCARDED, heroTrailer.stop, { once: true });
  /** TMDB and Letterboxd ratings and logos, once they arrive. */
  let extras: TitleExtras | null = null;
  /** A movie's quality badges, once its sources are in (see `loadQuality`). */
  let movieQuality: QualityBadge[] = preview.type === 'movie' ? (knownQuality(preview) ?? []) : [];

  /** Plays the title's first trailer, or one of its videos, in the player (Rust finds it with yt-dlp). */
  function playTrailer(video?: MediaVideo): void {
    const id = video?.key ?? title.trailers?.[0];
    if (!id) return;
    // Android has no yt-dlp: the YouTube app plays it.
    if (isAndroid) {
      void invoke('trailer_open_youtube', { id }).catch(() => toast(t('errors.trailer.no-app')));
      return;
    }
    const source = { id: 'trailer', url: `orbit-trailer://${id}`, addon: 'YouTube', label: video?.name ?? t('titles.detail.trailer'), meta: '' };
    openPlayer({ title: { ...title, id: `trailer:${title.id}` }, source, sources: [source], trailer: true }, ctx);
  }
  const chooseSource = (ref?: EpisodeRef) => (ref || !nothingAired(title) ? openStreams(title, ref ? { episode: ref, ctx } : { ctx }) : undefined);
  // Your own stars, heart and note: kept across hero redraws, so a rating in progress stays.
  const myRating = createMyRating(preview);
  root.addEventListener(VIEW_DISCARDED, myRating.dispose, { once: true });

  // The ambient glow and page wash follow the backdrop's colour.
  if (preview.background) {
    void artHue(preview.background).then((hue) => {
      const value = hue ?? DEFAULT_AMBIENT_HUE;
      root.dataset.hue = String(value);
      withHue(root, value);
      if (root.isConnected) setAmbientHue(value);
    });
  }

  /**
   * The hero's backdrop, kept across hero redraws (full details, ratings, quality badges): a new
   * picture each time faded in from nothing again, so the art flashed two or three times as the page filled in.
   */
  let heroArt: { key: string; img: HTMLImageElement | '' } | null = null;
  function keptBackdrop(): HTMLImageElement | '' {
    // What backdropImage draws from: the background, or the poster blurred when there's none.
    const key = title.background ?? `poster:${title.poster ?? ''}`;
    if (heroArt?.key !== key) heroArt = { key, img: backdropImage(title, 'detail-art', true) };
    // One that failed to load took itself out of the page (artImage): not put back.
    const { img } = heroArt;
    return img && img.complete && !img.naturalWidth ? '' : img;
  }

  function renderHero(): void {
    const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusId : undefined;
    if (showcase) return renderShowcaseHero(focusId);
    const progress = movieProgress(title);
    const isSeries = episodic(title);

    // Anything but a movie may have episodes, so it can't start until its episode list has loaded.
    const playButton = h('button', { class: 'button large primary', 'data-autofocus': true, 'data-focus-id': 'play', disabled: (title.type !== 'movie' && state !== 'ready') || nothingAired(title) }, icon('play', { filled: true }), primaryLabel(title));
    playButton.addEventListener('click', () => play(isSeries ? nextEpisode(title) : undefined));

    const saved = inLibrary(title.id);
    const library = h('button', { class: 'button large glass', 'data-focus-id': 'library' }, icon(saved ? 'check' : 'plus'), saved ? t('titles.detail.in-library') : t('titles.common.my-library'));
    library.addEventListener('click', () => {
      // The hero redraws now and again once saved, in case saving failed.
      void toggleLibrary(title).then(renderHero);
      renderHero();
    });

    // Trailers come with the full details, so the button waits for them.
    const trailer = title.trailers?.length ? h('button', { class: 'button large glass', 'data-focus-id': 'trailer' }, icon('play'), t('titles.detail.trailer')) : '';
    if (trailer) trailer.addEventListener('click', () => playTrailer());

    const more = h('button', { class: 'button large glass icon-only', title: t('titles.detail.more-actions'), 'aria-label': t('titles.detail.more-actions'), 'data-focus-id': 'more' }, icon('more'));
    more.addEventListener('click', () => openMenuFrom(more, [...titleMenu(title, { play: () => play(isSeries ? nextEpisode(title) : undefined), chooseSource: () => chooseSource(isSeries ? nextEpisode(title) : undefined), shuffle: () => void shuffleTitle(title, ctx), changed: renderAll }), ...downloadMenuItems(title, isSeries ? nextEpisode(title) : undefined, ctx), ...externalLinkItems(title, extras?.tmdbId)]));

    // The genres follow as chips, so the line above leaves them out.
    // IMDb, TMDB and Letterboxd ratings lead the line, then year, runtime.
    const ratings: HTMLElement[] = [];
    if (title.rating) ratings.push(ratingBadge('imdb', title.rating));
    if (extras?.tmdb) ratings.push(ratingBadge('tmdb', extras.tmdb.toFixed(1), t('titles.detail.tmdb-average')));
    if (extras?.letterboxd) ratings.push(ratingBadge('letterboxd', extras.letterboxd.toFixed(1), t('titles.detail.letterboxd-average')));
    const rest = titleMeta({ ...title, rating: undefined, runtime: runtimeLabel(title.runtime) }, { genres: title.genres.length === 0 });
    const dot = () => h('span', { class: 'meta-dot', 'aria-hidden': 'true' }, '·');
    // The best its sources offer: a movie's once looked up, an episode's only if Play or the picker found them.
    const upNextRef = isSeries && state === 'ready' ? nextEpisode(title) : undefined;
    const quality = !appearance().qualityBadges ? [] : isSeries ? (upNextRef ? (knownQuality(title, upNextRef) ?? []) : []) : movieQuality;
    const qualityGroup = quality.length ? h('span', { class: 'quality-badges', title: t('titles.detail.quality-hint') }, ...quality.map((badge) => h('span', { class: 'quality-badge' }, badge))) : null;
    // The age rating follows the year and runtime (it brings its own dot, once known).
    // "Ends at 11:32 PM" after the runtime: what's left of the movie, or of the episode up next.
    const watchMinutes = state === 'ready' ? minutesToWatch(title) : 0;
    const lead = [...ratings, ...(rest.length ? [h('span', { class: 'meta-rest' }, ...rest)] : []), ...(watchMinutes > 0 ? [endsAtLine(watchMinutes, 'meta-ends')] : [])];
    const parts = [...lead.flatMap((p, i) => (i ? [dot(), p] : [p])), ageRatingSlot(title, { dot: lead.length > 0 }), whereToWatchSlot(title), ...(qualityGroup ? [qualityGroup] : [])];
    const meta = h('div', { class: 'hero-meta' }, ...parts);
    const logos = extras?.logos.length
      ? h('span', { class: 'title-logos' }, ...extras.logos.map(networkLogo))
      : '';
    if (isWatched(title)) meta.append(h('span', { class: 'watched-pill' }, icon('check'), t('titles.common.watched')));

    // TMDB's names once known, so they match Details (translated where the interface isn't English).
    const genres = (extras?.facts?.genres.length ? extras.facts.genres : title.genres).map((genre) => {
      const chip = h('button', { class: 'genre-chip', dir: 'auto' }, genre);
      chip.addEventListener('click', () => openGenre(ctx, isSeries ? 'series' : 'movie', genre));
      return chip;
    });

    const credit = isSeries ? title.writer : title.director;
    // TMDB's translation where the interface isn't English (see catalog/extras.ts).
    const description = extras?.overview ?? title.description;
    heroSection.replaceChildren(
      keptBackdrop(),
      ...heroTrailer.media,
      h('div', { class: 'detail-shade', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'detail-content' },
        h(
          'div',
          { class: 'detail-main' },
          logos,
          titleHeading(extras?.name ? { ...title, name: extras.name } : title),
          meta,
          genres.length ? h('div', { class: 'genre-chips' }, ...genres) : '',
          description ? h('p', { class: 'detail-desc' }, description) : '',
          progress > 0 && minutes(title.runtime)
            ? h('div', { class: 'detail-progress' }, progressTrack(progress), h('span', {}, t('titles.detail.min-left', { minutes: Math.round((1 - progress) * minutes(title.runtime)) })))
            : '',
          h('div', { class: 'hero-actions' }, playButton, playOnHero('button large glass icon-only'), library, isSeries ? '' : heroDownloadButton(title, ctx), trailer, more),
          myRating.element,
        ),
        credit?.length || title.cast?.length
          ? h(
              'dl',
              { class: 'detail-credits' },
              credit?.length ? h('div', {}, h('dt', {}, isSeries ? t('titles.detail.created-by') : t('titles.detail.director')), h('dd', {}, formatList(credit))) : '',
              title.cast?.length ? h('div', {}, h('dt', {}, t('titles.detail.starring')), h('dd', {}, formatList(title.cast.slice(0, 4)))) : '',
            )
          : '',
      ),
      heroTrailer.button,
    );
    settleHero(focusId);
  }

  function settleHero(focusId: string | undefined): void {
    if (focusId) heroSection.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
    // Redrawing takes the video out of the page for a moment, which pauses it.
    heroTrailer.resume();
    if (state === 'ready' && title.trailers?.[0]) heroTrailer.start(title.trailers[0]);
  }

  /** The Showcase hero (showcase-hero.ts), with the Classic hero's data and actions. */
  function renderShowcaseHero(focusId: string | undefined): void {
    const isSeries = episodic(title);
    const upNextRef = isSeries && state === 'ready' ? nextEpisode(title) : undefined;
    const quality = !appearance().qualityBadges ? [] : isSeries ? (upNextRef ? (knownQuality(title, upNextRef) ?? []) : []) : movieQuality;
    // A show's downloads are its episodes': the round button offers the one up next (and keeping the next ones).
    const seriesDownloads = upNextRef ? downloadMenuItems(title, upNextRef, ctx) : [];
    let download: HTMLElement | '' = '';
    if (!isSeries) download = heroDownloadButton(title, ctx, true);
    else if (seriesDownloads.length) {
      const button = h('button', { class: 'button large glass icon-only sc-round', title: t('downloads.action.download'), 'aria-label': t('downloads.action.download'), 'aria-haspopup': 'menu', 'data-focus-id': 'download' }, icon('download'));
      button.addEventListener('click', () => openMenuFrom(button, seriesDownloads));
      download = button;
    }
    heroSection.replaceChildren(
      ...showcaseHero({
        title,
        loading: state !== 'ready',
        extras,
        quality,
        trailerMedia: heroTrailer.media,
        trailerButton: heroTrailer.button,
        myRating: myRating.element,
        download,
        playOn: playOnHero('button large glass icon-only sc-round'),
        art: keptBackdrop(),
        heading: titleHeading(extras?.name ? { ...title, name: extras.name } : title),
        onPlay: () => play(isSeries ? nextEpisode(title) : undefined),
        onTrailer: () => playTrailer(),
        onLibrary: () => {
          void toggleLibrary(title).then(renderHero);
          renderHero();
        },
        onMore: (anchor) =>
          openMenuFrom(anchor, [
            ...titleMenu(title, { play: () => play(isSeries ? nextEpisode(title) : undefined), chooseSource: () => chooseSource(isSeries ? nextEpisode(title) : undefined), shuffle: () => void shuffleTitle(title, ctx), changed: renderAll }),
            ...(isSeries ? [] : downloadMenuItems(title, undefined, ctx)),
            ...externalLinkItems(title, extras?.tmdbId),
          ]),
        onGenre: (genre) => openGenre(ctx, isSeries ? 'series' : 'movie', genre),
      }),
    );
    settleHero(focusId);
  }

  /** "Mark season as unwatched" was pressed once and waits for a second press to confirm (it unmarks many episodes). */
  /** Which season or arc it's for ("s2", "a0"), so another one's button starts unarmed. */
  let unmarkArmed: string | null = null;
  let unmarkTimer: number | undefined;

  /** The episode list shows only the show's favourite episodes (the season or arc picker's "Favourites"). */
  let favouritesOnly = false;

  /** A long show's story arcs over its own episodes, when TMDB has them and the setting is on. */
  let arcs: ArcView[] | null = null;
  let episodeView: 'seasons' | 'arcs' = 'seasons';
  let arc: number | undefined;
  /** TMDB's episode ratings, by season, then episode number. */
  const ratings = new Map<number, Map<number, EpisodeRating>>();
  const ratingsAsked = new Set<number>();

  /** Asks TMDB for the ratings of seasons on screen (once each); the list redraws when they come. */
  function askRatings(numbers: Iterable<number>): void {
    for (const n of numbers) {
      if (ratingsAsked.has(n)) continue;
      ratingsAsked.add(n);
      void seasonRatings(title, n).then((found) => {
        if (!found?.size) return;
        ratings.set(n, found);
        if (state === 'ready') renderEpisodes();
      });
    }
  }

  /** Finds the show's story arcs, once its episodes are in (Settings → Library & Metadata → Group episodes by story arc). */
  function loadArcs(): void {
    if (!appearance().storyArcs || title.type !== 'series' || !title.seasons?.length) return;
    void storyArcs(title).then((found) => {
      const views = found && title.seasons ? arcsFor(found, title.seasons) : null;
      if (!views || state !== 'ready') return;
      arcs = views;
      episodeView = 'arcs';
      renderEpisodes();
    });
  }

  function renderEpisodes(): void {
    const seasons = title.seasons;
    if (state === 'loading' && title.type === 'series') {
      episodes.hidden = false;
      episodes.replaceChildren(h('h2', { class: 'section-title' }, t('titles.detail.episodes')), ...Array.from({ length: 3 }, () => h('div', { class: 'skeleton episode-skeleton', 'aria-hidden': 'true' })));
      return;
    }
    episodes.hidden = !seasons?.length;
    if (!seasons?.length) return;

    const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusId : undefined;
    // "Go to episode…" is drawn anew with the list, which redraws as ratings, air times or downloads arrive: what's typed carries over.
    const oldJump = episodes.querySelector<HTMLInputElement>('input.episode-jump');
    const typing = oldJump && oldJump === document.activeElement ? editingAt(oldJump) : null;
    const byArc = episodeView === 'arcs' && !!arcs;
    season ??= nextEpisode(title)?.season ?? seasons[0]!.number;
    const current = seasons.find((s) => s.number === season) ?? seasons[0]!;
    if (byArc) {
      if (arc === undefined) {
        const next = nextEpisode(title);
        arc = Math.max(0, next ? arcIndexOf(arcs!, next.season, next.episode.number) : 0);
      }
      arc = Math.min(arc, arcs!.length - 1);
    }
    const currentArc = byArc ? arcs![arc!]! : undefined;
    const arcLabel = (i: number) => arcs![i]!.name || t('titles.detail.arc-n', { number: i + 1 });
    // The show's favourite episodes, in episode order, for the picker's "Favourites".
    const favRefs: EpisodeRef[] = seasons.flatMap((s) => s.episodes.filter((e) => isFavouriteEpisode(title.id, s.number, e.number)).map((episode) => ({ season: s.number, episode })));
    if (!favRefs.length) favouritesOnly = false;
    const favs = favouritesOnly;
    // What's listed, each episode with its real season and number (for playback and progress).
    const shown: EpisodeRef[] = favs ? favRefs : currentArc ? currentArc.episodes : current.episodes.map((episode) => ({ season: current.number, episode }));
    const aired = shown.filter((ref) => !ref.episode.airs);
    const watchedCount = aired.filter((ref) => episodeState(title, ref.season, ref.episode).kind === 'watched').length;
    askRatings(new Set(shown.map((ref) => ref.season)));

    const markAll = () => {
      setEpisodesWatched(title, aired, true);
      toast(currentArc ? t('titles.detail.arc-marked', { arc: arcLabel(arc!) }) : current.number === 0 ? t('titles.detail.specials-marked') : t('titles.detail.season-marked', { season: current.number }));
      renderAll();
    };
    // Every aired episode watched: the button unmarks them all instead, once confirmed.
    const allWatched = aired.length > 0 && watchedCount === aired.length;
    const armKey = currentArc ? `a${arc!}` : `s${current.number}`;
    const armed = unmarkArmed === armKey;
    const unmarkAll = () => {
      unmarkArmed = null;
      window.clearTimeout(unmarkTimer);
      setEpisodesWatched(title, aired, false);
      toast(currentArc ? t('pages.season.arc-unmarked', { arc: arcLabel(arc!) }) : current.number === 0 ? t('pages.season.specials-unmarked') : t('pages.season.unmarked', { season: current.number }));
      renderAll();
    };
    const unmarkLabel = currentArc ? t('pages.season.unmark-arc') : t('pages.season.unmark');
    const markSeason = h('button', { class: `see-all${allWatched && armed ? ' confirming' : ''}`, 'data-focus-id': 'mark-season' }, allWatched ? (armed ? t('pages.season.confirm') : unmarkLabel) : currentArc ? t('titles.detail.mark-arc') : t('titles.detail.mark-season'));
    markSeason.addEventListener('click', () => {
      if (!allWatched) return markAll();
      if (armed) return unmarkAll();
      // The first press asks; a second within a few seconds unmarks.
      unmarkArmed = armKey;
      window.clearTimeout(unmarkTimer);
      unmarkTimer = window.setTimeout(() => {
        unmarkArmed = null;
        if (root.isConnected) renderEpisodes();
      }, UNMARK_CONFIRM_MS);
      renderEpisodes();
    });

    const tabs = byArc
      ? arcs!.map((_, i) => {
          const tab = h('button', { class: 'segment', 'aria-pressed': String(!favs && i === arc), 'data-focus-id': `arc-${i}` }, arcLabel(i));
          tab.addEventListener('click', () => {
            favouritesOnly = false;
            arc = i;
            renderEpisodes();
          });
          return tab;
        })
      : seasons.map((s) => {
          const tab = h('button', { class: 'segment', 'aria-pressed': String(!favs && s.number === current.number), 'data-focus-id': `season-${s.number}` }, seasonLabel(s.number));
          tab.addEventListener('click', () => {
            favouritesOnly = false;
            season = s.number;
            renderEpisodes();
          });
          return tab;
        });

    // Seasons or story arcs, when the show has arcs.
    const viewSwitch = arcs
      ? h(
          'div',
          { class: 'segments episode-view', role: 'group', 'aria-label': t('titles.detail.view-by') },
          ...(['seasons', 'arcs'] as const).map((value) => {
            const button = h('button', { class: 'segment', 'aria-pressed': String(episodeView === value), 'data-focus-id': `view-${value}` }, value === 'seasons' ? t('titles.detail.by-season') : t('titles.detail.by-arc'));
            button.addEventListener('click', () => {
              if (episodeView === value) return;
              episodeView = value;
              renderEpisodes();
            });
            return button;
          }),
        )
      : '';

    if (favRefs.length) {
      const tab = h('button', { class: 'segment', 'aria-pressed': String(favs), 'data-focus-id': 'favourites-tab' }, icon('heart', { filled: favs }), t('pages.episodes.favourites'));
      tab.addEventListener('click', () => {
        favouritesOnly = true;
        renderEpisodes();
      });
      tabs.push(tab);
    }
    const tabGroup = h('div', { class: 'segments', role: 'group', 'aria-label': byArc ? t('titles.detail.arc') : t('titles.detail.season') }, ...tabs);
    const jump = seasons.reduce((n, s) => n + s.episodes.length, 0) > JUMP_FROM ? jumpField(seasons, favs ? undefined : current.number) : '';
    if (jump && oldJump) jump.value = oldJump.value;
    if (showcase) {
      // A season (or story arc) dropdown in place of the tabs; marking and downloading in a small menu.
      const favOption = favRefs.length ? [{ label: t('pages.episodes.favourites'), count: favRefs.length, pick: () => ((favouritesOnly = true), renderEpisodes()) }] : [];
      const options = byArc
        ? arcs!.map((a, i) => ({ label: arcLabel(i), count: a.episodes.length, pick: () => ((favouritesOnly = false), (arc = i), renderEpisodes()) }))
        : seasons.map((s) => ({ label: seasonLabel(s.number), count: s.episodes.length, pick: () => ((favouritesOnly = false), (season = s.number), renderEpisodes()) }));
      const picker = seasonPicker([...options, ...favOption], favs ? options.length : byArc ? arc! : seasons.indexOf(current), byArc ? t('showcase.choose-arc') : t('showcase.choose-season'));
      const toDownload = favs || currentArc || isLiveType(title.type) ? 0 : seasonEpisodes(title, current.number).length;
      // A menu can't be pressed twice: unmarking asks in a toast instead.
      const confirmUnmark = () => toast(t('pages.season.confirm-toast', { name: unmarkLabel }), { action: { label: t('pages.season.confirm-action'), run: unmarkAll } });
      const actions: MenuItem[] = [
        ...(aired.length && !favs ? [allWatched ? { label: unmarkLabel, action: confirmUnmark } : { label: currentArc ? t('titles.detail.mark-arc') : t('titles.detail.mark-season'), action: markAll }] : []),
        ...(toDownload ? [{ label: tn('showcase.download-season', toDownload), action: () => void downloadSeason(title, current.number) }] : []),
      ];
      const actionsButton = h('button', { class: 'button glass icon-only sc-season-actions', title: t('showcase.season-actions'), 'aria-label': t('showcase.season-actions'), 'aria-haspopup': 'menu', 'data-focus-id': 'season-actions' }, icon('more'));
      actionsButton.addEventListener('click', () => openMenuFrom(actionsButton, actions));
      episodes.replaceChildren(
        h(
          'div',
          { class: 'episodes-header' },
          h('div', { class: 'rail-titles' }, h('h2', { class: 'section-title' }, t('titles.detail.episodes')), h('span', { class: 'rail-source' }, tn('titles.detail.watched-count', aired.length, { watched: watchedCount }))),
        ),
        h('div', { class: 'sc-episodes-bar' }, viewSwitch, picker, actions.length ? actionsButton : '', jump),
        h('div', { class: 'episode-list sc-episode-grid' }, ...shown.map((ref) => episodeRow(ref, byArc || favs))),
      );
      if (focusId) episodes.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
      if (jump && typing) resumeEditing(jump, typing);
      return;
    }
    episodes.replaceChildren(
      h(
        'div',
        { class: 'episodes-header' },
        h('div', { class: 'rail-titles' }, h('h2', { class: 'section-title' }, t('titles.detail.episodes')), h('span', { class: 'rail-source' }, tn('titles.detail.watched-count', aired.length, { watched: watchedCount }))),
        h('div', { class: 'episodes-actions' }, jump, currentArc || favs ? '' : seasonDownloadButton(title, current.number), aired.length && !favs ? markSeason : ''),
      ),
      viewSwitch,
      tabGroup,
      h('div', { class: 'episode-list' }, ...shown.map((ref) => episodeRow(ref, byArc || favs))),
    );
    // A season tab gives way to arc tabs when the arcs arrive (and back): the chosen one takes focus.
    const tabFocus = () => (focusId && /^(season|arc)-|^favourites-tab$/.test(focusId) ? tabGroup.querySelector<HTMLElement>('[aria-pressed="true"]') : null);
    if (focusId) (episodes.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`) ?? tabFocus())?.focus({ preventScroll: true });
    if (jump && typing) resumeEditing(jump, typing);
  }

  /**
   * "Go to episode…": a field (focus doesn't start typing; Enter or a click
   * does) that takes "742", "S2E5" or "2x5", shows the season or arc it's in,
   * and moves focus to its row.
   */
  function jumpField(seasons: Season[], shownSeason: number | undefined): HTMLInputElement {
    const field = createTextField({
      label: t('pages.episodes.go-to'),
      placeholder: t('pages.episodes.go-to'),
      className: 'episode-jump',
      onSubmit: (value) => {
        const query = parseEpisodeQuery(value);
        const found = query && findEpisode(seasons, query, shownSeason);
        if (!found) return toast(t('pages.episodes.not-found', { query: value.trim() }));
        // Found: the field starts empty again (the redraw below would carry the text over).
        field.value = '';
        favouritesOnly = false;
        const target = jumpTarget(episodeView === 'arcs' ? arcs : null, found);
        if ('arc' in target) arc = target.arc;
        else {
          episodeView = 'seasons';
          season = target.season;
        }
        renderEpisodes();
        const row = episodes.querySelector<HTMLElement>(`[data-focus-id="ep-${found.season}-${found.episode}"]`);
        row?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
        // An episode not out yet has no row to press; it's only scrolled to.
        if (row instanceof HTMLButtonElement) row.focus({ preventScroll: true });
      },
    });
    // Kept focused across a redraw, like the rest of the list.
    field.dataset.focusId = 'episode-jump';
    return field;
  }

  /** "E3", or "S2 · E3" listed by arc; the Showcase layout adds the length: "E3 · 52 min". */
  function episodeNumber(ref: EpisodeRef, withSeason: boolean, hideLength = false): string {
    const number = withSeason ? t('titles.common.episode-code', { season: ref.season, episode: ref.episode.number }) : t('titles.detail.episode-number', { number: ref.episode.number });
    const length = hideLength ? 0 : minutes(title.runtime);
    return showcase && length ? t('showcase.episode-length', { number, minutes: length }) : number;
  }

  /** `withSeason`: the episode is listed by arc, so its number says its season too. */
  function episodeRow(ref: EpisodeRef, withSeason = false): HTMLElement {
    const { episode } = ref;
    const epState = episodeState(title, ref.season, episode);
    const status =
      epState.kind === 'watched' ? t('titles.common.watched')
      : epState.kind === 'in-progress' ? t('titles.detail.in-progress')
      : epState.kind === 'up-next' ? t('titles.detail.up-next')
      : epState.kind === 'unaired' ? t('titles.detail.not-aired')
      : '';
    const current = epState.kind === 'in-progress' || epState.kind === 'up-next';
    const hide = hiddenFor(epState.kind);
    const name = episodeName(episode.number, episode.title, hide.title);
    // The buttons beside the row (watched, favourite, remind) name their action; this tells a screen reader which episode.
    const titleId = `episode-title-${++episodeTitleIds}`;
    const aired = epState.kind !== 'unaired';
    // "Out today at 21:00" for one still to come, when its exact air time is known (catalog/air-times.ts).
    const exact = exactAirTime(title.id, ref.season, episode.number, episode.released);
    const comingAt = exact !== undefined && exact > Date.now() && !hide.airDate ? airTimeLabel(exact) : undefined;

    const still = h(
      'span',
      // A blurred picture clears on hover or focus (see `.spoiler-art` in styles.css).
      { class: `frame episode-still${hide.thumbnail ? ' spoiler-art' : ''}` },
      episode.thumbnail ? artImage(episode.thumbnail, 'art') : '',
      aired ? h('span', { class: 'episode-play', 'aria-hidden': 'true' }, icon('play', { filled: true })) : '',
      epState.kind === 'in-progress' ? progressTrack(epState.progress, 'still-progress') : '',
    );

    const row = h(
      aired ? 'button' : 'div',
      {
        class: `episode-row${current ? ' current' : ''}${aired ? '' : ' unaired'}`,
        'data-focus-id': `ep-${ref.season}-${episode.number}`,
        'aria-label': status ? t('titles.detail.episode-aria-status', { number: episode.number, title: name, status }) : t('titles.detail.episode-aria', { number: episode.number, title: name }),
      },
      still,
      h(
        'span',
        { class: 'episode-text' },
        h(
          'span',
          { class: 'episode-heading' },
          h('span', { class: 'episode-number' }, episodeNumber(ref, withSeason, !aired && hide.airDate)),
          h('span', { class: 'episode-title', id: titleId }, name),
        ),
        episode.overview && !hide.description ? h('span', { class: 'episode-desc' }, episode.overview) : '',
        h('span', { class: 'episode-meta' }, comingAt ?? (epState.kind === 'unaired' ? (hide.airDate ? t('titles.detail.not-aired') : epState.airs) : (formatDate(episode.released) ?? '')), hide.rating ? '' : episodeRating(ratings.get(ref.season)?.get(episode.number))),
      ),
      h('span', { class: 'episode-status' }, status),
    );
    if (aired) {
      row.addEventListener('click', () => play(ref));
      // Right-click, the Menu key or Shift+F10: play it, or queue this episode.
      withContextMenu(row, () => [{ label: t('titles.actions.play'), action: () => play(ref) }, ...queueMenu(title, ref)]);
    }

    // The watched check sits beside the row (not inside it) so it's its own
    // focus stop and its click never starts playback.
    const cells: HTMLElement[] = [row];
    if (aired) {
      const done = epState.kind === 'watched';
      const check = h('button', { class: `episode-check${done ? ' on' : ''}`, title: done ? t('titles.common.mark-unwatched') : t('titles.common.mark-watched'), 'aria-label': done ? t('titles.common.mark-unwatched') : t('titles.common.mark-watched'), 'aria-describedby': titleId, 'data-focus-id': `check-${ref.season}-${episode.number}` }, icon('check'));
      check.addEventListener('click', () => {
        setEpisodeWatched(title, ref.season, episode, !done);
        renderAll();
      });
      const heart = favouriteHeart(title, ref.season, episode, { className: 'episode-fav', focusId: `fav-${ref.season}-${episode.number}` });
      heart.setAttribute('aria-describedby', titleId);
      cells.splice(1, 0, heart);
      cells.push(check, episodeDownloadButton(title, ref, ctx));
    } else if (episodic(title)) {
      // Not out yet: "Remind me" (the show's reminder, library/reminders.ts).
      const remind = reminderButton(title, `remind-${ref.season}-${episode.number}`);
      remind.setAttribute('aria-describedby', titleId);
      cells.push(remind);
    }
    return h('div', { class: 'episode-item' }, ...cells);
  }

  /**
   * `drawLower`, keeping the cast row where it was: it's redrawn as TMDB's cast and facts arrive,
   * possibly while the keyboard is on a cast member (focus would otherwise drop to the page).
   */
  function renderLower(): void {
    const active = document.activeElement instanceof HTMLElement && lower.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    const scrolled = lower.querySelector('.cast-row')?.scrollLeft ?? 0;
    drawLower();
    const row = lower.querySelector('.cast-row');
    if (row) row.scrollLeft = scrolled;
    if (active) lower.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
  }

  function drawLower(): void {
    if (state === 'loading') {
      lower.replaceChildren(h('div', { class: 'skeleton lower-skeleton', 'aria-hidden': 'true' }), h('div', { class: 'skeleton lower-skeleton', 'aria-hidden': 'true' }));
      return;
    }
    const isSeries = episodic(title);
    const tmdb = extras?.facts;
    // Missing fields are left out rather than shown as "N/A".
    // Lists are joined in the interface's language, so they follow its direction;
    // any other value is isolated, so an addon's English ("14 nominations total") keeps its order in Arabic.
    const facts: [string, string | undefined, 'list'?][] = [
      // TMDB's status gets its own line; otherwise a show's addon status follows its years.
      [t('titles.detail.released'), isSeries ? [title.year, tmdb?.status ? undefined : title.status].filter(Boolean).join(' · ') : (formatDate(title.released) ?? title.year)],
      [t('titles.detail.status'), tmdb?.status ? t(STATUS_LABELS[tmdb.status]) : undefined],
      [isSeries ? t('titles.detail.episode-length') : t('titles.detail.runtime'), runtimeLabel(title.runtime)],
      [t('titles.detail.genres'), tmdb?.genres.length ? formatList(tmdb.genres) : undefined, 'list'],
      [isSeries ? t('titles.detail.networks') : t('titles.detail.studios'), tmdb?.companies.length ? formatList(tmdb.companies) : undefined, 'list'],
      [t('titles.detail.original-language'), languageName(tmdb?.language)],
      [t('titles.detail.country'), title.country],
      [t('titles.detail.budget'), dollars(tmdb?.budget)],
      [t('titles.detail.revenue'), dollars(tmdb?.revenue)],
      [t('titles.detail.tmdb-rating'), tmdb?.rating ? tn('titles.detail.tmdb-votes', tmdb.votes, { rating: tmdb.rating.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : undefined],
      [t('titles.detail.awards'), title.awards],
    ];
    const shown = facts.filter((f): f is [string, string, 'list'?] => !!f[1]);
    const factList = () => h('dl', {}, ...shown.map(([k, v, list]) => h('div', {}, h('dt', {}, k), h('dd', {}, list ? v : h('bdi', {}, v)))));
    const cast = title.cast ?? [];
    const members = tmdbCast.length ? tmdbCast.map((member) => castCard(member, () => ctx.open(createPersonPage(member.id, member.name, ctx)))) : cast.map((name) => castMember(name));
    if (showcase) {
      // Cast & Crew here, the facts at the end of the page as Details.
      const crew = (isSeries ? title.writer : title.director)?.map((name) => crewMember(name, isSeries ? t('titles.detail.created-by') : t('titles.detail.director'))) ?? [];
      const people = [...members, ...crew];
      lower.hidden = !people.length;
      lower.replaceChildren(people.length ? castSection(people, t('showcase.cast-crew')) : '');
      factsSection.hidden = !shown.length;
      factsSection.replaceChildren(
        shown.length
          ? h(
              'div',
              { class: 'detail-facts' },
              h('h2', { class: 'section-title' }, t('titles.detail.details')),
              factList(),
              title.origins[0] ? h('p', { class: 'facts-source' }, t('titles.detail.metadata-from', { name: title.origins[0].name })) : '',
            )
          : '',
      );
      return;
    }
    lower.hidden = !members.length && !shown.length;
    lower.replaceChildren(
      members.length
        ? castSection(members)
        : h('div', {}),
      shown.length
        ? h(
            'div',
            { class: 'detail-facts' },
            h('h2', { class: 'section-title' }, t('titles.detail.details')),
            factList(),
            title.origins[0] ? h('p', { class: 'facts-source' }, t('titles.detail.metadata-from', { name: title.origins[0].name })) : '',
          )
        : '',
    );
  }

  function renderAll(): void {
    renderHero();
    renderEpisodes();
    renderLower();
  }

  /**
   * What's saved of this title can still play when its details can't load (offline, say): a film's
   * copy plays from here, a show's episodes are in Downloads. Null when nothing of it is saved.
   */
  function savedAction(): HTMLElement | null {
    const saved = allDownloads().filter((d) => d.titleId === preview.id && d.state === 'done');
    if (!saved.length) return null;
    const film = saved.length === 1 && saved[0]!.season === null ? saved[0]! : null;
    const button = h('button', { class: 'button primary', 'data-focus-id': 'details-saved' }, ...(film ? [icon('play'), t('downloads.action.play')] : [t('downloads.action.open-page')]));
    button.addEventListener('click', () => (film ? playDownload(film, ctx) : ctx.go('downloads')));
    return button;
  }

  /**
   * The details couldn't load (offline, an addon that failed or took too long): the page keeps the
   * catalog's preview, with a note under the banner and Try again. A show can't start without its episodes.
   */
  function renderFailure(err: unknown): void {
    const saved = savedAction();
    const retry = h('button', { class: saved ? 'button' : 'button primary', 'data-focus-id': 'details-retry' }, t('browse.search.retry'));
    retry.addEventListener('click', load);
    const offline = isOffline();
    notice.replaceChildren(
      h('span', { class: 'state-icon' }, icon(offline ? 'offline' : 'info')),
      h('div', { class: 'detail-failure-text' }, h('strong', {}, offline ? t('states.offline.title') : t('titles.detail.partial')), h('span', { class: 'muted' }, errorText(err))),
      h('div', { class: 'detail-failure-actions' }, saved ?? '', retry),
    );
    notice.hidden = false;
    retryWhenOnline(notice, load);
    // A saved copy plays from here; otherwise focus stays where it is, unless nothing has it (a show's Play is off).
    const active = document.activeElement;
    if (saved) saved.focus({ preventScroll: true });
    else if (!active || active === document.body) retry.focus({ preventScroll: true });
  }

  function load(): void {
    state = 'loading';
    notice.hidden = true;
    if (!heroSection.isConnected) root.replaceChildren(...sections());
    renderAll();
    loadMeta(preview.type, preview.id)
      .then((full) => {
        // An addon that doesn't know the title leaves the catalog preview as is.
        if (full) title = { ...full, origins: full.origins.length ? full.origins : preview.origins, poster: full.poster ?? preview.poster };
        state = 'ready';
        renderAll();
        // A show's Play was disabled when the page opened, so it couldn't take focus then: it takes it now,
        // unless the person has moved on (otherwise Enter or a controller's A does nothing until an arrow is pressed).
        if (root.isConnected && (!document.activeElement || document.activeElement === document.body)) heroSection.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
        loadArcs();
        // Exact air times for episodes still to come (when looked up): redrawn once known.
        void loadAirTimes(title).then((found) => {
          if (found && root.isConnected) renderEpisodes();
        });
      })
      .catch((err: unknown) => {
        state = 'failed';
        renderAll();
        renderFailure(err);
      });
  }

  root.append(...sections());
  load();
  const redrawFranchise = fillFranchise(franchise, preview, ctx);
  // Ratings from TMDB and Letterboxd, and network or studio logos.
  // The same TMDB request brings the Details facts and the Media row.
  let discarded = false;
  root.addEventListener(VIEW_DISCARDED, () => (discarded = true), { once: true });
  void titleExtras(preview).then((found) => {
    extras = found;
    if (discarded) return;
    if (found && (found.tmdb || found.letterboxd || found.logos.length || found.name || found.overview)) renderHero();
    if (found?.facts && state === 'ready') renderLower();
    if (showcase) {
      fillExtras(extrasSection, found?.media ?? null, playTrailer);
      fillPhotos(photos, found?.media ?? null);
    } else fillMedia(media, found?.media ?? null, playTrailer);
    // A film's Letterboxd reviews, after its rating: both read the same film page, which Rust keeps.
    letterboxdReviews(preview)
      .then((page) => {
        if (!discarded) fillReviews(reviews, page);
      })
      .catch((err: unknown) => console.warn('No Letterboxd reviews', err));
  });
  // A movie's quality badges ask its addons for sources, shared with Play and
  // the picker. After a moment, so paging quickly through titles doesn't ask for each.
  const qualityStop = new AbortController();
  root.addEventListener(VIEW_DISCARDED, () => qualityStop.abort(), { once: true });
  if (preview.type === 'movie' && appearance().qualityBadges) {
    window.setTimeout(() => {
      if (qualityStop.signal.aborted || !root.isConnected) return;
      const show = (found: QualityBadge[]) => {
        if (qualityStop.signal.aborted || found.join() === movieQuality.join()) return;
        movieQuality = found;
        renderHero();
      };
      loadQuality(preview, qualityStop.signal, show)
        .then(show)
        .catch((err: unknown) => console.warn('No quality badges', err));
    }, QUALITY_DELAY_MS);
  }
  // With a TMDB token the cast gets photos, characters and pages.
  let tmdbCast: CastMember[] = [];
  castFor(preview)
    .then((cast) => {
      if (!cast?.length) return;
      tmdbCast = cast;
      if (state === 'ready') renderLower();
    })
    .catch((err: unknown) => console.warn('No cast photos', err));
  // "More like this" needs a TMDB token; without one the section stays empty.
  recommendationsFor(preview)
    .then((titles) => {
      if (!titles?.length) return;
      if (showcase) more.replaceChildren(likeThisRail(titles, (rec) => ctx.open(createDetail(rec, ctx))));
      else more.replaceChildren(rail({ title: t('titles.detail.more-like-this'), cards: titles.map((rec) => titleCard(rec, () => ctx.open(createDetail(rec, ctx)))) }));
    })
    .catch((err: unknown) => console.warn('No recommendations', err));
  // Showcase only: topics and where to watch, and a film's release dates (TMDB; nothing without a token).
  if (showcase) {
    titleTopics(preview)
      .then((found) => {
        if (discarded) return;
        fillTopics(topics, found, preview.type === 'series' ? 'series' : 'movie', ctx);
        fillWatch(watch, found);
      })
      .catch((err: unknown) => console.warn('No topics or providers', err));
    titleReleases(preview)
      .then((found) => {
        if (!discarded) fillReleases(releases, found);
      })
      .catch((err: unknown) => console.warn('No release dates', err));
  }
  // Back from the player: redraw progress, watched marks and Resume if they changed.
  // Downloads starting, finishing or going away change the Download buttons
  // (redrawn when the page is next shown, if it's away).
  let downloadsStale = false;
  const redrawDownloads = () => {
    downloadsStale = false;
    renderHero();
    renderEpisodes();
  };
  // Hearting or unhearting an episode changes the picker's "Favourites" (and its list).
  const stopFavourites = onFavouriteEpisodesChange(() => {
    if (state === 'ready' && episodic(title)) renderEpisodes();
  });
  root.addEventListener(VIEW_DISCARDED, stopFavourites, { once: true });
  const stopDownloads = onDownloadsChange(() => (root.isConnected ? redrawDownloads() : (downloadsStale = true)));
  // A title page is made for each visit: once it's dropped, it stops listening (and can be freed).
  root.addEventListener(VIEW_DISCARDED, stopDownloads, { once: true });
  let seen = watchVersion();
  root.addEventListener(VIEW_SHOWN, () => {
    if (downloadsStale) redrawDownloads();
    heroTrailer.resume();
    if (state === 'ready' && title.trailers?.[0]) heroTrailer.start(title.trailers[0]);
    if (watchVersion() === seen) return;
    seen = watchVersion();
    renderAll();
    redrawFranchise();
  });
  return root;
}

/** An episode's TMDB rating, coloured by how good it is. */
function episodeRating(found: EpisodeRating | undefined): HTMLElement | '' {
  if (!found) return '';
  const value = found.rating.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const badge = ratingBadge('tmdb', value, tn('titles.detail.episode-rating', found.votes, { rating: value }));
  badge.classList.add('episode-rating', `heat-${ratingHeat(found.rating)}`);
  return badge;
}

const seasonLabel = (n: number) => (n === 0 ? t('titles.detail.specials') : t('titles.detail.season-n', { season: n }));

/** The title logo when the addon has one (falls back to the name if it fails). */
function titleHeading(title: Title): HTMLElement {
  const heading = h('h1', { class: 'detail-title' });
  if (!title.logo || !appearance().logos) {
    heading.textContent = title.name;
    return heading;
  }
  const logo = h('img', { class: 'detail-logo', src: title.logo, alt: title.name, decoding: 'async' });
  logo.addEventListener('error', () => {
    heading.classList.remove('has-logo');
    heading.replaceChildren(title.name);
  });
  heading.classList.add('has-logo');
  heading.append(logo);
  return heading;
}

function progressTrack(progress: number, className = 'progress-track'): HTMLElement {
  const track = h('span', { class: className }, h('span', { class: 'progress-fill' }));
  track.style.setProperty('--progress', String(progress));
  return track;
}

/**
 * A genre chip: Movies or TV Shows on that genre, in a catalog that offers it, from the page's
 * start. A genre no catalog lists (TMDB's translated names) opens the page unfiltered.
 */
function openGenre(ctx: RoomContext, kind: 'movie' | 'series', genre: string): void {
  void usableAddons()
    .then((addons) => browsableCatalogs(addons).find((r) => r.catalog.type === kind && r.catalog.extra.some((e) => e.name === 'genre' && e.options?.includes(genre))))
    .catch(() => undefined)
    .then((ref) => {
      if (ref) openDiscoverAt(kind, { addonKey: ref.addon.key, catalogId: ref.catalog.id, genre });
      ctx.go(kind === 'series' ? 'series' : 'movies', { root: true });
    });
}

/** A cast member without a photo gets their initials on a tinted circle. */
/** A cast member from TMDB: photo (or initials), name and character; opens their page. */
function castCard(member: CastMember, onOpen: () => void): HTMLElement {
  // The initials stay under the photo, so one that fails to load (and is removed) leaves them rather than an empty circle.
  const photo = castMember(member.name).firstElementChild as HTMLElement;
  if (member.photo) {
    photo.classList.add('has-photo');
    photo.append(artImage(member.photo, 'art'));
  }
  const card = h(
    'button',
    // A label, not a title: the names wrap rather than cut off, so a tooltip only repeated them over the next card.
    { class: 'cast-member', 'data-focus-id': `cast-${member.id}`, 'aria-label': member.character ? t('titles.detail.cast-as', { name: member.name, character: member.character }) : member.name },
    photo,
    h('span', { class: 'cast-name' }, member.name),
    member.character ? h('span', { class: 'cast-character' }, member.character) : '',
  );
  card.addEventListener('click', onOpen);
  return card;
}

/** Someone from the crew (the addon's names only): initials, name and their role. */
function crewMember(name: string, role: string): HTMLElement {
  const member = castMember(name);
  member.append(h('span', { class: 'cast-character' }, role));
  return member;
}

function castMember(name: string): HTMLElement {
  // First and last name, so "Derek de Lint" is "DL", not "Dd".
  const words = name.split(/\s+/);
  const initials = [words[0], words.length > 1 ? words.at(-1) : undefined].map((word) => word?.[0]?.toLocaleUpperCase(locale()) ?? '').join('');
  return h('div', { class: 'cast-member' }, withHue(h('span', { class: 'cast-photo', 'aria-hidden': 'true' }, initials), fallbackHue(name)), h('span', { class: 'cast-name' }, name));
}
