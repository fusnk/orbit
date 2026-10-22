/**
 * Settings → Shortcuts: every remappable action with its keys, and the fixed
 * keys. "Change" (or "Add") listens for the next key press; only then are
 * keys swallowed, and Escape (or a click elsewhere) stops listening. A key
 * another action has asks first: take it from that action, or swap keys.
 */
import { toast } from '../../components/toast';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import {
  ACTION_IDS,
  assignKey,
  comboToSave,
  conflictFor,
  defaultKeymap,
  isDefault,
  isReserved,
  keyLabel,
  keymap,
  keysLabel,
  resetAction,
  saveKeymap,
  scopeOf,
  type ActionId,
  type Keymap,
  type Scope,
} from '../../lib/keymap';

/** Each action's name (also the player's shortcut list, see player/cheat-sheet.ts). */
export const ACTION_LABELS: Record<ActionId, MessageKey> = {
  'app.search': 'settings.shortcuts.search',
  'app.palette': 'palette.shortcut',
  'app.settings': 'settings.shortcuts.settings',
  'app.shortcuts': 'settings.shortcuts.this-list',
  'app.save-card': 'pages.shortcut.save-card',
  'player.play-pause': 'settings.shortcuts.play-pause',
  'player.seek-back': 'settings.shortcuts.seek-back',
  'player.seek-forward': 'settings.shortcuts.seek-forward',
  'player.seek-back-small': 'pstream.keys.seek-back-small',
  'player.seek-forward-small': 'pstream.keys.seek-forward-small',
  'player.speed-down': 'pstream.keys.speed-down',
  'player.speed-up': 'pstream.keys.speed-up',
  'player.volume-up': 'settings.shortcuts.volume-up',
  'player.volume-down': 'settings.shortcuts.volume-down',
  'player.mute': 'settings.shortcuts.mute',
  'player.fullscreen': 'settings.shortcuts.full-screen',
  'player.pip': 'settings.shortcuts.pip',
  'player.tracks': 'settings.shortcuts.tracks',
  'player.transcript': 'player.transcript.title',
  'player.subtitles': 'settings.shortcuts.subtitles',
  'player.next-subtitle': 'playertools.subs.try-another',
  'player.replay': 'settings.shortcuts.replay',
  'player.sub-earlier': 'settings.shortcuts.sub-earlier',
  'player.sub-later': 'settings.shortcuts.sub-later',
  'player.audio-earlier': 'settings.shortcuts.audio-earlier',
  'player.audio-later': 'settings.shortcuts.audio-later',
  'player.chapter-previous': 'settings.shortcuts.chapter-previous',
  'player.chapter-next': 'settings.shortcuts.chapter-next',
  'player.fit': 'settings.shortcuts.fit',
  'player.screenshot': 'settings.shortcuts.screenshot',
  'player.next': 'settings.shortcuts.next-episode',
  'player.previous': 'settings.shortcuts.previous-episode',
  'player.channels': 'settings.shortcuts.channels',
  'player.lock': 'playerplus.lock.action',
  'player.shortcuts': 'playerplus.cheat.action',
};

const GROUPS: [MessageKey, Scope][] = [
  ['settings.shortcuts.anywhere', 'app'],
  ['settings.shortcuts.player', 'player'],
];

const label = (id: ActionId) => t(ACTION_LABELS[id]);

/** Keys that can't be changed, with what they do. */
function fixedKeys(): [string, string][] {
  return [
    [t('settings.shortcuts.back'), t('settings.shortcuts.back-keys')],
    [t('settings.shortcuts.move-focus'), t('settings.shortcuts.move-focus-keys')],
    [t('settings.shortcuts.open'), keysLabel(['Enter', 'Space'])],
    [t('settings.shortcuts.escape'), keyLabel('Escape')],
    [t('settings.shortcuts.live-surf'), keysLabel(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'])],
    [t('playerplus.keys.number-jump'), t('playerplus.keys.number-jump-keys')],
    [t('playerplus.keys.hold-boost'), t('playerplus.keys.hold-boost-keys', { key: keyLabel(keymap()['player.play-pause'][0] ?? 'Space') })],
    [t('settings.shortcuts.media-keys'), t('settings.shortcuts.media-keys-keys')],
  ];
}

const kbd = (text: string) => h('kbd', {}, text);

export function shortcutsPanel(): HTMLElement {
  const panel = h('div', { class: 'shortcuts' });
  const status = h('p', { class: 'setting-hint shortcut-status', role: 'status' });
  /** The action listening for a key, and whether the key replaces its keys or joins them. */
  let listening: { id: ActionId; mode: 'replace' | 'add' } | null = null;
  /** A key another action has, waiting for the person to choose what happens. */
  let pending: { id: ActionId; mode: 'replace' | 'add'; key: string; other: ActionId } | null = null;
  /**
   * The physical key whose press was captured: its key-up is swallowed too, so it can't press the
   * focused button. By `code`, as `key` can differ on the way up ("?" comes up as "/" when Shift
   * is let go first), which left this listener swallowing a later key-up anywhere in the app.
   */
  let swallowUp: string | null = null;

  function apply(map: Keymap, focusId: string, message: string): void {
    void saveKeymap(map).catch((err: unknown) => {
      console.error('Could not save the shortcuts', err);
      toast(t('settings.common.save-failed'));
    });
    status.textContent = message;
    draw(focusId);
  }

  // ── Listening for a key ──
  function onKeyDown(event: KeyboardEvent): void {
    if (!listening) return;
    // The page changed with no key or click (a phone remote or another Orbit opened a title), or
    // something opened over it: the key is for what's there now, not a shortcut to choose.
    if (!panel.isConnected || panel.closest('[inert]')) return stopListening(true);
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') return stopListening(true);
    const key = comboToSave(event);
    // A modifier on its own: wait for the rest of the combo.
    if (!key || event.repeat) return;
    const { id, mode } = listening;
    if (isReserved(scopeOf(id), key)) {
      status.textContent = t('settings.shortcuts.reserved', { key: keyLabel(key) });
      return;
    }
    swallowUp = event.code;
    stopListening(false);
    const other = conflictFor(keymap(), id, key);
    if (other) {
      pending = { id, mode, key, other };
      status.textContent = t('settings.shortcuts.conflict', { key: keyLabel(key), action: label(other) });
      return draw('take');
    }
    const map = assignKey(keymap(), id, key, mode);
    apply(map, `${mode}-${id}`, t('settings.shortcuts.now', { action: label(id), keys: keysLabel(map[id]) }));
  }
  function onKeyUp(event: KeyboardEvent): void {
    if (!listening && event.code !== swallowUp) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (listening) return;
    swallowUp = null;
    window.removeEventListener('keyup', onKeyUp, { capture: true });
  }
  const onPointer = () => stopListening(true);

  function listen(id: ActionId, mode: 'replace' | 'add'): void {
    if (listening?.id === id && listening.mode === mode) return stopListening(true);
    cancelPending(false);
    listening = { id, mode };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('pointerdown', onPointer, { capture: true });
    window.addEventListener('blur', onPointer);
    status.textContent = t('settings.shortcuts.press-for', { action: label(id) });
    draw(`${mode}-${id}`);
  }

  function stopListening(redraw: boolean): void {
    if (!listening) return;
    const { id, mode } = listening;
    listening = null;
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('pointerdown', onPointer, { capture: true });
    window.removeEventListener('blur', onPointer);
    // The key-up listener stays until the captured key is released (see onKeyUp).
    if (!swallowUp) window.removeEventListener('keyup', onKeyUp, { capture: true });
    if (redraw) {
      status.textContent = '';
      draw(`${mode}-${id}`);
    }
  }

  function cancelPending(redraw = true): void {
    if (!pending) return;
    const id = pending.id;
    pending = null;
    if (redraw) {
      status.textContent = '';
      draw(`replace-${id}`);
    }
  }

  function resolve(how: 'take' | 'swap'): void {
    if (!pending) return;
    const { id, mode, key, other } = pending;
    cancelPending(false);
    const map = assignKey(keymap(), id, key, mode, how);
    const message = `${t('settings.shortcuts.now', { action: label(id), keys: keysLabel(map[id]) })} ${t('settings.shortcuts.now', { action: label(other), keys: keysLabel(map[other]) || t('settings.shortcuts.not-set') })}`;
    apply(map, `${mode}-${id}`, message);
  }

  // ── Drawing ──
  function keysOf(id: ActionId): HTMLElement {
    if (listening?.id === id) return h('span', { class: 'shortcut-keys listening' }, t('settings.shortcuts.press'));
    const keys = keymap()[id];
    // Keys read left to right in every language (Ctrl+K, not K+Ctrl).
    return h('span', { class: 'shortcut-keys', dir: 'ltr' }, ...(keys.length ? keys.map((k) => kbd(keyLabel(k))) : [h('span', { class: 'muted' }, t('settings.shortcuts.not-set'))]));
  }

  function actionRow(id: ActionId): HTMLElement {
    const name = label(id);
    const button = (mode: 'replace' | 'add') => {
      const b = h(
        'button',
        {
          class: 'button',
          'data-focus-id': `${mode}-${id}`,
          'aria-pressed': String(listening?.id === id && listening.mode === mode),
          'aria-label': t(mode === 'replace' ? 'settings.shortcuts.change-label' : 'settings.shortcuts.add-label', { action: name }),
        },
        t(mode === 'replace' ? 'settings.shortcuts.change' : 'settings.shortcuts.add'),
      );
      b.addEventListener('click', () => listen(id, mode));
      return b;
    };
    const reset = h('button', { class: 'button', 'data-focus-id': `reset-${id}`, 'aria-label': t('settings.shortcuts.reset-label', { action: name }), disabled: isDefault(keymap(), id) }, t('settings.shortcuts.reset'));
    reset.addEventListener('click', () => {
      const { map, took } = resetAction(keymap(), id);
      const notes = took.map(({ key, from }) => t('settings.shortcuts.took', { key: keyLabel(key), action: label(from) }));
      apply(map, `replace-${id}`, [t('settings.shortcuts.now', { action: name, keys: keysLabel(map[id]) }), ...notes].join(' '));
    });
    const row = h('div', { class: 'shortcut-row', 'data-action': id }, h('span', { class: 'shortcut-action' }, name), keysOf(id), h('div', { class: 'shortcut-buttons' }, button('replace'), button('add'), reset));
    if (pending?.id === id) {
      const { key, other, mode } = pending;
      const take = h('button', { class: 'button primary', 'data-focus-id': 'take' }, t('settings.shortcuts.take'));
      take.addEventListener('click', () => resolve('take'));
      const swap = h('button', { class: 'button', hidden: mode !== 'replace' }, t('settings.shortcuts.swap'));
      swap.addEventListener('click', () => resolve('swap'));
      const cancel = h('button', { class: 'button' }, t('settings.common.cancel'));
      cancel.addEventListener('click', () => cancelPending());
      row.append(h('div', { class: 'shortcut-conflict' }, h('span', {}, t('settings.shortcuts.conflict', { key: keyLabel(key), action: label(other) })), h('div', { class: 'shortcut-buttons' }, take, swap, cancel)));
    }
    return row;
  }

  function draw(focusId?: string): void {
    const resetAll = h('button', { class: 'button', 'data-focus-id': 'reset-all', disabled: ACTION_IDS.every((id) => isDefault(keymap(), id)) }, t('settings.shortcuts.reset-all'));
    // Focus moves to the first Change: Reset all is disabled once everything is default.
    resetAll.addEventListener('click', () => apply(defaultKeymap(), `replace-${ACTION_IDS[0]}`, t('settings.shortcuts.all-reset')));
    panel.replaceChildren(
      h('div', { class: 'shortcut-intro' }, h('p', { class: 'setting-hint' }, t('settings.shortcuts.intro')), resetAll),
      status,
      ...GROUPS.map(([heading, scope]) =>
        h('section', {}, h('h3', { class: 'settings-subheading' }, t(heading)), h('div', { class: 'shortcut-rows' }, ...ACTION_IDS.filter((id) => scopeOf(id) === scope).map(actionRow))),
      ),
      h(
        'section',
        {},
        h('h3', { class: 'settings-subheading' }, t('settings.shortcuts.fixed')),
        h('p', { class: 'setting-hint' }, t('settings.shortcuts.fixed-hint')),
        h('dl', { class: 'shortcut-list' }, ...fixedKeys().flatMap(([action, keys]) => [h('dt', {}, action), h('dd', {}, kbd(keys))])),
      ),
    );
    if (focusId) panel.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
  }

  // Esc answers the question with Cancel (before it reaches Back), while focus is here.
  panel.addEventListener('keydown', (event) => {
    if (!pending || event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    cancelPending();
  });

  draw();
  return panel;
}
