/**
 * Reordering the Live TV favourites: Move up / Move down buttons on each row
 * (keyboard, remote and controller), and dragging a row by its grip with the
 * mouse. The order itself is kept in Rust (see `setTvFavouriteOrder`).
 */
import { icon } from '../../components/icons';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { dropIndex } from '../../live/surf';

/** The grip and the two buttons for the favourite at `index` of `count`. */
export function reorderControls(name: string, focusId: string, index: number, count: number, onMove: (to: number) => void): { grip: HTMLElement; buttons: HTMLElement } {
  const button = (direction: 'up' | 'down', label: string, disabled: boolean) => {
    const b = h('button', { class: `live-move ${direction}`, title: label, 'aria-label': label, 'data-focus-id': `${focusId}:${direction}`, disabled }, icon('chevronDown'));
    b.addEventListener('click', () => onMove(direction === 'up' ? index - 1 : index + 1));
    return b;
  };
  return {
    // For the mouse only: the buttons do the same from the keyboard.
    grip: h('span', { class: 'live-grip', title: t('livetv.favourites.drag'), 'aria-hidden': 'true', 'data-nav-skip': '' }, icon('list')),
    buttons: h(
      'span',
      { class: 'live-moves' },
      button('up', t('livetv.favourites.move-up', { name }), index === 0),
      button('down', t('livetv.favourites.move-down', { name }), index === count - 1),
    ),
  };
}

/** Lets rows of `list` (`.live-item`) be dragged by their `.live-grip`; `onDrop(from, to)` when one is let go elsewhere. */
export function enableDrag(list: HTMLElement, onDrop: (from: number, to: number) => void): void {
  list.addEventListener('pointerdown', (down) => {
    const grip = down.target instanceof Element ? down.target.closest<HTMLElement>('.live-grip') : null;
    const item = grip?.closest<HTMLElement>('.live-item');
    if (!grip || !item || down.button !== 0) return;
    const items = [...list.querySelectorAll<HTMLElement>('.live-item')];
    const from = items.indexOf(item);
    const middles = items.map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    // The page may scroll while dragging; positions are measured against where it was.
    const scroller = list.closest('.outlet');
    const scrolledAt = scroller?.scrollTop ?? 0;
    let to = from;
    down.preventDefault();
    grip.setPointerCapture(down.pointerId);
    item.classList.add('dragging');
    const others = items.filter((el) => el !== item);
    const mark = () => {
      for (const el of others) el.classList.remove('drop-before', 'drop-after');
      if (to === from) return;
      if (to < others.length) others[to]!.classList.add('drop-before');
      else others.at(-1)?.classList.add('drop-after');
    };
    const move = (event: PointerEvent) => {
      to = dropIndex(middles, from, event.clientY + ((scroller?.scrollTop ?? 0) - scrolledAt));
      mark();
    };
    const listening = new AbortController();
    const end = (drop: boolean) => {
      listening.abort();
      item.classList.remove('dragging');
      const moved = drop ? to : from;
      to = from;
      mark();
      if (moved !== from) onDrop(from, moved);
    };
    grip.addEventListener('pointermove', move, { signal: listening.signal });
    grip.addEventListener('pointerup', () => end(true), { signal: listening.signal });
    grip.addEventListener('pointercancel', () => end(false), { signal: listening.signal });
  });
}
