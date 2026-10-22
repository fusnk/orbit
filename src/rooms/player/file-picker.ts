/**
 * A torrent's file list, to pick the file to play (season packs: one
 * torrent, many episodes). Shown in the source picker and the player's
 * Source panel. Video files that aren't samples or extras are listed first;
 * the rest on request. The list redraws in place as the search or sort
 * changes, so the search field keeps focus and editing.
 *
 * File names come from the torrent: they're only ever set as text.
 */
import { createSwitch } from '../../components/switch';
import { createTextField } from '../../components/text-field';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { arrangeFiles, baseName, defaultSort, folderOf, isMain, type FileSort, type TorrentFile, type TorrentFiles } from '../../lib/torrent-files';
import { formatBytes } from '../../library/downloads';
import './file-picker.css';

const SORTS: readonly (readonly [FileSort, string])[] = [
  ['episode', t('player.files.sort-episode')],
  ['name', t('player.files.sort-name')],
  ['size', t('player.files.sort-size')],
];

/** "S1 · E3", "S1 · E1–2", "Episode 12", or '' for a file without a number. */
export function fileEpisodeLabel(file: Pick<TorrentFile, 'season' | 'episode' | 'lastEpisode'>): string {
  if (file.episode === undefined) return '';
  const episode = file.lastEpisode !== undefined ? `${file.episode}–${file.lastEpisode}` : String(file.episode);
  return file.season !== undefined ? t('titles.common.episode-code', { season: file.season, episode }) : t('player.files.episode', { episode });
}

/**
 * The picker. `chosenLabel` names the file that plays automatically (when
 * it isn't the one playing): "This episode" if its name says so.
 */
export function createFilePicker(options: { list: TorrentFiles; chosenLabel: string; onPick(file: TorrentFile): void }): HTMLElement {
  const { files, playing, chosen } = options.list;
  let query = '';
  let sort: FileSort = defaultSort(files);
  let all = false;
  const current = playing ?? chosen;
  const hidden = files.filter((f) => !isMain(f)).length;

  const search = createTextField({ label: t('player.files.search'), placeholder: t('player.files.search'), className: 'file-search', onSubmit: () => {} });
  search.dataset.focusId = 'files-search';
  search.addEventListener('input', () => {
    query = search.value;
    renderList();
  });

  const sortChips = SORTS.map(([value, label]) => {
    const chip = h('button', { class: 'chip', 'aria-pressed': String(value === sort), 'data-focus-id': `files-sort-${value}` }, label);
    chip.addEventListener('click', () => {
      sort = value;
      for (const [i, c] of sortChips.entries()) c.setAttribute('aria-pressed', String(SORTS[i]![0] === sort));
      renderList();
    });
    return chip;
  });

  const controls = h('div', { class: 'file-picker-controls' }, search, h('div', { class: 'chips file-sorts', role: 'group', 'aria-label': t('player.files.sort') }, ...sortChips));
  if (hidden) {
    const showAll = createSwitch(tn('player.files.show-all', hidden), all, (on) => {
      all = on;
      renderList();
    });
    showAll.dataset.focusId = 'files-all';
    controls.append(showAll);
  }

  const list = h('div', { class: 'file-list' });
  const element = h('div', { class: 'file-picker' }, controls, list, h('p', { class: 'file-note' }, t('player.files.note')));

  function fileRow(file: TorrentFile): HTMLElement {
    const isCurrent = file.index === current;
    const detail = [fileEpisodeLabel(file), folderOf(file.name), file.extra ? t('player.files.extra') : '', formatBytes(file.size)].filter(Boolean).join(' · ');
    const row = h(
      'button',
      { class: `file-row${isCurrent ? ' current' : ''}`, 'aria-current': isCurrent ? 'true' : 'false', title: file.name, 'data-focus-id': `file-${file.index}` },
      h('span', { class: 'file-row-text' }, h('span', { class: 'file-row-name' }, baseName(file.name)), h('span', { class: 'file-row-detail' }, detail)),
      isCurrent ? h('span', { class: 'file-badge' }, playing !== undefined ? t('player.files.playing') : options.chosenLabel) : '',
    );
    row.addEventListener('click', () => options.onPick(file));
    return row;
  }

  function renderList(): void {
    const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    const shown = arrangeFiles(files, { query, sort, all });
    list.replaceChildren(...(shown.length ? shown.map(fileRow) : [h('p', { class: 'file-empty' }, t('player.files.none'))]));
    if (focused) list.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  renderList();
  return element;
}

/** Where focus starts in a freshly opened picker: the file playing or chosen, else the first. */
export function focusFilePicker(picker: HTMLElement): void {
  (picker.querySelector<HTMLElement>('.file-row[aria-current="true"]') ?? picker.querySelector<HTMLElement>('.file-row') ?? picker.querySelector<HTMLElement>('button'))?.focus({ preventScroll: false });
}
