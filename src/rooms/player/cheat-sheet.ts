/**
 * The player's shortcut list ("?"): every player action with the keys the
 * person has given it (Settings → Shortcuts), grouped, plus the fixed keys.
 * A tap opens it until Esc or "?" again; held, it shows only while held.
 */
import { icon } from '../../components/icons';
import { t, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { keyLabel, keymap, keysLabel, type ActionId } from '../../lib/keymap';
import { ACTION_LABELS } from '../settings/shortcuts';
import { HOLD_MS } from './hold-speed';

const GROUPS: readonly [MessageKey, readonly ActionId[]][] = [
  ['playerplus.cheat.playback', ['player.play-pause', 'player.seek-back', 'player.seek-forward', 'player.seek-back-small', 'player.seek-forward-small', 'player.speed-down', 'player.speed-up', 'player.chapter-previous', 'player.chapter-next', 'player.previous', 'player.next', 'player.replay']],
  ['playerplus.cheat.sound', ['player.volume-up', 'player.volume-down', 'player.mute', 'player.tracks', 'player.transcript', 'player.subtitles', 'player.next-subtitle', 'player.sub-earlier', 'player.sub-later', 'player.audio-earlier', 'player.audio-later']],
  ['playerplus.cheat.window', ['player.fullscreen', 'player.pip', 'player.fit', 'player.screenshot', 'player.channels', 'player.lock', 'player.shortcuts']],
];

/** Keys that do nothing on a live channel (it can't change speed or step), left off its list. */
const NOT_LIVE = new Set<ActionId>(['player.seek-back-small', 'player.seek-forward-small', 'player.speed-down', 'player.speed-up']);

export interface CheatHost {
  /** Number keys and hold-for-2× are on (Settings → Player). */
  numberJump(): boolean;
  holdBoost(): boolean;
  live(): boolean;
}

export function createCheatSheet(host: CheatHost) {
  const closeButton = h('button', { class: 'cheat-close', title: t('player.controls.close'), 'aria-label': t('player.controls.close') }, icon('close'));
  const body = h('div', { class: 'cheat-body' });
  const element = h(
    'div',
    { class: 'cheat-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-label': t('playerplus.cheat.title'), hidden: true },
    h('div', { class: 'cheat-card' }, h('div', { class: 'cheat-head' }, h('h2', { class: 'cheat-title' }, t('playerplus.cheat.title')), closeButton), body),
  );
  let openedAt = 0;
  let heldKey: string | null = null;

  const keys = (list: readonly string[]) => (list.length ? h('span', { class: 'cheat-keys' }, ...list.map((k) => h('kbd', {}, keyLabel(k)))) : h('span', { class: 'cheat-keys none' }, t('playerplus.cheat.no-key')));
  const line = (label: string, keyPart: HTMLElement) => h('div', { class: 'cheat-row' }, h('span', { class: 'cheat-label' }, label), keyPart);

  function draw(): void {
    const map = keymap();
    const groups = GROUPS.map(([heading, ids]) =>
      h(
        'section',
        { class: 'cheat-group' },
        h('h3', { class: 'cheat-heading' }, t(heading)),
        ...ids.filter((id) => (id === 'player.channels' ? host.live() : !(host.live() && NOT_LIVE.has(id)))).map((id) => line(t(ACTION_LABELS[id]), keys(map[id]))),
      ),
    );
    // A live channel can't jump to a point or speed up: those keys do nothing there.
    const live = host.live();
    const fixed: HTMLElement[] = [
      line(t('settings.shortcuts.escape'), keys(['Escape'])),
      host.numberJump() && !live ? line(t('playerplus.keys.number-jump'), h('span', { class: 'cheat-keys', dir: 'ltr' }, h('kbd', {}, '0'), '–', h('kbd', {}, '9'))) : null,
      host.holdBoost() && !live && map['player.play-pause'][0] ? line(t('playerplus.keys.hold-boost'), h('span', { class: 'cheat-keys' }, t('playerplus.cheat.hold', { key: keysLabel(map['player.play-pause'].slice(0, 1)) }))) : null,
    ].filter((el) => el !== null);
    body.replaceChildren(...groups, h('section', { class: 'cheat-group' }, h('h3', { class: 'cheat-heading' }, t('playerplus.cheat.fixed')), ...fixed));
  }

  function open(key: string | null): void {
    draw();
    element.hidden = false;
    openedAt = Date.now();
    heldKey = key;
  }
  function close(): void {
    element.hidden = true;
    heldKey = null;
  }
  closeButton.addEventListener('click', close);
  element.addEventListener('click', (event) => {
    if (event.target === element) close();
  });

  return {
    element,
    isOpen: () => !element.hidden,
    /** Its key went down (`code`, the physical key): opens it, or closes it if it's open. */
    toggle(code: string): void {
      if (element.hidden) open(code);
      else close();
    },
    /** A key came up (`code`): held long enough, letting go of its key closes it again. */
    release(code: string): void {
      if (heldKey === null || code !== heldKey) return;
      heldKey = null;
      if (Date.now() - openedAt >= HOLD_MS) close();
    },
    close,
  };
}
