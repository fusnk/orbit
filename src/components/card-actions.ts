/**
 * Quick actions on browsing cards (Settings → Appearance → Cards): a "Save
 * to My Library" button and a ⋯ button that opens the card's menu, in the
 * artwork's corner while the card is pointed at or focused.
 *
 * They're for the mouse only, so a card stays one stop for the arrow keys,
 * Tab and a controller: they can't take focus and screen readers skip them.
 * The keyboard has the same two things on the card itself: the save shortcut
 * (L by default, Settings → Shortcuts) and the Menu key or Shift+F10.
 */
import type { Title } from '../catalog/titles';
import { isRtl, t } from '../i18n';
import { h } from '../lib/dom';
import { inLibrary, libraryEntry, onLibraryChange, restoreLibrary, toggleLibrary } from '../library/library';
import { icon } from './icons';
import { toast } from './toast';
import './card-actions.css';

const titles = new WeakMap<HTMLElement, Title>();

/** Saves `title` to My Library, or removes it, and says so (with Undo). */
export function toggleSaved(title: Title): void {
  const removed = libraryEntry(title.id);
  void toggleLibrary(title).then((saved) => {
    if (!saved) return;
    // Undo puts back what was there, so it can't undo the opposite of what this did if the title changed meanwhile.
    const undo = removed ? () => void restoreLibrary(removed) : () => void (inLibrary(title.id) && toggleLibrary(title));
    toast(t(removed ? 'titles.actions.removed-library' : 'titles.actions.added-library', { name: title.name }), { action: { label: t('pages.undo'), run: undo } });
  });
}

/**
 * The save button's icon and name follow whether the title is saved now. Left alone when they already
 * do: this runs each time a card takes focus, and redrawing the icon inside a card changes what the
 * page's `:has()` rules (the card's frame, its rail) look at, which restyled the whole row on every
 * arrow press (about 40 ms a press on a Shield).
 */
function syncSave(button: HTMLElement, title: Title): void {
  const saved = inLibrary(title.id);
  if (button.firstChild && button.classList.contains('on') === saved) return;
  const label = saved ? t('titles.actions.remove-library') : t('titles.actions.add-library');
  button.title = label;
  button.classList.toggle('on', saved);
  button.replaceChildren(icon(saved ? 'check' : 'plus'));
}

/** A corner button that acts on a click without the card under it opening. */
function quickButton(className: string, run: (button: HTMLElement) => void): HTMLElement {
  // Not a <button>: the card is one, and buttons can't hold buttons.
  const button = h('span', { class: `card-quick ${className}`, 'aria-hidden': 'true', 'data-nav-skip': true });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    run(button);
  });
  return button;
}

/** Adds the quick actions to a card (the setting shows or hides them, styles.css). */
export function withQuickActions<T extends HTMLElement>(card: T, title: Title): T {
  titles.set(card, title);
  card.dataset.quickSave = '';
  const save = quickButton('card-save', (button) => {
    toggleSaved(title);
    syncSave(button, title);
  });
  // The card's own menu (components/menu.ts `withContextMenu`), opened where the button is.
  const more = quickButton('card-more', (button) => {
    const rect = button.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: isRtl() ? rect.right : rect.left, clientY: rect.bottom }));
  });
  more.title = t('titles.detail.more-actions');
  more.append(icon('more'));
  syncSave(save, title);
  watchLibrary();
  // Saved elsewhere since it was drawn: brought up to date when it's next pointed at or focused.
  card.addEventListener('pointerenter', () => syncSave(save, title));
  card.addEventListener('focus', () => syncSave(save, title));
  card.querySelector('.frame')?.append(h('span', { class: 'card-quick-actions' }, save, more));
  return card;
}

let watching = false;
/** Once: a change to My Library (an Undo, another window, sync) redraws the save buttons on screen. */
function watchLibrary(): void {
  if (watching) return;
  watching = true;
  onLibraryChange(() => {
    for (const card of document.querySelectorAll<HTMLElement>('[data-quick-save]')) {
      const title = titles.get(card);
      const button = card.querySelector<HTMLElement>('.card-save');
      if (title && button) syncSave(button, title);
    }
  });
}

/** The save shortcut on the focused card: true when there was one to save. */
export function saveFocusedCard(): boolean {
  const card = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-quick-save]') : null;
  const title = card && titles.get(card);
  if (!card || !title) return false;
  toggleSaved(title);
  const button = card.querySelector<HTMLElement>('.card-save');
  if (button) syncSave(button, title);
  return true;
}
