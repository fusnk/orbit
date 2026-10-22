/**
 * Theme Studio → Layout: where the nav lives (a small picture of each), which
 * side for the sidebar and the rail, where the top bars' nav sits, where the
 * floating pill sits, and the nav's items: their order (drag, or the up and
 * down buttons from the keyboard), names, and which are hidden.
 */
import { icon } from '../../components/icons';
import { createTextField } from '../../components/text-field';
import { isRtl, t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { navPages } from '../../app/nav';
import type { Look } from '../../theme/engine';
import { arrangeItems, moveItem, NAV_LABEL_MAX, NAV_POSITIONS, type NavItemPref, type NavLayout, type NavPosition } from '../../theme/layout';
import { field, section, segments } from './controls';
import { pillPlacePicker } from './pill-place';
import type { Change } from './look-tab';

const POSITION_TEXT: Record<NavPosition, [MessageKey, MessageKey]> = {
  top: ['studio.layout.top', 'studio.layout.top-hint'],
  sidebar: ['studio.layout.sidebar', 'studio.layout.sidebar-hint'],
  rail: ['studio.layout.rail', 'studio.layout.rail-hint'],
  dock: ['studio.layout.dock', 'studio.layout.dock-hint'],
  cinematic: ['studio.layout.cinematic', 'studio.layout.cinematic-hint'],
  arc: ['orbitlook.nav', 'orbitlook.nav-hint'],
};

/** A tiny window: its nav where this layout puts it, and a few posters. */
function schematic(position: NavPosition, layout: NavLayout): HTMLElement {
  return h(
    'span',
    { class: `layout-mini layout-mini-${position}`, 'data-side': layout.side, 'data-align': layout.align, 'data-place': layout.place, 'aria-hidden': 'true' },
    h('span', { class: 'layout-mini-nav' }, h('span', {}), h('span', {}), h('span', {})),
    h('span', { class: 'layout-mini-page' }, h('span', { class: 'layout-mini-hero' }), h('span', { class: 'layout-mini-row' }, h('span', {}), h('span', {}), h('span', {}), h('span', {}))),
  );
}

export function layoutTab(look: Look, change: Change): HTMLElement {
  const layout = look.layout;
  const setLayout = (patch: Partial<NavLayout>, options?: { group?: string; redraw?: boolean }) => change({ ...look, layout: { ...layout, ...patch } }, options);
  const pages = navPages();
  const items = arrangeItems(layout.items, pages.map((p) => p.id));
  const defaultLabel = (id: string) => pages.find((p) => p.id === id)?.label ?? id;
  const setItems = (next: NavItemPref[], options?: { group?: string; redraw?: boolean }) => setLayout({ items: next }, options);

  const cards = h(
    'div',
    { class: 'studio-layouts', role: 'group', 'aria-label': t('studio.layout.position') },
    ...NAV_POSITIONS.map((position) => {
      const [name, hint] = POSITION_TEXT[position];
      const card = h(
        'button',
        { class: 'studio-layout-card', 'aria-pressed': String(layout.position === position), 'data-studio-key': `layout:${position}` },
        schematic(position, layout),
        h('span', { class: 'studio-layout-name' }, t(name)),
        h('span', { class: 'studio-layout-hint' }, t(hint)),
      );
      card.addEventListener('click', () => {
        if (layout.position !== position) setLayout({ position });
      });
      return card;
    }),
  );

  // "Start" is the left in left-to-right languages and the right in Arabic, where the buttons' order flips too.
  const [startLabel, endLabel] = isRtl() ? [t('studio.layout.right'), t('studio.layout.left')] : [t('studio.layout.left'), t('studio.layout.right')];
  const sides = segments(
    t('studio.layout.side'),
    [
      ['start', startLabel],
      ['end', endLabel],
    ] as const,
    layout.side,
    (side) => setLayout({ side }),
    'layout:side',
  );
  // The top bars' nav: in the middle, or just after the wordmark (the same start side as above).
  const aligns = segments(
    t('studio.layout.align'),
    [
      ['center', t('studio.layout.centre')],
      ['start', startLabel],
    ] as const,
    layout.align,
    (align) => setLayout({ align }),
    'layout:align',
  );

  // ── Items
  let dragged: number | null = null;
  const list = h('ol', { class: 'studio-nav-items' });
  items.forEach((item, index) => {
    const name = item.label ?? defaultLabel(item.id);
    const grip = h('span', { class: 'studio-grip', title: t('studio.layout.drag', { name }), 'aria-hidden': 'true' }, icon('grip'));
    const rename = createTextField({ label: t('studio.layout.rename', { name: defaultLabel(item.id) }), placeholder: defaultLabel(item.id), onSubmit: () => rename.blur() });
    rename.value = item.label ?? '';
    rename.maxLength = NAV_LABEL_MAX;
    rename.dataset.studioKey = `item:${item.id}:name`;
    rename.addEventListener('input', () => {
      items[index] = { ...item, label: rename.value.trim() || null };
      setItems([...items], { group: `item:${item.id}:name`, redraw: false });
    });
    const move = (by: number, glyph: 'chevronUp' | 'chevronDown', label: MessageKey) => {
      const button = h('button', { class: 'icon-button', 'aria-label': t(label, { name }), title: t(label, { name }), disabled: index + by < 0 || index + by >= items.length, 'data-studio-key': `item:${item.id}:${glyph}` }, icon(glyph));
      button.addEventListener('click', () => {
        setItems(moveItem(items, index, by));
        // Moved to an end of the list, this button is now disabled and can't keep the focus: the other way takes it.
        const to = index + by;
        if (to === 0 || to === items.length - 1) document.querySelector<HTMLElement>(`.studio [data-studio-key="item:${item.id}:${by < 0 ? 'chevronDown' : 'chevronUp'}"]`)?.focus({ preventScroll: true });
      });
      return button;
    };
    const hide = h(
      'button',
      { class: 'icon-button studio-hide', 'aria-pressed': String(item.hidden), 'aria-label': t(item.hidden ? 'studio.layout.show' : 'studio.layout.hide', { name }), title: t(item.hidden ? 'studio.layout.show' : 'studio.layout.hide', { name }), 'data-studio-key': `item:${item.id}:hide` },
      icon(item.hidden ? 'eyeOff' : 'eye'),
    );
    hide.addEventListener('click', () => {
      items[index] = { ...item, hidden: !item.hidden };
      setItems([...items]);
    });
    const row = h('li', { class: 'studio-nav-item', 'data-hidden': String(item.hidden) }, grip, rename, move(-1, 'chevronUp', 'studio.layout.up'), move(1, 'chevronDown', 'studio.layout.down'), hide);
    // Only the grip starts a drag, so selecting text in the name field still works.
    grip.addEventListener('pointerdown', () => (row.draggable = true));
    row.addEventListener('dragstart', (event) => {
      dragged = index;
      event.dataTransfer?.setData('text/plain', item.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.classList.remove('dragging');
      dragged = null;
    });
    row.addEventListener('dragover', (event) => {
      if (dragged === null) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      if (dragged === null || dragged === index) return;
      setItems(moveItem(items, dragged, index - dragged));
    });
    list.append(row);
  });

  const reset = h('button', { class: 'button', 'data-studio-key': 'items:reset' }, t('studio.layout.reset'));
  reset.addEventListener('click', () => setItems([]));

  return h(
    'div',
    { class: 'studio-tab' },
    section(
      t('studio.layout.position'),
      cards,
      layout.position === 'sidebar' || layout.position === 'rail' ? field(t('studio.layout.side'), null, sides) : '',
      layout.position === 'top' || layout.position === 'cinematic' ? field(t('studio.layout.align'), t('studio.layout.align-hint'), aligns) : '',
      layout.position === 'dock' ? field(t('studio.layout.place'), t('studio.layout.place-hint'), pillPlacePicker(layout.place, (place) => setLayout({ place }))) : '',
    ),
    section(t('studio.layout.items'), h('p', { class: 'studio-field-hint' }, t('studio.layout.items-hint')), list, h('div', { class: 'studio-inline' }, reset)),
  );
}
