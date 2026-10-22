/** Home's TMDB sections ("Because you watched…", streaming services) and Letterboxd's rows. */
import { t } from '../../i18n';
import { serviceLogo } from '../../components/service-logo';
import type { RoomContext } from '../../app/router';
import { letterboxdDiary, letterboxdProfile, letterboxdWatchlist, stars, type LetterboxdFilm } from '../../catalog/letterboxd';
import { pickedServices, streamingRegion } from '../../catalog/streaming';
import { recommendationsFor, streamingCatalog, streamingServices, tmdbConnected, type StreamingService } from '../../catalog/tmdb';
import type { Title } from '../../catalog/titles';
import { asyncRail, rail } from '../../components/cards';
import { h } from '../../lib/dom';
import { inLibrary } from '../../library/library';
import { lastWatchedAt } from '../../library/watch';
import { createServicePage } from '../streaming/service';
import { titleCard } from '../title-card';
import type { RowFeed } from './feeds';

/** How a section opens a title and attaches the shared title menu. */
export interface TitleActions {
  openDetail(title: Title): void;
  withMenu(card: HTMLElement, title: Title): HTMLElement;
  /** For a failed row's "Fix in Settings" (see `asyncRail`). */
  go?: ((room: string) => void) | undefined;
}

let streamingGeneration = 0;

/** The streaming services picked in Settings, in their order, and the region. */
async function shownServices(): Promise<{ shown: StreamingService[]; region: string }> {
  const [services, picked, region] = await Promise.all([streamingServices().catch(() => null), pickedServices(), streamingRegion()]);
  return { shown: (services ?? []).filter((service) => picked.includes(service.key)), region };
}

const popularOn = (service: StreamingService, region: string): RowFeed => ({
  title: t('browse.home.popular-on', { name: service.name }),
  load: async () => (await streamingCatalog(service.key, region)) ?? [],
});

/** The "Popular on …" rows' titles (the phone remote's picker). */
export async function streamingFeeds(): Promise<RowFeed[]> {
  const { shown, region } = await shownServices();
  return shown.map((service) => popularOn(service, region));
}

/**
 * "Your services" (a logo tile per picked streaming service, opening its
 * page), then a "Popular on …" rail for each, in the services' order.
 */
export async function renderStreaming(slot: HTMLElement, parts: TitleActions, ctx: RoomContext): Promise<void> {
  const current = ++streamingGeneration;
  const { shown, region } = await shownServices();
  if (current !== streamingGeneration) return;
  const open = (service: StreamingService) => ctx.open(createServicePage(service, region, ctx));
  const tiles = shown.map((service) => {
    const tile = h('button', { class: 'service-card' }, serviceLogo(service), h('span', {}, service.name));
    tile.addEventListener('click', () => open(service));
    return tile;
  });
  slot.replaceChildren(
    shown.length ? rail({ title: t('browse.home.your-services'), cards: tiles }) : '',
    ...shown.map((service) => {
      const feed = popularOn(service, region);
      return asyncRail({
        title: feed.title,
        onSeeAll: () => open(service),
        go: ctx.go,
        load: async () => (await feed.load()).map((title) => titleCard(title, () => parts.openDetail(title), {}, (card) => parts.withMenu(card, title))),
      });
    }),
  );
}

/** Letterboxd's two rows' titles, when a profile is connected (the phone remote's picker). */
export async function letterboxdFeeds(): Promise<RowFeed[]> {
  const profile = await letterboxdProfile();
  if (!profile) return [];
  return [
    { title: t('browse.home.letterboxd-watchlist'), load: async () => ((await letterboxdWatchlist(profile.user)) ?? []).map((film) => film.title) },
    { title: t('browse.home.letterboxd-recent'), load: async () => (await letterboxdDiary(profile.user)).map((film) => film.title) },
  ];
}

let letterboxdGeneration = 0;

/** "On your Letterboxd watchlist" and "Recently on your Letterboxd", when a profile is connected. */
export async function renderLetterboxd(slot: HTMLElement, { openDetail, withMenu }: TitleActions): Promise<void> {
  const current = ++letterboxdGeneration;
  const profile = await letterboxdProfile();
  if (current !== letterboxdGeneration) return;
  if (!profile) return void slot.replaceChildren();
  const source = `Letterboxd · @${profile.user}`;
  const card = ({ title, rating, liked }: LetterboxdFilm) => {
    const mark = rating ? stars(rating) : liked ? '♥' : undefined;
    return titleCard(title, () => openDetail(title), mark ? { rating: mark } : {}, (card) => withMenu(card, title));
  };
  slot.replaceChildren(
    asyncRail({ title: t('browse.home.letterboxd-watchlist'), source, load: async () => ((await letterboxdWatchlist(profile.user)) ?? []).map(card) }),
    asyncRail({ title: t('browse.home.letterboxd-recent'), source, load: async () => (await letterboxdDiary(profile.user)).map(card) }),
  );
}

/**
 * "Because you watched X": TMDB's recommendations for the profile's most
 * recently watched titles, minus anything it has started, finished or saved.
 * Only with a TMDB token. Only the latest call draws (watch changes call it often).
 */
let forYouGeneration = 0;

export async function renderForYou(slot: HTMLElement, seeds: Title[], { openDetail, withMenu, go }: TitleActions): Promise<void> {
  const current = ++forYouGeneration;
  const feeds = await forYouFeeds(seeds);
  if (current !== forYouGeneration) return;
  if (!feeds.length) return void slot.replaceChildren();
  slot.replaceChildren(...feeds.map((feed) => asyncRail({ title: feed.title, go, load: async () => (await feed.load()).map((t) => titleCard(t, () => openDetail(t), {}, (card) => withMenu(card, t))) })));
}

/** The "Because you watched X" rows' titles; none without a TMDB token. */
export async function forYouFeeds(seeds: readonly Title[]): Promise<RowFeed[]> {
  if (!seeds.length || !(await tmdbConnected())) return [];
  return seeds.map((seed) => ({
    title: t('browse.home.because-you-watched', { name: seed.name }),
    load: async () => ((await recommendationsFor(seed)) ?? []).filter((t) => !lastWatchedAt(t.id) && !inLibrary(t.id)),
  }));
}
