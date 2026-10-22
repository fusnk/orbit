/**
 * Import collections… from a collections file in Nuvio's format (Nuvio's own
 * export, or one a community builder made): paste it or choose the file,
 * then review every folder — its cover and how each of its sources maps here
 * (ready, needs an addon, needs a TMDB key, not supported) — and pick which
 * to add. A file is untrusted (see library/nuvio-collections.ts). Addons it
 * names are never installed by themselves: the person can paste one's link
 * and install it through the usual preview and confirm.
 */
import { markActivity } from '../../app/activity';
import type { RoomContext } from '../../app/router';
import { artImage } from '../../components/cards';
import { createTextField } from '../../components/text-field';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { sourceStatus, type SourceContext, type SourceStatus } from '../../library/collection-sources';
import { customCollections, importCollections, loadCollections, MAX_COLLECTIONS } from '../../library/collections';
import { CollectionsFileError, MAX_FILE_CHARS, parseCollectionsFile, type ImportedFolder, type ParsedFile } from '../../library/nuvio-collections';
import { createInstallPanel } from '../addons/install';
import { sourceContext, sourceName, statusText, tmdbHint } from './parts';
import './collections.css';
import { errorText } from '../../components/state-message';

/** Whether a folder brings anything: titles, or a source that works now or after setup. */
const KEPT: SourceStatus['state'][] = ['ok', 'needs-addon', 'needs-tmdb', 'missing-catalog'];
export const importable = (folder: ImportedFolder, ctx: SourceContext) => folder.titles.length > 0 || folder.sources.some((s) => KEPT.includes(sourceStatus(s, ctx).state));

/** The addons a file's folders need that aren't installed, by manifest id, with the name the file gave. */
export function missingAddons(folders: readonly ImportedFolder[], ctx: SourceContext): Map<string, string | undefined> {
  const missing = new Map<string, string | undefined>();
  for (const folder of folders) {
    for (const source of folder.sources) {
      const status = sourceStatus(source, ctx);
      if (status.state === 'needs-addon') missing.set(status.addon, missing.get(status.addon) ?? status.name);
    }
  }
  return missing;
}

export function createImportPage(ctx: RoomContext): HTMLElement {
  const message = h('p', { class: 'status', role: 'status' });
  const results = h('div', { class: 'collection-import-results' });
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  let parsed: ParsedFile | null = null;
  let context: SourceContext = { addons: [], tmdb: false };
  const picked = new Set<string>();

  const field = createTextField({ label: t('collections.import.paste'), placeholder: '[{ "title": …, "folders": [ … ] }]', onSubmit: (value) => void read(value) });
  const readButton = h('button', { class: 'button primary' }, t('collections.import.read'));
  readButton.addEventListener('click', () => void read(field.value));
  const choose = h('button', { class: 'button' }, t('collections.import.choose'));
  choose.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // Checked before reading, so a huge file is never loaded.
    if (file.size > MAX_FILE_CHARS * 2) showProblem(new CollectionsFileError('too-large'));
    else void file.text().then(read, () => showProblem(new CollectionsFileError('not-json')));
  });

  // Installing an addon the file needs by its link: the usual preview and confirm.
  const install = createInstallPanel(async (addon) => {
    message.classList.remove('error');
    message.textContent = t('integrations.addons.installed-done', { name: addon.manifest?.name ?? addon.displayHost });
    context = await sourceContext();
    drawResults();
  });

  function showProblem(err: CollectionsFileError): void {
    parsed = null;
    results.replaceChildren();
    message.classList.add('error');
    message.textContent = t(`collections.import.${err.problem}`);
  }

  async function read(text: string): Promise<void> {
    if (!text.trim()) return;
    try {
      parsed = parseCollectionsFile(text.trim());
    } catch (err) {
      return showProblem(err instanceof CollectionsFileError ? err : new CollectionsFileError('not-json'));
    }
    message.classList.remove('error');
    message.textContent = parsed.skipped ? tn('collections.import.skipped', parsed.skipped) : '';
    [context] = await Promise.all([sourceContext(), loadCollections()]);
    picked.clear();
    for (const folder of parsed.folders) if (importable(folder, context)) picked.add(folder.key);
    drawResults();
    results.querySelector<HTMLElement>('button')?.focus();
  }

  const room = () => MAX_COLLECTIONS - customCollections().length;
  const importButton = h('button', { class: 'button primary' });
  importButton.addEventListener('click', () => void importPicked());

  function updateButton(): void {
    const count = picked.size;
    importButton.textContent = count ? tn('collections.import.import-count', count) : t('collections.import.import-none');
    importButton.disabled = count === 0 || count > room();
    if (count > room()) message.textContent = tn('collections.import.too-many', room());
  }

  function sourceLine(state: SourceStatus['state'], label: string, text: string): HTMLElement {
    const mark = state === 'ok' ? '✓' : state === 'unsupported' ? '✗' : '!';
    return h('li', { class: `collection-import-source ${state}` }, h('span', { class: 'collection-import-mark', 'aria-hidden': 'true' }, mark), h('span', {}, label), h('span', { class: 'muted' }, text));
  }

  function folderRow(folder: ImportedFolder): HTMLElement {
    const can = importable(folder, context);
    const pick = h('button', { class: 'button', 'aria-pressed': String(picked.has(folder.key)), disabled: !can, 'data-focus-id': `pick:${folder.key}`, 'aria-label': t('collections.import.pick-named', { name: folder.name }) }, t('collections.import.pick'));
    pick.addEventListener('click', () => {
      if (picked.has(folder.key)) picked.delete(folder.key);
      else picked.add(folder.key);
      pick.setAttribute('aria-pressed', String(picked.has(folder.key)));
      updateButton();
    });
    const art = folder.cover ?? folder.backdrop;
    const lines = [
      ...folder.sources.map((source) => {
        const status = sourceStatus(source, context);
        return sourceLine(status.state, sourceName(source, context), statusText(status));
      }),
      ...folder.dropped.map((d) => sourceLine('unsupported', d.label ?? d.provider, t('collections.status.provider', { provider: d.provider }))),
    ];
    return h(
      'li',
      { class: `collection-import-row${can ? '' : ' off'}` },
      h('span', { class: `collection-import-art ${folder.shape}`, 'aria-hidden': 'true' }, h('span', { class: 'collection-tile-fallback' }, folder.name), art ? artImage(art, 'art') : ''),
      h(
        'div',
        { class: 'collection-import-info' },
        h('strong', {}, folder.name),
        folder.group ? h('span', { class: 'muted' }, folder.group) : '',
        folder.titles.length ? h('span', { class: 'muted' }, tn('collections.page.title-count', folder.titles.length)) : '',
        lines.length ? h('ul', { class: 'collection-import-sources' }, ...lines) : '',
        can ? '' : h('p', { class: 'muted' }, t('collections.import.nothing')),
      ),
      h('div', { class: 'addon-actions' }, pick),
    );
  }

  /** "Needs <addon>": its name and id, to know which link to paste. */
  function missingRow(id: string, name: string | undefined): HTMLElement {
    return h('li', { class: 'addon-row' }, h('div', { class: 'addon-info' }, h('strong', {}, name ?? id), h('p', { class: 'muted' }, id)));
  }

  function drawResults(): void {
    if (!parsed) return;
    const missing = missingAddons(parsed.folders, context);
    // A control focused before the redraw (Select all, say) is focused again after it.
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement && results.contains(active) ? active.dataset.focusId : undefined;
    const all = h('button', { class: 'button', 'data-focus-id': 'select-all' }, t('collections.import.select-all'));
    all.addEventListener('click', () => {
      for (const folder of parsed!.folders) if (importable(folder, context)) picked.add(folder.key);
      drawResults();
    });
    const none = h('button', { class: 'button', 'data-focus-id': 'select-none' }, t('collections.import.select-none'));
    none.addEventListener('click', () => {
      picked.clear();
      drawResults();
    });
    const needsTmdb = parsed.folders.some((f) => f.sources.some((s) => sourceStatus(s, context).state === 'needs-tmdb'));
    results.replaceChildren(
      h('p', {}, tn('collections.import.found', parsed.folders.length)),
      needsTmdb ? tmdbHint(ctx, { always: true }) : '',
      missing.size
        ? h('section', { class: 'collection-import-missing' }, h('h2', { class: 'section-title' }, t('collections.import.missing-heading')), h('p', { class: 'muted' }, t('collections.import.missing-intro')), h('ul', { class: 'addon-list' }, ...[...missing].map(([id, name]) => missingRow(id, name))), install.element)
        : '',
      h('div', { class: 'actions' }, all, none, importButton),
      h('ul', { class: 'collection-import-list', 'aria-label': t('collections.import.title') }, ...parsed.folders.map(folderRow)),
    );
    updateButton();
    if (focusId) results.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
  }

  async function importPicked(): Promise<void> {
    if (!parsed) return;
    const chosen = parsed.folders.filter((f) => picked.has(f.key));
    importButton.disabled = true;
    try {
      const count = await importCollections(chosen);
      message.classList.remove('error');
      message.textContent = tn('collections.import.done', count);
      parsed = null;
      picked.clear();
      const show = h('button', { class: 'button primary' }, t('collections.import.show'));
      show.addEventListener('click', () => ctx.back());
      results.replaceChildren(show);
      show.focus();
    } catch (err) {
      message.classList.add('error');
      message.textContent = errorText(err);
      updateButton();
    }
  }

  const page = h(
    'div',
    { class: 'collection-editor collection-import' },
    h('span', { class: 'eyebrow' }, t('collections.overview.title')),
    h('h1', { class: 'page-title' }, t('collections.import.title')),
    h('p', { class: 'muted' }, t('collections.import.intro')),
    h('div', { class: 'install-row' }, field, readButton, choose),
    input,
    message,
    results,
  );
  markActivity(page, t('collections.activity'));
  return page;
}

