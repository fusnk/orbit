/**
 * Custom lists UI: the "Add to list…" drawer, a list's own page (its
 * description, a sort, rename, describe, export and delete), the tiles that
 * open it and importing one from a file (My Library → My Lists).
 */
import { markActivity } from '../../app/activity';
import { VIEW_DISCARDED, type RoomContext } from '../../app/router';
import type { Title } from '../../catalog/titles';
import { artImage } from '../../components/cards';
import { openDrawer } from '../../components/drawer';
import { createSwitch } from '../../components/switch';
import { beginEditing, createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { locale, t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { freeListName, LIST_SORTS, listFile, ListFileError, MAX_LIST_DESCRIPTION, MAX_LIST_FILE_BYTES, MAX_LIST_NAME, parseListFile, sortListTitles, type ListSort } from '../../library/list-file';
import { addToList, createList, customLists, deleteList, describeList, findList, importList, onListsChange, removeFromList, renameList, saveListExport, type CustomList } from '../../library/lists';
import { choices } from '../settings/playback';
import { titleHandlers } from '../detail/open';
import { titleCard } from '../title-card';
import './lists.css';
import { codedText, errorText } from '../../components/state-message';

const failed = (err: unknown) => toast(errorText(err));

/** A title that couldn't be added to or taken out of a list: Rust's own words (a full list), else which change didn't happen. */
const changeFailed = (err: unknown, list: CustomList, title: Title, added: boolean) =>
  toast(codedText(err) ?? t(added ? 'titles.lists.update-failed-add' : 'titles.lists.update-failed-remove', { list: list.name, title: title.name }));

/** A side drawer: one switch per list for `title`, and a field to make a new list with it. */
export function openListPicker(title: Title): void {
  const rows = h('div', { class: 'list-picker-rows' });
  const name = createTextField({ label: t('titles.lists.new-name'), placeholder: t('titles.lists.new'), onSubmit: () => void create() });
  name.maxLength = 40;
  const createButton = h('button', { class: 'button' }, t('titles.lists.create'));
  createButton.addEventListener('click', () => void create());
  const done = h('button', { class: 'button primary' }, t('titles.common.done'));

  /** A second press (or Enter) while creating would make it twice. */
  let creating = false;
  async function create(): Promise<void> {
    if (!name.value.trim() || creating) return;
    creating = true;
    try {
      const id = await createList(name.value);
      await addToList(id, title);
      toast(t('titles.lists.added', { title: title.name, list: name.value.trim() }));
      name.value = '';
      draw();
    } catch (err) {
      failed(err);
    } finally {
      creating = false;
    }
  }

  function draw(): void {
    const lists = customLists();
    rows.replaceChildren(
      ...(lists.length
        ? lists.map((list) => {
            const has = list.titles.some((t) => t.id === title.id);
            const toggle = createSwitch(list.name, has, (on) =>
              void (on ? addToList(list.id, title) : removeFromList(list.id, title.id)).catch((err: unknown) => {
                // Not saved: the switch goes back to what the list holds.
                toggle.setAttribute('aria-checked', String(!on));
                changeFailed(err, list, title, on);
              }),
            );
            toggle.classList.add('wide');
            return toggle;
          })
        : [h('p', { class: 'muted' }, t('titles.lists.none'))]),
    );
  }

  draw();
  const content = h(
    'div',
    { class: 'list-picker' },
    h('h2', { class: 'list-picker-title' }, t('titles.lists.add-title')),
    h('p', { class: 'muted' }, title.name),
    rows,
    h('div', { class: 'list-picker-new' }, name, createButton),
    h('div', { class: 'list-picker-actions' }, done),
  );
  const close = openDrawer(content, t('titles.lists.add-drawer', { name: title.name }));
  done.addEventListener('click', close);
  requestAnimationFrame(() => (rows.querySelector<HTMLElement>('button') ?? done).focus());
}

/** A tile for a list: up to four posters and its name and size. */
export function listTile(list: CustomList, onOpen: () => void): HTMLElement {
  const posters = list.titles.filter((t) => t.poster).slice(0, 4);
  const tile = h(
    'button',
    // Library redraws its tiles while a list is open: Back finds this one again by it.
    { class: 'list-tile', 'data-focus-id': `list:${list.id}` },
    h('span', { class: 'list-collage' }, ...posters.map((t) => artImage(t.poster!, 'art'))),
    h('span', { class: 'list-tile-name' }, list.name),
    h('span', { class: 'muted' }, tn('titles.lists.count', list.titles.length)),
  );
  tile.addEventListener('click', onOpen);
  return tile;
}

/** Each list's sort while Orbit runs (a list opens as it was last sorted). */
const sorts = new Map<string, ListSort>();

const SORT_NAMES: Record<ListSort, Parameters<typeof t>[0]> = { added: 'movix.lists.sort-added', title: 'movix.lists.sort-title', year: 'movix.lists.sort-year', rating: 'movix.lists.sort-rating' };

/** A list's page: its description and titles (sorted as chosen), plus rename, describe, export and delete. */
export function createListPage(listId: string, ctx: RoomContext): HTMLElement {
  const { openDetail, withMenu } = titleHandlers(ctx);
  const heading = h('h1', { class: 'page-title' });
  const count = h('span', { class: 'count' });
  const about = h('p', { class: 'muted list-description' });
  const actions = h('div', { class: 'hero-actions' });
  const sort = choices<ListSort>(
    t('movix.lists.sort'),
    LIST_SORTS.map((s) => [s, t(SORT_NAMES[s])] as const),
    sorts.get(listId) ?? 'added',
    (value) => {
      sorts.set(listId, value);
      draw();
    },
  );
  const toolbar = h('div', { class: 'list-toolbar' }, h('span', { class: 'list-toolbar-label', 'aria-hidden': 'true' }, t('movix.lists.sort')), sort);
  const grid = h('div', { class: 'title-grid' });
  const page = h('div', { class: 'list-page' }, h('div', { class: 'list-page-header' }, h('div', {}, h('span', { class: 'eyebrow' }, t('titles.lists.eyebrow')), h('div', { class: 'list-page-title' }, heading, count), about), actions), toolbar, grid);
  // The list's name stays private.
  markActivity(page, t('titles.lists.activity'));
  /** Rename or the description is being edited: the actions are a field until it's done. */
  let renaming = false;

  function draw(): void {
    const list = findList(listId);
    if (!list) {
      // Deleted: there's nothing left to show.
      if (page.isConnected) ctx.back();
      return;
    }
    heading.textContent = list.name;
    count.textContent = tn('titles.lists.count', list.titles.length);
    about.textContent = list.description;
    about.hidden = !list.description;
    toolbar.hidden = list.titles.length < 2;
    if (!renaming) drawActions(list);
    // A card taken out (its menu's Remove) had focus: the one now in its place takes it.
    const cards = [...grid.children];
    const focused = cards.findIndex((card) => card.contains(document.activeElement));
    grid.replaceChildren(
      ...(list.titles.length
        ? sortListTitles(list.titles, sorts.get(listId) ?? 'added', locale()).map((title) => titleCard(title, () => openDetail(title), {}, (card) => withMenu(card, title, [{ label: t('titles.lists.remove'), action: () => void removeFromList(listId, title.id).catch((err: unknown) => changeFailed(err, list, title, false)) }])))
        : [h('p', { class: 'muted' }, t('titles.lists.empty'))]),
    );
    if (focused >= 0) {
      const id = (cards[focused] as HTMLElement).dataset.focusId;
      const again = (id && grid.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]`)) || grid.querySelector<HTMLElement>(`.card:nth-child(${Math.min(focused, list.titles.length - 1) + 1})`);
      (again ?? actions.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    }
  }

  /** Back from renaming or describing: the first action takes focus again (the field or Cancel that had it is gone). */
  function endRename(): void {
    renaming = false;
    draw();
    actions.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  /** A field in place of the actions (Rename, Description); Enter saves, Cancel goes back. */
  function editField(label: string, placeholder: string, value: string, maxLength: number, save: (value: string) => Promise<unknown>): void {
    renaming = true;
    const field = createTextField({
      label,
      placeholder,
      onSubmit: (text) => {
        void save(text).then(endRename).catch(failed);
      },
    });
    field.value = value;
    field.maxLength = maxLength;
    const cancel = h('button', { class: 'button glass' }, t('titles.common.cancel'));
    cancel.addEventListener('click', endRename);
    actions.replaceChildren(field, cancel);
    // Pressing Rename asked to type: editing starts (with its look, and Escape then stops it).
    beginEditing(field);
  }

  function drawActions(list: CustomList): void {
    const describe = h('button', { class: 'button glass' }, t(list.description ? 'movix.lists.edit-description' : 'movix.lists.add-description'));
    describe.addEventListener('click', () => editField(t('movix.lists.description'), t('movix.lists.description'), list.description, MAX_LIST_DESCRIPTION, (text) => describeList(listId, text)));
    const exportButton = h('button', { class: 'button glass' }, t('movix.lists.export'));
    exportButton.addEventListener('click', () => {
      void saveListExport(listFile(list))
        .then((path) => path && toast(t('settings.common.saved-to', { path })))
        .catch(failed);
    });
    const rename = h('button', { class: 'button glass' }, t('titles.lists.rename'));
    rename.addEventListener('click', () => editField(t('titles.lists.name'), list.name, list.name, MAX_LIST_NAME, (value) => renameList(listId, value)));
    // Two-step delete: the first press arms it, leaving the button disarms it.
    const remove = h('button', { class: 'button danger' }, t('titles.lists.delete'));
    remove.addEventListener('click', () => {
      if (!remove.dataset.armed) {
        remove.dataset.armed = 'true';
        remove.textContent = t('titles.lists.delete-named', { name: list.name });
        return;
      }
      void deleteList(listId).catch(failed);
    });
    remove.addEventListener('blur', () => {
      delete remove.dataset.armed;
      remove.textContent = t('titles.lists.delete');
    });
    actions.replaceChildren(rename, describe, exportButton, remove);
  }

  // The page is dropped when left, and stops listening then.
  const stop = onListsChange(draw);
  page.addEventListener(VIEW_DISCARDED, () => void stop(), { once: true });
  draw();
  return page;
}

const FILE_PROBLEMS = { 'too-large': 'movix.lists.file-too-large', 'not-json': 'movix.lists.file-not-list', 'not-a-list': 'movix.lists.file-not-list', empty: 'movix.lists.file-empty' } as const;

/**
 * "Import a list" (My Library → My Lists): reads a list file the person
 * chooses (untrusted, see library/list-file.ts), adds it as a new list (a
 * name already in use gets a number), and opens it.
 */
export function importListButton(ctx: RoomContext): HTMLElement {
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, tabindex: '-1' });
  const button = h('button', { class: 'button glass', 'data-focus-id': 'lists-import' }, t('movix.lists.import'));
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // Checked before reading, so a huge file is never loaded.
    if (file.size > MAX_LIST_FILE_BYTES) return toast(t(FILE_PROBLEMS['too-large']));
    void file
      .text()
      .then(async (text) => {
        const parsed = parseListFile(text);
        const list = { ...parsed, name: freeListName(parsed.name, customLists().map((l) => l.name)) };
        const id = await importList(list);
        toast(tn('movix.lists.imported', list.items.length, { name: list.name }) + (parsed.skipped ? ` ${tn('movix.lists.skipped', parsed.skipped)}` : ''));
        ctx.open(createListPage(id, ctx));
      })
      .catch((err: unknown) => toast(err instanceof ListFileError ? t(FILE_PROBLEMS[err.problem]) : errorText(err)));
  });
  return h('span', { class: 'list-import' }, button, input);
}
