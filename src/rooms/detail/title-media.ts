/**
 * The title page's Media section (needs a TMDB token): videos, backdrops,
 * posters and logos from TMDB, one tab each. A video plays in Orbit's player
 * as a trailer; an image opens full size.
 */
import type { MediaImage, MediaVideo, TitleMedia, VideoKind } from '../../catalog/extras';
import { artImage } from '../../components/cards';
import { icon } from '../../components/icons';
import { openImageViewer } from '../../components/image-viewer';
import { scrollFade, scrollRow } from '../../components/scroll-fade';
import { locale, t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';

type Tab = 'videos' | 'backdrops' | 'posters' | 'logos';

const TAB_LABELS: Record<Tab, MessageKey> = {
  videos: 'titles.detail.media-videos',
  backdrops: 'titles.detail.media-backdrops',
  posters: 'titles.detail.media-posters',
  logos: 'titles.detail.media-logos',
};

const KIND_LABELS: Record<VideoKind, MessageKey> = {
  trailer: 'titles.detail.video-trailer',
  teaser: 'titles.detail.video-teaser',
  clip: 'titles.detail.video-clip',
  featurette: 'titles.detail.video-featurette',
  'behind-the-scenes': 'titles.detail.video-behind-the-scenes',
  bloopers: 'titles.detail.video-bloopers',
  'opening-credits': 'titles.detail.video-opening-credits',
  recap: 'titles.detail.video-recap',
};

/** YouTube's own still for a video (an id already checked against /^[\w-]{6,20}$/). */
const youtubeThumb = (key: string) => `https://i.ytimg.com/vi/${key}/hqdefault.jpg`;

/** Fills `section` with the media tabs and row; hides it when there's nothing to show. */
export function fillMedia(section: HTMLElement, media: TitleMedia | null, playVideo: (video: MediaVideo) => void): void {
  const tabs = (Object.keys(TAB_LABELS) as Tab[]).filter((tab) => media?.[tab].length);
  section.hidden = !media || !tabs.length;
  if (!media || !tabs.length) return;
  let current = tabs[0]!;

  const row = scrollFade(h('div', { class: 'media-row' }));
  const arrow = (dir: 1 | -1) => {
    const button = h('button', { class: 'rail-scroll', title: dir > 0 ? t('titles.detail.scroll-right') : t('titles.detail.scroll-left'), tabindex: '-1' }, icon(dir > 0 ? 'chevronRight' : 'chevronLeft'));
    button.addEventListener('click', () => scrollRow(row, dir));
    return button;
  };
  const buttons = tabs.map((tab) => {
    const button = h('button', { class: 'segment', 'data-focus-id': `media-${tab}` }, t(TAB_LABELS[tab]), h('span', { class: 'media-count' }, media[tab].length.toLocaleString(locale())));
    button.addEventListener('click', () => {
      current = tab;
      draw();
    });
    return button;
  });

  function draw(): void {
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(tabs[i] === current)));
    row.className = `media-row scroll-fade media-${current}`;
    row.scrollLeft = 0;
    row.replaceChildren(...(current === 'videos' ? media!.videos.map((video) => videoCard(video, playVideo)) : imageCards(media![current], t(TAB_LABELS[current]))));
  }

  section.replaceChildren(
    h('div', { class: 'cast-header' }, h('h2', { class: 'section-title' }, t('titles.detail.media')), h('span', { class: 'rail-arrows', 'data-nav-skip': true }, arrow(-1), arrow(1))),
    tabs.length > 1 ? h('div', { class: 'segments', role: 'group', 'aria-label': t('titles.detail.media') }, ...buttons) : '',
    row,
  );
  draw();
}

export function videoCard(video: MediaVideo, play: (video: MediaVideo) => void): HTMLElement {
  const kind = video.kind ? t(KIND_LABELS[video.kind]) : '';
  const card = h(
    'button',
    { class: 'card media-card', title: video.name, 'aria-label': kind ? `${video.name}, ${kind}` : video.name },
    h('span', { class: 'frame media-thumb' }, artImage(youtubeThumb(video.key), 'art'), h('span', { class: 'episode-play', 'aria-hidden': 'true' }, icon('play', { filled: true }))),
    h('span', { class: 'card-text' }, h('span', { class: 'card-title media-name' }, video.name), kind ? h('span', { class: 'card-sub' }, kind) : ''),
  );
  card.addEventListener('click', () => play(video));
  return card;
}

export function imageCards(images: MediaImage[], label: string): HTMLElement[] {
  const full = images.map((image) => image.full);
  return images.map((image, i) => {
    const card = h('button', { class: 'card media-card', 'aria-label': `${label}, ${t('titles.detail.media-position', { number: i + 1, count: images.length })}` }, h('span', { class: 'frame media-thumb' }, artImage(image.thumb, 'art')));
    card.addEventListener('click', () => openImageViewer(full, i, label));
    return card;
  });
}
