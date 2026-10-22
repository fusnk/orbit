/**
 * Download controls on a title page: the movie's Download button, each
 * episode's download button, and the ⋯ menu's download items. Each shows
 * whether that movie or episode is downloading (with its progress) or saved.
 */
import type { RoomContext } from '../../app/router';
import { isShowType, type Title } from '../../catalog/titles';
import { icon } from '../../components/icons';
import { openMenuFrom, type MenuItem } from '../../components/menu';
import { locale, t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { blockReason, downloadOf, failureText, fraction, isLiveType, onDownloadProgress, removeDownload, type DownloadItem } from '../../library/downloads';
import type { EpisodeRef } from '../detail/title-actions';
import { toast } from '../../components/toast';
import { keepNextOf } from '../../library/auto-downloads';
import { downloadChoices } from './actions';
import { downloadSeason, seasonEpisodes, setKeepNextFor } from './auto';
import './title-downloads.css';

const percent = (item: DownloadItem) => new Intl.NumberFormat(locale(), { style: 'percent' }).format(fraction(item) ?? 0);

const updaters = new WeakMap<Element, (item: DownloadItem) => void>();
let following = false;

/**
 * Keeps `update` called with progress while `el` is on the page. One listener
 * serves every button and finds them in the document, so buttons redrawn away
 * (each state change redraws them) are simply forgotten instead of piling up
 * listeners; a kept page that's away catches up on the next tick when shown.
 */
function followProgress(el: HTMLElement, id: string, update: (item: DownloadItem) => void): void {
  el.dataset.downloadProgress = id;
  updaters.set(el, update);
  if (following) return;
  following = true;
  onDownloadProgress((item) => {
    for (const node of document.querySelectorAll(`[data-download-progress="${CSS.escape(item.id)}"]`)) updaters.get(node)?.(item);
  });
}

const videoIdOf = (title: Title, episode?: EpisodeRef) => episode?.episode.id ?? title.id;

/** A failed download offers Download again (another try, or another source), as if there were none. */
const activeDownload = (videoId: string) => {
  const item = downloadOf(videoId);
  return item && item.state !== 'failed' ? item : undefined;
};

/** "Downloading 40%" while it can move; otherwise what it's doing ("Paused", "Link expired"). */
const progressText = (item: DownloadItem) =>
  item.state === 'running' || item.state === 'queued' ? t('downloads.action.downloading', { percent: percent(item) }) : t(`downloads.state.${item.state}`);

/**
 * The movie's Download button: downloads, shows progress, or says it's saved.
 * `compact` (the Showcase title page): a round icon until there's progress to show.
 */
export function heroDownloadButton(title: Title, ctx: RoomContext, compact = false): HTMLElement {
  if (isLiveType(title.type)) return h('button', { class: 'button large glass', disabled: true, title: blockReason('live'), 'data-focus-id': 'download' }, icon('download'), t('downloads.blocked.short'));
  const item = activeDownload(title.id);
  if (!item) {
    const failed = downloadOf(title.id);
    const button = compact
      ? h('button', { class: 'button large glass icon-only sc-round', 'data-focus-id': 'download', 'aria-haspopup': 'menu', 'aria-label': t('downloads.action.download'), title: failed ? failureText(failed.error) : t('downloads.action.download') }, icon('download'))
      : h('button', { class: 'button large glass', 'data-focus-id': 'download', 'aria-haspopup': 'menu', ...(failed ? { title: failureText(failed.error) } : {}) }, icon('download'), t('downloads.action.download'));
    button.addEventListener('click', () => openMenuFrom(button, downloadChoices(title, undefined, ctx)));
    return button;
  }
  const done = item.state === 'done';
  const label = h('span', { class: 'download-progress-note' }, done ? t('downloads.action.downloaded') : progressText(item));
  const button = h('button', { class: 'button large glass', 'data-focus-id': 'download', title: t('downloads.action.open-page') }, icon(done ? 'check' : 'download'), label);
  button.addEventListener('click', () => ctx.go('downloads'));
  if (!done) followProgress(button, item.id, (i) => (label.textContent = progressText(i)));
  return button;
}

/** An episode's download button, a sibling of its row (its own focus stop; pressing it never plays). */
export function episodeDownloadButton(title: Title, ref: EpisodeRef, ctx: RoomContext): HTMLElement {
  const item = activeDownload(videoIdOf(title, ref));
  const focusId = `download-${ref.season}-${ref.episode.number}`;
  if (!item) {
    const label = t('downloads.detail.download-episode', { number: ref.episode.number, title: ref.episode.title });
    const button = h('button', { class: 'episode-download', title: label, 'aria-label': label, 'aria-haspopup': 'menu', 'data-focus-id': focusId }, icon('download'));
    button.addEventListener('click', () => openMenuFrom(button, downloadChoices(title, ref, ctx)));
    return button;
  }
  const done = item.state === 'done';
  const label = done ? t('downloads.detail.episode-downloaded', { number: ref.episode.number }) : t('downloads.detail.episode-downloading', { number: ref.episode.number });
  const button = h('button', { class: `episode-download${done ? ' on' : ''}`, title: label, 'aria-label': label, 'data-focus-id': focusId }, done ? icon('check') : h('span', { class: 'download-percent' }, percent(item)));
  button.addEventListener('click', () => ctx.go('downloads'));
  if (!done) followProgress(button, item.id, (i) => button.firstElementChild && (button.firstElementChild.textContent = percent(i)));
  return button;
}

/** The ⋯ menu's download items, for the movie or the episode Play would start, and a series' "Keep next episodes downloaded". */
export function downloadMenuItems(title: Title, episode: EpisodeRef | undefined, ctx: RoomContext): MenuItem[] {
  if (isLiveType(title.type)) return [];
  if (isShowType(title.type)) return [...(episode ? episodeMenuItems(title, episode, ctx) : []), ...keepNextItems(title)];
  return episodeMenuItems(title, undefined, ctx);
}

/** "Keep next episodes downloaded" on or off, and while on, whether watched episodes are deleted. */
function keepNextItems(title: Title): MenuItem[] {
  const keep = keepNextOf(title.id);
  if (!keep) return [{ label: t('downloads.auto.turn-on'), action: () => void setKeepNextFor(title, { deleteWatched: false }).catch(saveFailed) }];
  return [
    { label: t('downloads.auto.turn-off'), action: () => void setKeepNextFor(title, null).catch(saveFailed) },
    {
      label: keep.deleteWatched ? t('downloads.auto.keep-watched') : t('downloads.auto.delete-watched'),
      action: () => void setKeepNextFor(title, { deleteWatched: !keep.deleteWatched }).catch(saveFailed),
    },
  ];
}

const saveFailed = (err: unknown) => {
  console.warn('Could not save the download choice', err);
  toast(t('downloads.auto.save-failed'));
};

/**
 * The season header's "Download season": the first press says how many
 * episodes it would queue, the second queues them (leaving the button
 * cancels). Nothing when every aired episode is already downloaded.
 */
export function seasonDownloadButton(title: Title, season: number): HTMLElement | '' {
  if (isLiveType(title.type)) return '';
  const count = seasonEpisodes(title, season).length;
  if (!count) return '';
  const label = t('downloads.season.download');
  const button = h('button', { class: 'see-all', 'data-focus-id': 'download-season' }, label);
  button.addEventListener('click', () => {
    if (!button.dataset.armed) {
      button.dataset.armed = 'true';
      button.textContent = tn('downloads.season.confirm', seasonEpisodes(title, season).length);
      return;
    }
    delete button.dataset.armed;
    button.textContent = label;
    void downloadSeason(title, season);
  });
  button.addEventListener('blur', () => {
    delete button.dataset.armed;
    button.textContent = label;
  });
  return button;
}

function episodeMenuItems(title: Title, episode: EpisodeRef | undefined, ctx: RoomContext): MenuItem[] {
  const item = activeDownload(videoIdOf(title, episode));
  if (item) {
    return [
      { label: t('downloads.action.open-page'), action: () => ctx.go('downloads') },
      { label: t('downloads.menu.delete'), action: () => void removeDownload(item.id).catch(() => undefined) },
    ];
  }
  const [best, choose] = downloadChoices(title, episode, ctx);
  return [
    { label: episode ? t('downloads.menu.best-episode', { season: episode.season, episode: episode.episode.number }) : t('downloads.menu.best'), action: best!.action },
    { label: t('downloads.menu.choose'), action: choose!.action },
  ];
}
