/**
 * Lock controls: while locked, the player ignores every key, click and
 * wheel turn (a cat on the keyboard, a toddler with the remote) except the
 * way out: its lock key, or Esc three times in a row. A shield over the
 * picture takes the pointer; touching it shows how to unlock, with a button.
 *
 * Its key handler is added before every other player handler (they all
 * listen on the document while capturing), so nothing else sees a key.
 */
import { icon } from '../../components/icons';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { actionForEvent, firstKey, keymap } from '../../lib/keymap';
import { ESC_TIMES, ESC_WINDOW_MS, escCount } from './unlock';

const HINT_MS = 3000;

export function createLock(options: { view(): HTMLElement; changed(locked: boolean): void }) {
  let locked = false;
  let escapes: number[] = [];
  let hintTimer: number | undefined;

  const unlockButton = h('button', { class: 'button glass lock-unlock' }, icon('lock'), t('playerplus.lock.unlock'));
  const hint = h('p', { class: 'lock-hint' });
  const panel = h('div', { class: 'lock-panel', hidden: true }, hint, unlockButton);
  const shield = h('div', { class: 'player-lock-shield', hidden: true }, panel);

  const hintText = () => {
    const key = firstKey('player.lock');
    return key ? t('playerplus.lock.hint-key', { key }) : t('playerplus.lock.hint');
  };

  function showHint(): void {
    hint.textContent = hintText();
    panel.hidden = false;
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      if (panel.contains(document.activeElement)) return;
      panel.hidden = true;
    }, HINT_MS);
  }

  function set(on: boolean): void {
    if (on === locked) return;
    locked = on;
    escapes = [];
    shield.hidden = !on;
    options.view().classList.toggle('locked', on);
    if (on) {
      if (document.activeElement instanceof HTMLElement && options.view().contains(document.activeElement)) document.activeElement.blur();
      showHint();
    } else {
      panel.hidden = true;
      toast(t('playerplus.lock.unlocked'));
    }
    options.changed(on);
  }

  unlockButton.addEventListener('click', () => set(false));
  // Every pointer action on the shield is swallowed; it only brings up the hint.
  // Including the mouse's back button, which would otherwise leave the player.
  for (const type of ['pointerdown', 'mouseup', 'click', 'auxclick', 'dblclick', 'wheel', 'contextmenu'] as const) {
    shield.addEventListener(
      type,
      (event) => {
        if (panel.contains(event.target as Node) && type !== 'wheel') return;
        event.preventDefault();
        event.stopPropagation();
        if (type === 'pointerdown') showHint();
      },
      { passive: false },
    );
  }

  /** Swallows every key while locked, except the ways out. */
  function onKey(event: KeyboardEvent): void {
    if (!locked) return;
    // The unlock button can be pressed with Enter or Space once it has focus.
    if (panel.contains(document.activeElement) && (event.key === 'Enter' || event.key === ' ')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (actionForEvent(keymap(), 'player', event, true) === 'player.lock') return set(false);
    if (event.key === 'Escape') {
      const now = Date.now();
      escapes = [...escapes.filter((at) => now - at <= ESC_WINDOW_MS), now];
      if (escCount(escapes, now) >= ESC_TIMES) return set(false);
    }
    showHint();
  }

  return {
    /** Goes over the player's controls. */
    element: shield,
    onKey,
    locked: () => locked,
    lock: () => set(true),
    unlock: () => set(false),
    dispose(): void {
      window.clearTimeout(hintTimer);
    },
  };
}
