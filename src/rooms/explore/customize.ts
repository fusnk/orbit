/**
 * Customize Discover: move sections up or down and hide them (like Settings
 * → Home rows), add public Letterboxd lists by address and remove them, and
 * bring back titles marked Not interested. Changes save at once, per profile,
 * and Discover follows them.
 */
import { EXPLORE_CHANGED, exploreLayout, listSectionId, saveExploreLayout, type ExploreLayout } from '../../catalog/explore';
import { letterboxdListInfo, parseListUrl } from '../../catalog/letterboxd';
import { MAX_LISTS, taste, updateTaste, withList, withoutList } from '../../catalog/taste';
import { createSwitch } from '../../components/switch';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { arrange } from '../home/rows';
import { row as settingRow } from '../settings/playback';
import { clearHidden } from './state';
import '../settings/settings.css';
import '../home/editor.css';
import { errorText } from '../../components/state-message';

export interface CustomizeEntry {
  id: string;
  label: string;
  /** Stays first (the banner); it can be hidden but not moved. */
  pinned?: boolean;
}

function failed(err: unknown): void {
  console.error('Could not save Discover’s layout', err);
  toast(t('settings.common.save-failed'));
}

/** `entries()`: Discover's sections in their default order, added lists included. */
export function createCustomizePage(entries: () => Promise<CustomizeEntry[]>): HTMLElement {
  const list = h('ol', { class: 'home-rows-list', 'aria-label': t('explore.customize.sections') });
  const lists = h('ul', { class: 'home-rows-list', 'aria-label': t('explore.customize.lists') });
  const message = h('p', { class: 'muted', role: 'status' });
  const hiddenSlot = h('div', {});
  // Focused while the sections load; the first section takes focus once they're in (see `draw`).
  const reset = h('button', { class: 'button', 'data-autofocus': true }, t('explore.customize.reset'));
  let layout: ExploreLayout = { order: [], hidden: [] };
  let pendingFocus: string | null = null;
  let drawn = false;

  const field = createTextField({ label: t('explore.customize.list-field'), placeholder: t('explore.customize.list-placeholder'), onSubmit: () => void addList() });
  field.classList.add('explore-list-field');
  const add = h('button', { class: 'button primary' }, t('explore.customize.add'));
  add.addEventListener('click', () => void addList());

  const page = h(
    'div',
    { class: 'explore-customize' },
    h('h1', { class: 'page-title' }, t('explore.customize.title')),
    h('p', { class: 'muted settings-intro' }, t('explore.customize.intro')),
    h('div', { class: 'addons-heading' }, h('h3', { class: 'settings-subheading' }, t('explore.customize.sections')), reset),
    list,
    h('h3', { class: 'settings-subheading' }, t('explore.customize.lists')),
    lists,
    settingRow(t('explore.customize.list-field'), t('explore.customize.list-hint'), h('div', { class: 'explore-list-add' }, field, add)),
    message,
    hiddenSlot,
  );

  async function save(next: ExploreLayout, focus?: string): Promise<void> {
    layout = next;
    pendingFocus = focus ?? null;
    await saveExploreLayout(next).catch(failed);
    await draw();
  }

  reset.addEventListener('click', () => void save({ order: [], hidden: [] }));

  async function draw(): Promise<void> {
    const all = await entries();
    const active = document.activeElement instanceof HTMLElement && page.contains(document.activeElement) ? (document.activeElement.dataset.focusId ?? null) : null;
    const pinned = all.filter((e) => e.pinned);
    const movable = all.filter((e) => !e.pinned);
    const order = arrange(
      movable.map((e) => e.id),
      layout.order,
    );
    const byId = new Map(all.map((e) => [e.id, e]));
    const move = (index: number, by: number) => {
      const next = [...order];
      const [id] = next.splice(index, 1);
      next.splice(index + by, 0, id!);
      void save({ ...layout, order: next }, `${id}:${by < 0 ? 'up' : 'down'}`);
    };
    const item = (entry: CustomizeEntry, i: number | null) => {
      const hidden = layout.hidden.includes(entry.id);
      const controls = h('div', { class: 'home-row-controls' });
      if (i === null) controls.append(h('span', { class: 'muted' }, t('explore.customize.pinned')));
      else {
        const up = h('button', { class: 'button', 'data-focus-id': `${entry.id}:up`, disabled: i === 0, 'aria-label': t('settings.library.move-up', { name: entry.label }) }, t('settings.library.up'));
        up.addEventListener('click', () => move(i, -1));
        const down = h('button', { class: 'button', 'data-focus-id': `${entry.id}:down`, disabled: i === order.length - 1, 'aria-label': t('settings.library.move-down', { name: entry.label }) }, t('settings.library.down'));
        down.addEventListener('click', () => move(i, 1));
        controls.append(up, down);
      }
      const show = createSwitch('', !hidden, (on) => void save({ ...layout, hidden: on ? layout.hidden.filter((id) => id !== entry.id) : [...layout.hidden, entry.id] }, `${entry.id}:show`));
      show.setAttribute('aria-label', t('settings.library.show-row', { name: entry.label }));
      show.dataset.focusId = `${entry.id}:show`;
      controls.append(show);
      return h('li', { class: hidden ? 'home-row-item off' : 'home-row-item' }, h('span', { class: 'home-row-name' }, entry.label), controls);
    };
    list.replaceChildren(...pinned.map((e) => item(e, null)), ...order.map((id, i) => item(byId.get(id)!, i)));

    const saved = await taste();
    lists.replaceChildren(
      ...(saved.lists.length
        ? saved.lists.map((l) => {
            const remove = h('button', { class: 'button', 'data-focus-id': `list:${l.owner}/${l.slug}`, 'aria-label': t('explore.customize.remove-list', { name: l.name }) }, t('explore.customize.remove'));
            remove.addEventListener('click', () => {
              void updateTaste((current) => withoutList(current, l))
                .then(async () => {
                  const id = listSectionId(l);
                  await save({ order: layout.order.filter((other) => other !== id), hidden: layout.hidden.filter((other) => other !== id) }, 'list-field');
                })
                .catch(failed);
            });
            return h('li', { class: 'home-row-item' }, h('span', { class: 'home-row-name' }, l.name), h('div', { class: 'home-row-controls' }, h('span', { class: 'muted' }, `@${l.owner}`), remove));
          })
        : [h('li', { class: 'muted' }, t('explore.customize.no-lists'))]),
    );

    if (saved.hidden.length) {
      const clear = h('button', { class: 'button', 'data-focus-id': 'clear-hidden' }, t('explore.customize.show-again'));
      clear.addEventListener('click', () => {
        void updateTaste((current) => ({ ...current, hidden: [] }))
          .then(() => {
            clearHidden();
            toast(t('explore.customize.shown-again'));
            document.dispatchEvent(new Event(EXPLORE_CHANGED));
            return draw();
          })
          .catch(failed);
      });
      hiddenSlot.replaceChildren(settingRow(t('explore.customize.not-interested'), tn('explore.customize.not-interested-count', saved.hidden.length), clear));
    } else hiddenSlot.replaceChildren();

    const focus = pendingFocus ?? active;
    pendingFocus = null;
    const first = !drawn;
    drawn = true;
    // Just opened, focus still on Reset: the first section takes it.
    if (first && !focus && document.activeElement === reset) list.querySelector<HTMLElement>('[data-focus-id]:not(:disabled)')?.focus({ preventScroll: true });
    else if (focus === 'list-field') field.focus();
    else if (focus) (page.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focus)}"]:not(:disabled)`) ?? page.querySelector<HTMLElement>(`[data-focus-id^="${CSS.escape(focus.split(':')[0]!)}:"]:not(:disabled)`))?.focus();
  }

  async function addList(): Promise<void> {
    const ref = parseListUrl(field.value);
    if (!ref) return void (message.textContent = t('explore.customize.bad-url'));
    const saved = await taste();
    if (saved.lists.some((l) => l.owner === ref.owner && l.slug === ref.slug)) return void (message.textContent = t('explore.customize.already'));
    if (saved.lists.length >= MAX_LISTS) return void (message.textContent = t('explore.customize.too-many', { count: MAX_LISTS }));
    add.disabled = true;
    message.textContent = t('explore.customize.checking');
    try {
      const info = await letterboxdListInfo(field.value);
      await updateTaste((current) => withList(current, info));
      field.value = '';
      message.textContent = t('explore.customize.added', { name: info.name });
      document.dispatchEvent(new Event(EXPLORE_CHANGED));
      await draw();
    } catch (err) {
      message.textContent = errorText(err);
    } finally {
      add.disabled = false;
    }
  }

  void exploreLayout()
    .then((saved) => {
      layout = saved;
      return draw();
    })
    .catch(failed);
  return page;
}
