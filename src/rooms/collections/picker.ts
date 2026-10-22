/** "Add to collection…": a side drawer with a switch per collection of picked titles, and a field to start a new one with this title. */
import type { Title } from '../../catalog/titles';
import { openDrawer } from '../../components/drawer';
import { createSwitch } from '../../components/switch';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { addToCollection, createCollection, customCollections, isDynamic, loadCollections, MAX_NAME, removeFromCollection } from '../../library/collections';
import '../lists/lists.css';
import { errorText } from '../../components/state-message';

const failed = (err: unknown) => toast(errorText(err));

export function openCollectionPicker(title: Title): void {
  const rows = h('div', { class: 'list-picker-rows' });
  const name = createTextField({ label: t('collections.picker.new-name'), placeholder: t('collections.picker.new'), onSubmit: () => void create() });
  name.maxLength = MAX_NAME;
  const createButton = h('button', { class: 'button' }, t('collections.picker.create'));
  createButton.addEventListener('click', () => void create());
  const done = h('button', { class: 'button primary' }, t('titles.common.done'));

  /** A second press (or Enter) while creating would make it twice. */
  let creating = false;
  async function create(): Promise<void> {
    const value = name.value.trim();
    if (!value || creating) return;
    creating = true;
    try {
      const id = await createCollection({ name: value, sources: [] });
      await addToCollection(id, title);
      toast(t('collections.picker.added', { title: title.name, collection: value }));
      name.value = '';
      draw();
    } catch (err) {
      failed(err);
    } finally {
      creating = false;
    }
  }

  function draw(): void {
    // Only collections of picked titles: the others fill themselves from their sources.
    const fixed = customCollections().filter((c) => !isDynamic(c));
    rows.replaceChildren(
      ...(fixed.length
        ? fixed.map((c) => {
            const has = c.titles.some((other) => other.id === title.id);
            const toggle = createSwitch(c.group ? `${c.name} · ${c.group}` : c.name, has, (on) =>
              void (on ? addToCollection(c.id, title) : removeFromCollection(c.id, title.id)).catch((err: unknown) => {
                // Not saved: the switch goes back to what the collection holds.
                toggle.setAttribute('aria-checked', String(!on));
                failed(err);
              }),
            );
            toggle.classList.add('wide');
            return toggle;
          })
        : [h('p', { class: 'muted' }, t('collections.picker.none'))]),
    );
  }

  const content = h(
    'div',
    { class: 'list-picker' },
    h('h2', { class: 'list-picker-title' }, t('collections.picker.title')),
    h('p', { class: 'muted' }, title.name),
    rows,
    h('div', { class: 'list-picker-new' }, name, createButton),
    h('div', { class: 'list-picker-actions' }, done),
  );
  draw();
  const close = openDrawer(content, t('collections.picker.drawer', { name: title.name }));
  done.addEventListener('click', close);
  void loadCollections().then(() => {
    draw();
    // Focus stays put unless it was still on Done (nothing to toggle before loading).
    if (document.activeElement === done) rows.querySelector<HTMLElement>('button')?.focus();
  });
  requestAnimationFrame(() => (rows.querySelector<HTMLElement>('button') ?? done).focus());
}
