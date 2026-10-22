import { actionForEvent, isCommand, keymap, type ActionId } from '../lib/keymap';
import { isEditing } from './spatial';

/**
 * The app-wide shortcut a key press is, or null. Not for a key something else
 * already handled (a menu, the palette's field), or plain typing in a text field
 * (AltGr included): Ctrl, Alt and Win shortcuts (Ctrl+K, Ctrl+,) still work
 * there, as the field's own editing keys can't be bound (see keymap.ts). Nor for a
 * held key: holding Ctrl+K would flicker the palette open and shut, and holding
 * / or Ctrl+, would go to the page again and again.
 */
export function appShortcut(event: KeyboardEvent): ActionId | null {
  if (event.repeat || event.defaultPrevented || (isEditing(event.target) && !isCommand(event))) return null;
  return actionForEvent(keymap(), 'app', event);
}
