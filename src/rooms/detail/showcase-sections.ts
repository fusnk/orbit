/**
 * The Showcase title page's sections below the hero (Settings → Appearance →
 * Title page): trailers and extras, photos, more like this with title logos,
 * topics, where to watch and release dates. Each section hides itself when
 * there's nothing to show. All text goes in as text nodes; images come only
 * from TMDB's and YouTube's image hosts (checked in catalog/).
 */
import type { RoomContext } from '../../app/router';
import type { MediaVideo, TitleMedia } from '../../catalog/extras';
import { onlyInCinemas, type Release, type TitleTopics, type WatchProvider } from '../../catalog/title-topics';
import { tmdbSourcePage } from '../../catalog/tmdb';
import type { Title } from '../../catalog/titles';
import { landscapeCard, rail } from '../../components/cards';
import { icon } from '../../components/icons';
import { openMenuFrom } from '../../components/menu';
import { scrollFade, scrollRow } from '../../components/scroll-fade';
import { locale, t, tn, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { createGridPage, type GridSource } from '../explore/grid';
import type { DiscoverSpec, Kind } from '../explore/filters';
import { imageCards, videoCard } from './title-media';

/** A section heading, with scroll arrows when `row` scrolls sideways. */
function header(heading: string, row?: HTMLElement, extra?: HTMLElement): HTMLElement {
  const arrow = (dir: 1 | -1) => {
    const button = h('button', { class: 'rail-scroll', title: dir > 0 ? t('titles.detail.scroll-right') : t('titles.detail.scroll-left'), tabindex: '-1' }, icon(dir > 0 ? 'chevronRight' : 'chevronLeft'));
    button.addEventListener('click', () => row && scrollRow(row, dir));
    return button;
  };
  return h('div', { class: 'cast-header' }, h('h2', { class: 'section-title' }, heading), h('span', { class: 'sc-header-end' }, extra ?? '', row ? h('span', { class: 'rail-arrows', 'data-nav-skip': true }, arrow(-1), arrow(1)) : ''));
}

/** Trailers & Extras: TMDB's videos, each labelled with its kind, played as today. */
export function fillExtras(section: HTMLElement, media: TitleMedia | null, play: (video: MediaVideo) => void): void {
  const videos = media?.videos ?? [];
  section.hidden = !videos.length;
  if (!videos.length) return;
  const row = scrollFade(h('div', { class: 'media-row media-videos' }, ...videos.map((video) => videoCard(video, play))));
  section.replaceChildren(header(t('showcase.extras'), row), row);
}

type PhotoKind = 'backdrops' | 'posters';
const PHOTO_LABELS: Record<PhotoKind, MessageKey> = { backdrops: 'showcase.stills', posters: 'titles.detail.media-posters' };

/** Photos: stills or posters (a toggle when there are both), each opening full size. */
export function fillPhotos(section: HTMLElement, media: TitleMedia | null): void {
  const kinds = (Object.keys(PHOTO_LABELS) as PhotoKind[]).filter((kind) => media?.[kind].length);
  section.hidden = !media || !kinds.length;
  if (!media || !kinds.length) return;
  let current = kinds[0]!;
  const row = scrollFade(h('div', { class: 'media-row' }));
  const buttons = kinds.map((kind) => {
    const button = h('button', { class: 'segment', 'data-focus-id': `photos-${kind}` }, t(PHOTO_LABELS[kind]), h('span', { class: 'media-count' }, media[kind].length.toLocaleString(locale())));
    button.addEventListener('click', () => {
      current = kind;
      draw();
    });
    return button;
  });
  function draw(): void {
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(kinds[i] === current)));
    row.className = `media-row scroll-fade media-${current}`;
    row.scrollLeft = 0;
    row.replaceChildren(...imageCards(media![current], t(PHOTO_LABELS[current])));
  }
  const toggle = kinds.length > 1 ? h('div', { class: 'segments', role: 'group', 'aria-label': t('showcase.photos') }, ...buttons) : undefined;
  section.replaceChildren(header(t('showcase.photos'), row, toggle), row);
  draw();
}

/**
 * More Like This: landscape cards with the title's logo over its backdrop
 * (whatever the card shape). Logos are looked up only for cards scrolled
 * into view (each may need the title's full details); the name shows until
 * one loads, and if none does.
 */
export function likeThisRail(titles: Title[], open: (title: Title) => void): HTMLElement {
  const cards = titles.map((title) => landscapeCard(title, () => open(title), { lookUpLogo: true }));
  return rail({ title: t('titles.detail.more-like-this'), cards, variant: 'continue' });
}

/** "Dystopia": TMDB's keywords are lower case. */
const capitalised = (name: string) => name.charAt(0).toLocaleUpperCase(locale()) + name.slice(1);

/** A Discover grid of movies and shows with a keyword, filterable like the genre grids. */
function topicGrid(id: number, name: string): GridSource {
  const spec: DiscoverSpec = { filters: () => ({ withKeywords: String(id) }), sort: () => 'popularity.desc' };
  return {
    title: name,
    intro: t('showcase.topic-intro', { topic: name }),
    kinds: ['movie', 'series'],
    load: (kind, page) => tmdbSourcePage({ kind: 'discover', media: kind === 'movie' ? 'movie' : 'tv', sort: spec.sort(kind), filters: spec.filters(kind) }, page),
    discover: spec,
  };
}

/** Topics: TMDB's keywords as chips; each opens a grid of titles with it. */
export function fillTopics(section: HTMLElement, topics: TitleTopics | null, kind: Kind, ctx: RoomContext): void {
  const keywords = topics?.keywords ?? [];
  section.hidden = !keywords.length;
  if (!keywords.length) return;
  const chips = keywords.map((keyword) => {
    const name = capitalised(keyword.name);
    const chip = h('button', { class: 'chip', 'data-focus-id': `topic-${keyword.id}` }, name);
    chip.addEventListener('click', () => ctx.open(createGridPage(topicGrid(keyword.id, name), ctx, kind)));
    return chip;
  });
  section.replaceChildren(header(t('showcase.topics')), h('div', { class: 'chips sc-topics' }, ...chips));
}

const PROVIDER_GROUPS = [
  ['stream', 'showcase.stream'],
  ['rent', 'showcase.rent'],
  ['buy', 'showcase.buy'],
] as const satisfies readonly (readonly [keyof TitleTopics['providers'], MessageKey])[];

function providerLogo(provider: WatchProvider): HTMLElement {
  const logo = h('img', { class: 'sc-provider-logo', src: provider.logo, alt: provider.name, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  // A logo that doesn't load (offline, TMDB's image host down) gives way to the service's initial, not a broken-image icon.
  logo.addEventListener('error', () => logo.replaceWith(h('span', { class: 'sc-provider-logo service-initial', role: 'img', 'aria-label': provider.name }, provider.name.slice(0, 1))), { once: true });
  return h('li', { class: 'sc-provider', title: provider.name }, logo);
}

/** Where to Watch in the streaming region: Stream, Rent and Buy, with TMDB's required JustWatch credit. */
export function fillWatch(section: HTMLElement, topics: TitleTopics | null): void {
  const groups = PROVIDER_GROUPS.filter(([key]) => topics?.providers[key].length);
  section.hidden = !groups.length;
  if (!topics || !groups.length) return;
  section.replaceChildren(
    header(t('showcase.where-to-watch')),
    h(
      'div',
      { class: 'sc-watch' },
      ...groups.map(([key, label]) => h('div', { class: 'sc-watch-group' }, h('h3', { class: 'sc-watch-label' }, t(label)), h('ul', { class: 'sc-providers' }, ...topics.providers[key].map(providerLogo)))),
    ),
    h('p', { class: 'facts-source' }, t('showcase.justwatch')),
  );
}

const RELEASE_LABELS: Record<Release['kind'], MessageKey> = { cinema: 'calendar.kind.cinema', digital: 'calendar.kind.digital', physical: 'calendar.kind.physical' };
const releaseDate = new Intl.DateTimeFormat(locale(), { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Today here, as "YYYY-MM-DD" (not in UTC, which is a day off in the evening or morning, depending on the zone). */
function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Release dates (movies): cinema, digital and physical, and a word when it's only in cinemas so far. */
export function fillReleases(section: HTMLElement, releases: Release[] | null): void {
  section.hidden = !releases?.length;
  if (!releases?.length) return;
  const now = today();
  const cards = releases.map((release) =>
    h(
      'div',
      { class: `sc-release${release.date > now ? ' upcoming' : ''}` },
      h('dt', {}, t(RELEASE_LABELS[release.kind])),
      h('dd', {}, releaseDate.format(new Date(`${release.date}T00:00:00Z`))),
    ),
  );
  section.replaceChildren(
    header(t('showcase.releases')),
    h('dl', { class: 'sc-releases' }, ...cards),
    onlyInCinemas(releases, now) ? h('p', { class: 'sc-cinema-note' }, icon('info'), h('span', {}, t('showcase.cinemas-only'))) : '',
  );
}

/** "Season 2 · 8 episodes" (or a story arc), opening a menu of them all. */
export function seasonPicker(options: { label: string; count: number; pick(): void }[], current: number, label: string): HTMLElement {
  const text = (i: number) => `${options[i]!.label} · ${tn('showcase.episode-count', options[i]!.count)}`;
  const button = h('button', { class: 'button sc-season', 'aria-haspopup': 'menu', 'aria-label': `${label}: ${text(current)}`, 'data-focus-id': 'season-picker' }, h('span', { class: 'sc-season-text' }, text(current)), icon('chevronDown'));
  button.addEventListener('click', () => openMenuFrom(button, options.map((option, i) => ({ label: text(i), action: option.pick }))));
  return button;
}
