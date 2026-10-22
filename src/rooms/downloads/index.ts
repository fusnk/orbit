/**
 * Downloads: what's downloading (with progress, pause, resume and cancel) and
 * what's saved, grouped by title, ready to play offline. Shown in the nav
 * once the profile has a download, and opened at startup when Orbit starts
 * without a connection.
 */
import type { Room, RoomContext } from '../../app/router';
import { icon } from '../../components/icons';
import { errorState } from '../../components/state-message';
import { toast } from '../../components/toast';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { hourLabel } from '../../library/download-schedule';
import {
  allDownloads,
  downloadNow,
  downloadsLoadError,
  failureText,
  formatBytes,
  formatDuration,
  formatSpeed,
  fraction,
  loadDownloads,
  onDownloadProgress,
  onDownloadsChange,
  pauseDownload,
  removeDownload,
  retryDownload,
  revealDownload,
  resumeDownload,
  savedPoster,
  secondsLeft,
  storage,
  waitingForWindow,
  type DownloadItem,
} from '../../library/downloads';
import { shownNow } from '../../catalog/parental';
import { openSettingsTo } from '../settings';
import { playDownload } from './actions';
import './downloads.css';

/** How often the space used is read again while a download makes progress. */
const STORAGE_REFRESH_MS = 2000;

export const downloadsRoom: Room = {
  id: 'downloads',
  label: t('downloads.nav'),
  render: (ctx) => downloadsPage(ctx),
};

/** "S1 · E2 · Title", or nothing for a movie. */
function episodeLine(item: DownloadItem): string {
  if (item.season === null || item.episode === null) return '';
  const code = t('titles.common.episode-code', { season: item.season, episode: item.episode });
  return item.episodeTitle ? `${code} · ${item.episodeTitle}` : code;
}

const STATE_KEYS = {
  queued: 'downloads.state.queued',
  running: 'downloads.state.running',
  paused: 'downloads.state.paused',
  expired: 'downloads.state.expired',
  failed: 'downloads.state.failed',
  done: 'downloads.state.done',
} as const;

/** "Downloading · 1.2 GB of 4 GB · 5.2 MB/s · 3 min left", or why it stopped. */
function statusText(item: DownloadItem): string {
  if ((item.state === 'failed' || item.state === 'expired') && item.error) return `${t(STATE_KEYS[item.state])} · ${failureText(item.error)}`;
  // Outside Settings → Downloads → "Only download between".
  const waitFor = waitingForWindow(item);
  const parts: string[] = [waitFor ? t('downloads.schedule.waiting', { time: hourLabel(waitFor.start) }) : t(STATE_KEYS[item.state])];
  if (item.totalBytes) parts.push(t('downloads.progress.of', { done: formatBytes(item.doneBytes), total: formatBytes(item.totalBytes) }));
  else if (item.doneBytes) parts.push(formatBytes(item.doneBytes));
  if (item.state === 'running' && item.speed > 0) {
    parts.push(formatSpeed(item.speed));
    const left = secondsLeft(item);
    if (left !== null) parts.push(t('downloads.progress.left', { time: formatDuration(left) }));
  }
  return parts.join(' · ');
}

/** A poster: the one saved with the download (offline), else the title's own. */
function poster(item: DownloadItem, className: string): HTMLElement {
  const frame = h('span', { class: `download-poster ${className}`, 'aria-hidden': 'true' });
  const show = (src: string) => {
    const img = h('img', { src, alt: '', decoding: 'async', referrerpolicy: 'no-referrer' });
    // A poster that doesn't load (a dead CDN while online) leaves the plain frame, not a broken-image icon.
    img.addEventListener('error', () => img.remove(), { once: true });
    frame.replaceChildren(img);
  };
  void savedPoster(item.id).then((local) => {
    if (local) show(local);
    else if (item.title.poster && navigator.onLine) show(item.title.poster);
  });
  return frame;
}

function downloadsPage(ctx: RoomContext): HTMLElement {
  const storageLine = h('span', { class: 'downloads-storage' });
  const settingsButton = h('button', { class: 'button', 'data-focus-id': 'settings' }, icon('sliders'), t('downloads.page.settings'));
  settingsButton.addEventListener('click', () => {
    openSettingsTo('downloads');
    ctx.go('settings');
  });
  const body = h('div', { class: 'downloads-body' });
  const page = h(
    'div',
    { class: 'room downloads' },
    h('div', { class: 'downloads-header' }, h('h1', { class: 'page-title downloads-title' }, t('downloads.page.title')), storageLine, settingsButton),
    body,
  );
  /** Progress text and bars by download id, updated in place between redraws. */
  const live = new Map<string, { fill: HTMLElement; status: HTMLElement }>();

  /** Runs `action`, saying so if it fails. */
  const act = (action: () => Promise<unknown>) =>
    void action().catch((err: unknown) => {
      console.error('Download action failed', err);
      toast(failureText(err));
    });

  function button(label: string, iconName: Parameters<typeof icon>[0], focusId: string, onClick: () => void, className = 'button'): HTMLButtonElement {
    const b = h('button', { class: className, 'data-focus-id': focusId }, icon(iconName), label);
    b.addEventListener('click', onClick);
    return b;
  }

  /** Delete takes two presses: the first arms it, leaving the button disarms it. */
  function deleteButton(item: DownloadItem, label: string): HTMLButtonElement {
    const remove = button(label, 'trash', `delete-${item.id}`, () => {
      if (remove.dataset.armed) return act(() => removeDownload(item.id));
      remove.dataset.armed = 'true';
      remove.lastChild!.textContent = t('downloads.action.confirm-delete');
    }, 'button danger');
    remove.addEventListener('blur', () => {
      delete remove.dataset.armed;
      remove.lastChild!.textContent = label;
    });
    return remove;
  }

  function activeRow(item: DownloadItem): HTMLElement {
    const fill = h('span', { class: 'progress-fill' });
    const track = h('span', { class: 'download-track' }, fill);
    const status = h('span', { class: 'download-status' }, statusText(item));
    live.set(item.id, { fill, status });
    setFill(fill, item);

    const actions: HTMLElement[] = [];
    if (waitingForWindow(item)) actions.push(button(t('downloads.schedule.now'), 'download', `now-${item.id}`, () => act(() => downloadNow(item.id))));
    if (item.state === 'running' || item.state === 'queued') actions.push(button(t('downloads.action.pause'), 'pause', `pause-${item.id}`, () => act(() => pauseDownload(item.id))));
    else if (item.state === 'paused') actions.push(button(t('downloads.action.resume'), 'play', `resume-${item.id}`, () => act(() => resumeDownload(item.id))));
    else actions.push(button(t('downloads.action.retry'), 'rewind', `retry-${item.id}`, () => act(() => retryDownload(item))));
    actions.push(deleteButton(item, t('downloads.action.cancel')));

    return h(
      'div',
      { class: `download-row ${item.state}` },
      poster(item, 'small'),
      h(
        'div',
        { class: 'download-text' },
        h('span', { class: 'download-name' }, item.title.name),
        h('span', { class: 'download-sub' }, [episodeLine(item), item.label].filter(Boolean).join(' · ')),
        track,
        status,
      ),
      h('div', { class: 'download-actions' }, ...actions),
    );
  }

  function savedItem(item: DownloadItem): HTMLElement {
    const play = button(t('downloads.action.play'), 'play', `play-${item.id}`, () => void playDownload(item, ctx), 'button primary');
    const reveal = button(t('downloads.action.reveal'), 'folder', `reveal-${item.id}`, () => act(() => revealDownload(item.id)));
    const size = item.totalBytes ? formatBytes(item.totalBytes) : '';
    return h(
      'div',
      { class: 'download-saved' },
      // A film's one row sits under its own name already (the group's head): it shows just its quality and size.
      h('div', { class: 'download-text' }, item.season === null ? '' : h('span', { class: 'download-name' }, episodeLine(item) || item.title.name), h('span', { class: 'download-sub' }, [item.label, size].filter(Boolean).join(' · '))),
      h('div', { class: 'download-actions' }, play, reveal, deleteButton(item, t('downloads.action.delete'))),
    );
  }

  function savedGroup(items: DownloadItem[]): HTMLElement {
    const first = items[0]!;
    const total = items.reduce((sum, i) => sum + (i.totalBytes ?? 0), 0);
    const series = first.season !== null;
    const meta = [series ? tn('downloads.page.episodes', items.length) : '', formatBytes(total)].filter(Boolean).join(' · ');
    return h(
      'article',
      { class: 'download-group' },
      poster(first, 'large'),
      h(
        'div',
        { class: 'download-group-body' },
        h('div', { class: 'download-group-head' }, h('h3', { class: 'download-group-title' }, first.title.name), h('span', { class: 'download-sub' }, meta)),
        h('div', { class: 'download-group-items' }, ...items.map(savedItem)),
      ),
    );
  }

  function render(): void {
    const focused = document.activeElement instanceof HTMLElement && page.contains(document.activeElement) ? document.activeElement : null;
    const focusId = focused?.dataset.focusId;
    const rowsOf = () => [...body.querySelectorAll<HTMLElement>('.download-row, .download-saved')];
    const at = focused ? rowsOf().findIndex((row) => row.contains(focused)) : -1;
    live.clear();
    // Only what this profile may watch (its content limit): the rest stay saved, just not listed here.
    const all = shownNow(allDownloads(), (d) => d.title, render);
    const active = all.filter((d) => d.state !== 'done');
    const done = all.filter((d) => d.state === 'done');

    const sections: HTMLElement[] = [];
    if (!navigator.onLine && done.length) sections.push(h('p', { class: 'downloads-offline' }, t('downloads.page.offline')));
    if (active.length) {
      sections.push(h('section', { class: 'downloads-section' }, h('h2', { class: 'downloads-heading' }, t('downloads.page.active')), h('div', { class: 'download-list' }, ...active.map(activeRow))));
    }
    if (done.length) {
      // Grouped by title, newest first; episodes in order.
      const groups = new Map<string, DownloadItem[]>();
      for (const item of [...done].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))) groups.set(item.titleId, [...(groups.get(item.titleId) ?? []), item]);
      const ordered = [...groups.values()].map((items) => items.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0)));
      sections.push(h('section', { class: 'downloads-section' }, h('h2', { class: 'downloads-heading' }, t('downloads.page.done')), h('div', { class: 'download-groups' }, ...ordered.map(savedGroup))));
    }
    // Downloads that couldn't be read aren't "nothing downloaded": say so, with Try again.
    const loadError = downloadsLoadError();
    if (!all.length && loadError !== null) {
      sections.push(errorState({ title: t('states.downloads.failed'), err: loadError, retry: () => void loadDownloads().catch(() => undefined) }));
    } else if (!all.length) {
      sections.push(h('div', { class: 'downloads-empty' }, icon('download'), h('span', { class: 'downloads-empty-title' }, t('downloads.page.empty-title')), h('p', { class: 'muted' }, t('downloads.page.empty-body'))));
    }
    body.replaceChildren(...sections);
    if (focusId) {
      // The same control; else the same download where it went (finished: under Downloaded); else
      // the row that took its place (deleted or cancelled), on the same kind of control: after a
      // delete, the next row's Delete rather than its Play, so a second Enter doesn't start a film.
      const rows = rowsOf();
      const kind = focusId.slice(0, focusId.indexOf('-') + 1);
      const download = focusId.slice(focusId.indexOf('-') + 1);
      const row = at < 0 ? undefined : (rows.find((r) => r.querySelector(`[data-focus-id$="-${CSS.escape(download)}"]`)) ?? rows[Math.min(at, rows.length - 1)]);
      const target = page.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`) ?? (kind ? row?.querySelector<HTMLElement>(`[data-focus-id^="${CSS.escape(kind)}"]`) : null) ?? row?.querySelector<HTMLElement>('button') ?? (at < 0 ? null : settingsButton);
      target?.focus({ preventScroll: true });
    }
    showStorage();
  }

  /** Space used (partial files included) and free; kept up to date while downloads run. */
  let storageAt = 0;
  function showStorage(): void {
    storageAt = Date.now();
    void storage()
      .then((s) => (storageLine.textContent = s.free === null ? t('downloads.page.storage-used', { used: formatBytes(s.used) }) : t('downloads.page.storage', { used: formatBytes(s.used), free: formatBytes(s.free) })))
      .catch(() => (storageLine.textContent = ''));
  }

  function setFill(fill: HTMLElement, item: DownloadItem): void {
    const f = fraction(item);
    fill.style.setProperty('--progress', String(f ?? 0));
  }

  // Redraw on changes (at most once a frame); progress only touches its own row.
  let pending = false;
  onDownloadsChange(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      render();
    });
  });
  onDownloadProgress((item) => {
    const row = live.get(item.id);
    if (!row) return;
    setFill(row.fill, item);
    row.status.textContent = statusText(item);
    if (page.isConnected && Date.now() - storageAt >= STORAGE_REFRESH_MS) showStorage();
  });
  window.addEventListener('online', render);
  window.addEventListener('offline', render);
  render();
  return page;
}
