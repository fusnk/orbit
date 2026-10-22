/**
 * Arranging Live TV's groups: the editor (move, hide, lock; buttons for the
 * keyboard, remote and controller, a grip to drag with the mouse) and the
 * prompt a locked group shows until its PIN is typed. What's hidden or locked
 * is kept, and enforced, in Rust (src-tauri/src/iptv/groups.rs).
 */
import { icon } from '../../components/icons';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import type { TvGroup } from '../../live/iptv';
import { pinField } from '../profiles/picker';
import { reorderControls } from './favourites-order';

export interface GroupEditorHandlers {
  move(from: number, to: number): void;
  toggleHidden(group: TvGroup): void;
  toggleLocked(group: TvGroup): void;
  done(): void;
}

const focusId = (group: TvGroup) => `edit-group:${group.name}`;

/** The groups' editor rows, every group (hidden ones too) in the profile's order. */
export function groupEditor(groups: readonly TvGroup[], handlers: GroupEditorHandlers): HTMLElement[] {
  const done = h('button', { class: 'button live-groups-tool', 'data-focus-id': 'groups:done' }, icon('check'), t('livetv.groups.done'));
  done.addEventListener('click', handlers.done);
  const rows = groups.map((group, index) => {
    const { grip, buttons } = reorderControls(group.name, focusId(group), index, groups.length, (to) => handlers.move(index, to));
    const toggle = (kind: 'hide' | 'lock', on: boolean, label: string, glyph: Parameters<typeof icon>[0], act: () => void) => {
      const b = h('button', { class: `live-move live-toggle ${kind}`, 'aria-pressed': String(on), title: label, 'aria-label': label, 'data-focus-id': `${focusId(group)}:${kind}` }, icon(glyph));
      b.addEventListener('click', act);
      return b;
    };
    const hide = toggle('hide', group.hidden, t(group.hidden ? 'livetv.groups.show' : 'livetv.groups.hide', { name: group.name }), group.hidden ? 'eyeOff' : 'eye', () => handlers.toggleHidden(group));
    const lock = toggle('lock', group.locked, t(group.locked ? 'livetv.groups.unlock' : 'livetv.groups.lock', { name: group.name }), 'lock', () => handlers.toggleLocked(group));
    return h(
      'div',
      { class: `live-item live-group-edit${group.hidden ? ' hidden-group' : ''}` },
      grip,
      h('span', { class: 'live-group-name', dir: 'auto' }, group.name),
      buttons,
      hide,
      lock,
    );
  });
  return [done, h('p', { class: 'muted live-groups-hint' }, t('livetv.groups.editing-hint')), ...rows];
}

/**
 * What a locked group shows in place of its channels: a PIN field (the
 * profile's or a parent's), or, with no PIN set anywhere, a plain button and a
 * note that the lock can't keep anyone out.
 */
export function lockPrompt(pinSet: boolean, onPin: (pin: string) => Promise<void>, onCancel: () => void): HTMLElement {
  const box = h('div', { class: 'empty-state live-locked' }, h('h2', { class: 'live-locked-title' }, icon('lock'), t('livetv.groups.locked-title')));
  if (!pinSet) {
    const open = h('button', { class: 'button primary' }, t('livetv.groups.show-channels'));
    open.addEventListener('click', () => void onPin('').catch(() => {}));
    box.append(h('p', {}, t('livetv.groups.no-pin-open')), open);
    return box;
  }
  const pin = pinField(t('livetv.groups.pin'), onPin, onCancel);
  box.append(h('p', {}, t('livetv.groups.locked-hint')), pin.element);
  return box;
}
