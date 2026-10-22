/**
 * My Library → My cloud: what's in the person's debrid accounts, every
 * connected provider merged, newest first, with a provider badge on each.
 * Search, a provider filter and a status filter narrow it; opening an item
 * lists its files (episodes named "S1 · E3", as in a torrent's file list)
 * to play or download. A provider that fails or is rate-limited says so on
 * its own line and keeps showing what Orbit last saw of it.
 *
 * Names come from the accounts: only ever set as text.
 */
import { invoke } from '@tauri-apps/api/core';
import type { RoomContext } from '../../app/router';
import type { Title } from '../../catalog/titles';
import { openDrawer } from '../../components/drawer';
import { icon } from '../../components/icons';
import { openMenuFrom } from '../../components/menu';
import { createTextField, editingAt, resumeEditing } from '../../components/text-field';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { arrangeCloud, countByProvider, displayName, type CloudFilter, type CloudSort } from '../../lib/cloud-names';
import { h } from '../../lib/dom';
import { classify, errorState, errorText, fixButton } from '../../components/state-message';
import { streamLabels } from '../../lib/stream-traits';
import { baseName } from '../../lib/torrent-files';
import {
  CLOUD_ADDON_KEY,
  cloudAccounts,
  cloudEpisode,
  cloudFiles,
  cloudId,
  cloudItems,
  deleteCloudItem,
  findCloudTitle,
  nameOfFile,
  providerName,
  type CloudFile,
  type CloudItem,
  type CloudListing,
  type CloudProvider,
} from '../../library/cloud';
import { failureText, formatBytes, loadDownloads } from '../../library/downloads';
import { snapshot } from '../../library/snapshot';
import type { EpisodeRef } from '../detail/title-actions';
import { openPlayer, type PlayRequest } from '../player';
import { createFilePicker, focusFilePicker } from '../player/file-picker';
import type { PlayableSource } from '../player/panels';
import { playAllowed } from '../profiles/parental';
import { problemText } from '../settings/debrid';

const FILTERS: readonly (readonly [CloudFilter, string])[] = [
  ['all', t('cloud.filter.all')],
  ['ready', t('cloud.filter.ready')],
  ['active', t('cloud.filter.active')],
  ['error', t('cloud.filter.error')],
];
const SORTS: readonly (readonly [CloudSort, string])[] = [
  ['added', t('cloud.sort.added')],
  ['name', t('cloud.sort.name')],
  ['size', t('cloud.sort.size')],
];

/** "Ready", "Downloading 42%", "Waiting", "Failed". */
export function stateText(item: Pick<CloudItem, 'state' | 'progress'>): string {
  switch (item.state) {
    case 'ready':
      return t('cloud.state.ready');
    case 'downloading':
      return t('cloud.state.downloading', { percent: Math.floor(item.progress) });
    case 'queued':
      return t('cloud.state.queued');
    default:
      return t('cloud.state.error');
  }
}

/** The view, kept while My Library is open; `shown` refreshes it each time its tab shows. */
export function createCloudView(ctx: RoomContext): { element: HTMLElement; shown(): void } {
  let listing: CloudListing | null = null;
  /** Why the last load failed (null when it didn't). */
  let failed: unknown = null;
  let loading = false;
  let generation = 0;
  let query = '';
  let provider: CloudProvider | null = null;
  let filter: CloudFilter = 'all';
  let sort: CloudSort = 'added';
  let providers: CloudProvider[] = [];

  const search = createTextField({ label: t('cloud.search'), placeholder: t('cloud.search'), onSubmit: () => {}, className: 'library-search' });
  search.dataset.focusId = 'cloud-search';
  search.addEventListener('input', () => {
    query = search.value;
    drawList();
  });
  const refresh = h('button', { class: 'button glass', 'data-focus-id': 'cloud-refresh' }, t('cloud.refresh'));
  refresh.addEventListener('click', () => void load(true));
  const controls = h('div', { class: 'library-filters cloud-filters' });
  const problems = h('div', { class: 'cloud-problems', role: 'status' });
  const list = h('div', { class: 'cloud-list' });
  const element = h('section', { class: 'library-section cloud' }, controls, problems, list);

  function segments<T>(label: string, options: readonly (readonly [T, string])[], current: T, pick: (value: T) => void, id: string): HTMLElement {
    return h(
      'div',
      { class: 'segments', role: 'group', 'aria-label': label },
      ...options.map(([value, text]) => {
        const button = h('button', { class: 'segment', 'aria-pressed': String(value === current), 'data-focus-id': `cloud-${id}-${String(value)}` }, text);
        button.addEventListener('click', () => {
          pick(value);
          drawControls();
          drawList();
        });
        return button;
      }),
    );
  }

  function drawControls(): void {
    const focused = document.activeElement instanceof HTMLElement && controls.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    // The search is moved below, which drops its focus and ends its editing (the listing arriving while typing).
    const searching = document.activeElement === search;
    const typing = searching ? editingAt(search) : null;
    const counts = countByProvider(listing?.items ?? []);
    const providerChoice: readonly (readonly [CloudProvider | null, string])[] = [[null, t('cloud.all-accounts')], ...providers.map((p) => [p, `${providerName(p)} (${counts.get(p) ?? 0})`] as const)];
    const sortButton = h('button', { class: 'button glass library-pick', 'data-focus-id': 'cloud-sort' }, t('titles.library.sort', { sort: SORTS.find(([s]) => s === sort)![1] }), icon('chevronDown'));
    sortButton.addEventListener('click', () =>
      openMenuFrom(
        sortButton,
        SORTS.map(([value, label]) => ({
          label,
          action: () => {
            sort = value;
            drawControls();
            drawList();
          },
        })),
      ),
    );
    controls.replaceChildren(
      search,
      // With one account there's nothing to choose between.
      providers.length > 1 ? segments(t('cloud.accounts'), providerChoice, provider, (p) => (provider = p), 'provider') : '',
      segments(t('cloud.filter.label'), FILTERS, filter, (f) => (filter = f), 'filter'),
      h('span', { class: 'library-filters-gap' }),
      sortButton,
      refresh,
    );
    if (focused) controls.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    if (typing) resumeEditing(search, typing);
    else if (searching && document.activeElement !== search) search.focus({ preventScroll: true });
  }

  function drawProblems(): void {
    const lines = (listing?.problems ?? []).map((p) => h('p', { class: 'cloud-problem' }, problemText(p, providerName(p.provider))));
    // A key that stopped working is fixed in Settings: offer the way there.
    const denied = (listing?.problems ?? []).some((p) => p.kind === 'denied') || (failed !== null && classify(failed, 'debrid').cause === 'signed-out');
    problems.replaceChildren(...lines, failed !== null && listing ? h('p', { class: 'cloud-problem' }, errorText(failed, { service: 'debrid' })) : '', denied ? fixButton('debrid', ctx.go) : '');
  }

  function row(item: CloudItem): HTMLElement {
    const detail = [formatBytes(item.size), stateText(item)].join(' · ');
    const button = h(
      'button',
      { class: `cloud-row ${item.state}`, 'data-focus-id': `cloud:${item.provider}:${item.id}`, title: item.name },
      h('span', { class: 'cloud-badge' }, providerName(item.provider)),
      h('span', { class: 'cloud-row-text' }, h('span', { class: 'cloud-row-name' }, item.name), h('span', { class: 'cloud-row-detail' }, detail)),
      item.state === 'downloading' ? progressBar(item.progress) : '',
    );
    button.addEventListener('click', () => openItem(item));
    return button;
  }

  function progressBar(percent: number): HTMLElement {
    const fill = h('span', { class: 'cloud-progress-fill' });
    // CSSOM, not a style attribute: the CSP allows no inline styles.
    fill.style.inlineSize = `${Math.round(percent)}%`;
    return h('span', { class: 'cloud-progress', 'aria-hidden': 'true' }, fill);
  }

  function drawList(): void {
    const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    if (!listing) {
      list.replaceChildren(
        !loading && failed !== null ? errorState({ title: t('states.cloud.failed'), err: failed, retry: () => void load(false), go: ctx.go, service: 'debrid' }) : h('p', { class: 'muted cloud-note' }, loading ? t('cloud.loading') : ''),
      );
      return;
    }
    const shown = arrangeCloud(listing.items, { query, provider, filter, sort });
    if (!listing.items.length) {
      list.replaceChildren(h('div', { class: 'library-empty' }, h('span', { class: 'library-empty-title' }, t('cloud.empty')), h('p', { class: 'muted' }, t('cloud.empty-body'))));
      return;
    }
    list.replaceChildren(...(shown.length ? shown.map(row) : [h('p', { class: 'muted cloud-note' }, t('cloud.no-match'))]));
    if (focused) list.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  async function load(fresh: boolean): Promise<void> {
    const run = ++generation;
    loading = true;
    refresh.disabled = true;
    if (!listing) drawList();
    try {
      const [accounts, next] = await Promise.all([cloudAccounts(), cloudItems({ refresh: fresh })]);
      if (run !== generation) return;
      providers = accounts.map((a) => a.provider);
      if (provider && !providers.includes(provider)) provider = null;
      listing = next;
      failed = null;
    } catch (err) {
      if (run !== generation) return;
      failed = err;
    } finally {
      if (run === generation) {
        loading = false;
        refresh.disabled = false;
      }
    }
    drawControls();
    drawProblems();
    drawList();
  }

  // ── An item's files ──

  /**
   * Drawers (by their status line) closed since they opened: finding a file's title can
   * take seconds, and closing the drawer meanwhile means the person no longer wants it to
   * play (a download, which runs in the background, still starts).
   */
  const closedDrawers = new WeakSet<HTMLElement>();

  function openItem(item: CloudItem): void {
    const status = h('p', { class: 'cloud-drawer-status', role: 'status' });
    const files = h('div', { class: 'cloud-drawer-files' }, h('p', { class: 'muted' }, t('cloud.files.loading')));
    const closeButton = h('button', { class: 'icon-button', title: t('titles.streams.close-esc'), 'aria-label': t('titles.streams.close') }, icon('close'));
    const footer = h('div', { class: 'cloud-drawer-footer' });
    const content = h(
      'div',
      { class: 'cloud-drawer' },
      h('div', { class: 'cloud-drawer-head' }, h('div', {}, h('h2', { class: 'cloud-drawer-title' }, item.name), h('p', { class: 'muted' }, [providerName(item.provider), formatBytes(item.size), stateText(item)].join(' · '))), closeButton),
      status,
      files,
      footer,
    );
    const close = openDrawer(content, item.name, () => closedDrawers.add(status));
    closeButton.addEventListener('click', close);
    closeButton.focus({ preventScroll: true });

    if (item.deletable) footer.append(deleteButton(item, status, close));

    void cloudFiles(item.provider, item.id)
      .then((found) => {
        if (!found.ready) files.replaceChildren(h('p', { class: 'muted' }, t('cloud.files.not-ready', { provider: providerName(item.provider) })));
        else {
          const picker = createFilePicker({ list: { files: found.files }, chosenLabel: '', onPick: (file) => pick(item, file, status, close) });
          files.replaceChildren(picker);
          focusFilePicker(picker);
        }
      })
      .catch((err: unknown) => files.replaceChildren(h('p', { class: 'muted' }, t('cloud.files.failed')), h('p', { class: 'muted' }, errorText(err, { service: 'debrid' }))));
  }

  /** Delete takes two presses: the first arms it, leaving the button disarms it. */
  function deleteButton(item: CloudItem, status: HTMLElement, close: () => void): HTMLElement {
    const name = providerName(item.provider);
    const label = t('cloud.delete', { provider: name });
    const button = h('button', { class: 'button danger' }, icon('trash'), label);
    button.addEventListener('click', () => {
      if (!button.dataset.armed) {
        button.dataset.armed = 'true';
        button.lastChild!.textContent = t('cloud.delete-confirm', { provider: name });
        return;
      }
      button.disabled = true;
      void deleteCloudItem(item.provider, item.id)
        .then(() => {
          toast(t('cloud.deleted', { provider: name }));
          if (listing) listing = { ...listing, items: listing.items.filter((i) => !(i.provider === item.provider && i.id === item.id)) };
          const rows = () => [...list.querySelectorAll<HTMLElement>('.cloud-row')];
          const at = rows().findIndex((el) => el.dataset.focusId === `cloud:${item.provider}:${item.id}`);
          close();
          drawControls();
          drawList();
          // Its row is gone: focus stays at its place in the list, or goes to Refresh when the list is empty.
          if ((!document.activeElement || document.activeElement === document.body) && element.isConnected) {
            const left = rows();
            (left[Math.min(Math.max(at, 0), left.length - 1)] ?? refresh).focus({ preventScroll: true });
          }
        })
        .catch((err: unknown) => {
          status.textContent = t('cloud.delete-failed', { reason: errorText(err, { service: 'debrid' }) });
          button.disabled = false;
        });
    });
    button.addEventListener('blur', () => {
      delete button.dataset.armed;
      button.lastChild!.textContent = label;
    });
    return button;
  }

  function pick(item: CloudItem, file: CloudFile, status: HTMLElement, close: () => void): void {
    if (!file.address) {
      status.textContent = t('cloud.action.cant-play');
      return;
    }
    const anchor = document.activeElement instanceof HTMLElement ? document.activeElement : status;
    openMenuFrom(anchor, [
      { label: t('cloud.action.play'), action: () => void play(item, file, status, close) },
      { label: t('cloud.action.download'), action: () => void download(item, file, status) },
    ]);
  }

  /** The catalog title a file is (or an untitled one), and its episode. */
  async function identify(item: CloudItem, file: CloudFile, status: HTMLElement): Promise<{ title: Title; episode?: EpisodeRef; untitled: boolean }> {
    status.textContent = t('cloud.action.finding');
    const parsed = nameOfFile(item, file);
    const found = await findCloudTitle(parsed);
    status.textContent = '';
    const episode = found?.type === 'series' ? cloudEpisode(found, parsed) : undefined;
    if (found && (found.type !== 'series' || episode)) return { title: found, ...(episode ? { episode } : {}), untitled: false };
    return { title: { id: cloudId(item, file), type: 'movie', name: displayName(parsed), year: parsed.year, genres: [], origins: [] }, untitled: true };
  }

  async function play(item: CloudItem, file: CloudFile, status: HTMLElement, close: () => void): Promise<void> {
    const { title, episode, untitled } = await identify(item, file, status);
    if (closedDrawers.has(status)) return;
    const { traits } = streamLabels({ filename: baseName(file.name), videoSize: file.size });
    const source: PlayableSource = {
      id: 'cloud',
      url: file.address!,
      addon: providerName(item.provider),
      label: traits.resolution ?? t('cloud.source.label'),
      meta: [traits.hdr, formatBytes(file.size)].filter(Boolean).join(' · '),
      filename: baseName(file.name),
      videoSize: file.size,
      fileChosen: true,
    };
    // An untitled file plays like one from this PC: progress kept, out of Continue Watching and sync.
    const request: PlayRequest = { title, episode, source, sources: [source], ...(untitled ? { local: true } : {}) };
    const go = () => {
      close();
      openPlayer(request, ctx);
    };
    if (playAllowed(title, go)) go();
  }

  async function download(item: CloudItem, file: CloudFile, status: HTMLElement): Promise<void> {
    const { title, episode } = await identify(item, file, status);
    if (!playAllowed(title, () => void download(item, file, status))) return;
    const videoId = episode?.episode.id ?? title.id;
    const { traits } = streamLabels({ filename: baseName(file.name), videoSize: file.size });
    const request = {
      titleId: title.id,
      videoId,
      title: snapshot(title),
      name: title.name,
      year: title.year ?? null,
      season: episode?.season ?? null,
      episode: episode?.episode.number ?? null,
      episodeTitle: episode?.episode.title || null,
      label: [traits.resolution, formatBytes(file.size), providerName(item.provider)].filter(Boolean).join(' · '),
      addonKey: CLOUD_ADDON_KEY,
      streamType: title.type,
      streamId: videoId,
      identity: `cloud:${item.provider}:${item.id}:${file.index}`,
      url: file.address,
      upload: false,
      poster: title.poster ?? null,
      logo: title.logo ?? null,
      subtitles: [],
    };
    try {
      await invoke('download_start', { request });
      await loadDownloads().catch(() => undefined);
      toast(t('downloads.toast.started', { name: episode ? `${title.name} · ${episode.episode.title}` : title.name }));
    } catch (err) {
      status.textContent = t('downloads.toast.failed-start', { reason: failureText(err) });
    }
  }

  drawControls();
  drawList();
  return {
    element,
    shown: () => void load(false),
  };
}
