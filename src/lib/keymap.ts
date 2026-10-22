/**
 * Keyboard shortcuts as actions (Settings → Shortcuts). Each action has
 * default keys; the person's changes are saved as overrides in one global
 * setting, so a key nobody changed follows the defaults (including future
 * ones). The app's and the player's key handlers look up actions here
 * instead of matching keys themselves.
 *
 * A key is written as a "combo": modifiers in a fixed order, then the key,
 * e.g. "Ctrl+K", "Shift+G", "Space", "ArrowLeft", "/". Letters are upper
 * case. Shift is only part of a combo for letters and named keys: a symbol
 * such as "?" already says whether Shift was held (and which keys need it
 * depends on the keyboard layout).
 *
 * Some keys never move (see `isReserved`): arrow keys, Enter, Space and Tab
 * move focus and activate things outside the player, and Escape/Backspace
 * are Back everywhere. Media keys stay with their meaning.
 */
import * as v from 'valibot';
import { t, type MessageKey } from '../i18n';
import { settings } from './ipc';

export type Scope = 'app' | 'player';

interface ActionDef {
  scope: Scope;
  keys: readonly string[];
}

/** Every remappable action and its default keys, as Orbit has always had them. Order is the Shortcuts page's. */
export const ACTIONS = {
  // Ctrl+K was Search's until the command palette took it (which also searches). A saved
  // Search override that still has Ctrl+K keeps it there, as overrides beat defaults (parseKeymap).
  'app.search': { scope: 'app', keys: ['/'] },
  'app.palette': { scope: 'app', keys: ['Ctrl+K'] },
  'app.settings': { scope: 'app', keys: ['Ctrl+,'] },
  'app.shortcuts': { scope: 'app', keys: ['?'] },
  // On a focused card: save it to My Library, or remove it (components/card-actions.ts).
  'app.save-card': { scope: 'app', keys: ['L'] },
  'player.play-pause': { scope: 'player', keys: ['Space', 'K'] },
  'player.seek-back': { scope: 'player', keys: ['ArrowLeft', 'J'] },
  'player.seek-forward': { scope: 'player', keys: ['ArrowRight', 'L'] },
  // A second at a time while playing, a frame at a time while paused (as in mpv and YouTube).
  'player.seek-back-small': { scope: 'player', keys: [','] },
  'player.seek-forward-small': { scope: 'player', keys: ['.'] },
  // Through the Speed view's pills (as in YouTube).
  'player.speed-down': { scope: 'player', keys: ['<'] },
  'player.speed-up': { scope: 'player', keys: ['>'] },
  'player.volume-up': { scope: 'player', keys: ['ArrowUp'] },
  'player.volume-down': { scope: 'player', keys: ['ArrowDown'] },
  'player.mute': { scope: 'player', keys: ['M'] },
  'player.fullscreen': { scope: 'player', keys: ['F'] },
  'player.pip': { scope: 'player', keys: ['I'] },
  'player.tracks': { scope: 'player', keys: ['C'] },
  'player.transcript': { scope: 'player', keys: ['T'] },
  'player.subtitles': { scope: 'player', keys: ['V'] },
  'player.next-subtitle': { scope: 'player', keys: ['Shift+V'] },
  'player.replay': { scope: 'player', keys: ['R'] },
  'player.sub-earlier': { scope: 'player', keys: ['G'] },
  'player.sub-later': { scope: 'player', keys: ['H'] },
  'player.audio-earlier': { scope: 'player', keys: ['Shift+G'] },
  'player.audio-later': { scope: 'player', keys: ['Shift+H'] },
  'player.chapter-previous': { scope: 'player', keys: ['PageUp'] },
  'player.chapter-next': { scope: 'player', keys: ['PageDown'] },
  'player.fit': { scope: 'player', keys: ['Z'] },
  'player.screenshot': { scope: 'player', keys: ['S'] },
  'player.next': { scope: 'player', keys: ['N'] },
  'player.previous': { scope: 'player', keys: ['P'] },
  'player.channels': { scope: 'player', keys: ['E'] },
  'player.lock': { scope: 'player', keys: ['X'] },
  // The player's own list of its shortcuts (the app's is Settings → Shortcuts, on the same key outside the player).
  'player.shortcuts': { scope: 'player', keys: ['?'] },
} as const satisfies Record<string, ActionDef>;

export type ActionId = keyof typeof ACTIONS;
/** Each action's keys; an empty list means the action has no key. */
export type Keymap = Record<ActionId, readonly string[]>;

export const KEYMAP_KEY = 'shortcuts.keys';
export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
/** More keys than this for one action is junk (a hand-edited backup). */
const MAX_KEYS = 4;

export const isActionId = (id: string): id is ActionId => Object.hasOwn(ACTIONS, id);
export const scopeOf = (id: ActionId): Scope => ACTIONS[id].scope;

export function defaultKeymap(): Keymap {
  const map: Partial<Keymap> = {};
  for (const id of ACTION_IDS) map[id] = [...ACTIONS[id].keys];
  return map as Keymap;
}

// ── Combos ──

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
/** Keys that are only ever part of a combo, never one by themselves. */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS', 'Super', 'Hyper', 'Fn', 'FnLock', 'CapsLock', 'NumLock', 'ScrollLock', 'Symbol', 'SymbolLock']);
/** Named keys a combo may use besides single characters: F1–F24, navigation and editing keys. */
const NAMED = /^(F([1-9]|1\d|2[0-4])|Arrow(Left|Right|Up|Down)|Page(Up|Down)|Home|End|Insert|Delete|Backspace|Enter|Escape|Tab|Space|ContextMenu|Pause|PrintScreen|Media[A-Za-z]{2,20}|AudioVolume(Up|Down|Mute))$/;

const isLetter = (c: string) => c.length === 1 && c.toLowerCase() !== c.toUpperCase();

/** A combo's parts, modifiers first; the key may itself be "+". */
function splitCombo(value: string): string[] {
  if (value === '+') return ['+'];
  if (value.endsWith('++')) return [...value.slice(0, -2).split('+'), '+'];
  return value.split('+');
}

/** The combo `key` is with these modifiers, normalised; null if it can't be one. */
function combo(key: string, mods: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }): string | null {
  let name: string;
  if (key === ' ' || key === 'Space') name = 'Space';
  else if (key.length === 1) {
    // Printable, but never a control character or whitespace.
    if (!/^\S$/u.test(key) || key.charCodeAt(0) < 0x20) return null;
    // "ß" capitalises to "SS", which reads back as no key at all: a letter like it stays as typed.
    const upper = key.toUpperCase();
    name = upper.length === 1 ? upper : key;
  } else if (NAMED.test(key)) name = key;
  else return null;
  // A symbol's Shift is already in the symbol ("?" is Shift+/ on a US keyboard).
  const shift = mods.shift && (name.length > 1 || isLetter(name));
  const on = { Ctrl: mods.ctrl, Alt: mods.alt, Shift: shift, Meta: mods.meta };
  return [...MODIFIERS.filter((m) => on[m]), name].join('+');
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  /** The physical key ("KeyK"), whatever the layout types on it. */
  code?: string;
  getModifierState?(key: string): boolean;
}

/** The combo a key press is, or null for a modifier on its own (or a key with no name). */
export function comboFromEvent(event: KeyLike): string | null {
  if (!event.key || MODIFIER_KEYS.has(event.key)) return null;
  // AltGr arrives as Ctrl+Alt on Windows: the character it typed is the key.
  const altGraph = event.getModifierState?.('AltGraph') === true;
  return combo(event.key, { ctrl: event.ctrlKey && !altGraph, alt: event.altKey && !altGraph, shift: event.shiftKey, meta: event.metaKey });
}

/** The combo to give an action for a key press (Settings → Shortcuts): a letter key by its Latin letter on any layout (see `latinCombo`). */
export function comboToSave(event: KeyLike): string | null {
  const value = comboFromEvent(event);
  return value && (latinCombo(event, value) ?? value);
}

/**
 * Undo (Ctrl+Z) or redo (Ctrl+Y, Ctrl+Shift+Z) for an editor's own history (Theme Studio), by the
 * letter on any layout: Ctrl+Z on a Russian keyboard types "я". AltGr (Ctrl+Alt on Windows) never counts.
 */
export function undoRedo(event: KeyLike): 'undo' | 'redo' | null {
  switch (comboToSave(event)) {
    case 'Ctrl+Z':
      return 'undo';
    case 'Ctrl+Y':
    case 'Ctrl+Shift+Y':
    case 'Ctrl+Shift+Z':
      return 'redo';
    default:
      return null;
  }
}

/**
 * Whether a key press is a command (Ctrl, Alt or Win held) rather than
 * typing. AltGr types characters (on Windows it arrives as Ctrl+Alt), so it
 * never counts: in a text field it must never fire a shortcut.
 */
export function isCommand(event: KeyLike): boolean {
  const altGraph = event.getModifierState?.('AltGraph') === true;
  return event.metaKey || (!altGraph && (event.ctrlKey || event.altKey));
}

/** A saved combo, normalised; null if it isn't one. */
export function parseCombo(text: unknown): string | null {
  if (typeof text !== 'string' || text.length > 40 || text.trim() !== text) return null;
  const parts = splitCombo(text);
  const key = parts.pop();
  if (!key) return null;
  const mods = { ctrl: false, alt: false, shift: false, meta: false };
  for (const m of parts) {
    const k = m.toLowerCase() as keyof typeof mods;
    if (!(k in mods) || mods[k]) return null;
    mods[k] = true;
  }
  return combo(key, mods);
}

const APP_EDITING_KEYS = new Set([
  'Shift+F10',
  'Ctrl+ArrowUp',
  'Ctrl+ArrowDown',
  'Ctrl+A',
  'Ctrl+C',
  'Ctrl+V',
  'Ctrl+X',
  'Ctrl+Z',
  'Ctrl+Y',
  'Ctrl+Shift+Z',
  // Moving and selecting by word or to the ends, deleting a word, pasting as plain text.
  'Ctrl+ArrowLeft',
  'Ctrl+ArrowRight',
  'Ctrl+Shift+ArrowLeft',
  'Ctrl+Shift+ArrowRight',
  'Ctrl+Home',
  'Ctrl+End',
  'Ctrl+Shift+Home',
  'Ctrl+Shift+End',
  'Ctrl+Backspace',
  'Ctrl+Delete',
  'Ctrl+Shift+V',
]);
/** Keys kept for text fields and menus outside the player (reserved later than the others, see `parseSavedKeymap`). */
const isEditingKey = (scope: Scope, value: string) => scope === 'app' && (value.endsWith('ContextMenu') || APP_EDITING_KEYS.has(value));

/**
 * Keys that can't be given to an action. Escape and Backspace are Back, Tab
 * moves focus, and media keys keep their meaning everywhere. Outside the
 * player, arrow keys move focus and Enter/Space activate what has it; in the
 * player, arrows and Space are ordinary shortcuts (seek, volume, pause).
 * Outside the player, the keys text fields and menus answer to stay theirs
 * too: the menu key and Shift+F10 open context menus, Ctrl+↑/↓ jump groups
 * in the command palette, select all, copy, paste, cut, undo and redo, and
 * a text field's word and line keys (Ctrl with ←/→, Home, End, Backspace,
 * Delete) and paste as plain text (Ctrl+Shift+V).
 */
export function isReserved(scope: Scope, value: string): boolean {
  const parts = splitCombo(value);
  const key = parts.pop()!;
  if (['Escape', 'Tab', 'Backspace', 'Enter'].includes(key) || /^(Media|AudioVolume)/.test(key)) return true;
  if (scope === 'player') return false;
  if (isEditingKey(scope, value)) return true;
  // Shift+arrows are free (spatial navigation ignores them); Shift+Space still presses a button.
  const command = parts.some((m) => m !== 'Shift');
  return (key.startsWith('Arrow') && parts.length === 0) || (key === 'Space' && !command);
}

// ── Saved overrides ──

const Stored = v.record(v.string(), v.unknown());
const KeyList = v.pipe(v.array(v.unknown()), v.maxLength(MAX_KEYS));

/**
 * The keymap from the saved overrides. Unknown actions, malformed or
 * reserved keys are dropped; a key given to two actions of the same scope
 * stays with the one the person chose it for (an override beats a default).
 */
export const parseKeymap = (value: unknown): Keymap => parseSavedKeymap(value).map;

/**
 * `parseKeymap`, and which actions went back to their defaults because a
 * saved key of theirs is one kept for text fields and menus (an older Orbit
 * let those be chosen): resetting keeps the action reachable, where dropping
 * the key could leave it with none. One whose default keys another saved
 * shortcut has (it keeps those) is left with none and listed in `keyless`
 * instead, so the person can be told to pick one.
 */
export function parseSavedKeymap(value: unknown): { map: Keymap; reset: ActionId[]; keyless: ActionId[] } {
  const map = defaultKeymap();
  const reset: ActionId[] = [];
  const stored = v.safeParse(Stored, value);
  if (!stored.success) return { map, reset, keyless: [] };
  const overridden = new Set<ActionId>();
  for (const id of ACTION_IDS) {
    if (!Object.hasOwn(stored.output, id)) continue;
    const list = v.safeParse(KeyList, stored.output[id]);
    if (!list.success) continue;
    const keys = list.output.map(parseCombo).filter((c): c is string => c !== null);
    if (keys.some((c) => isEditingKey(scopeOf(id), c))) {
      reset.push(id);
      continue;
    }
    map[id] = [...new Set(keys.filter((c) => !isReserved(scopeOf(id), c)))];
    overridden.add(id);
  }
  // Settle duplicates: overrides claim their keys first, then defaults take what's left.
  const claimed = { app: new Set<string>(), player: new Set<string>() };
  const order = [...ACTION_IDS.filter((id) => overridden.has(id)), ...ACTION_IDS.filter((id) => !overridden.has(id))];
  for (const id of order) {
    const taken = claimed[scopeOf(id)];
    map[id] = map[id].filter((k) => !taken.has(k));
    for (const k of map[id]) taken.add(k);
  }
  return { map, reset: reset.filter((id) => map[id].length), keyless: reset.filter((id) => !map[id].length) };
}

/** What to save: only the actions whose keys differ from the defaults. */
export function overrides(map: Keymap): Partial<Record<ActionId, string[]>> {
  const out: Partial<Record<ActionId, string[]>> = {};
  for (const id of ACTION_IDS) if (!sameKeys(map[id], ACTIONS[id].keys)) out[id] = [...map[id]];
  return out;
}

export const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);
export const isDefault = (map: Keymap, id: ActionId) => sameKeys(map[id], ACTIONS[id].keys);

// ── Lookups and edits ──

/** The action `value` triggers in `scope`, if any. */
export function actionFor(map: Keymap, scope: Scope, value: string): ActionId | null {
  return ACTION_IDS.find((id) => scopeOf(id) === scope && map[id].includes(value)) ?? null;
}

/**
 * The action a key press triggers. With `shiftFallback`, a Shift combo
 * nothing claims counts as the key without Shift, as the player always
 * treated it (Shift+M mutes, Shift+→ seeks); Shift+G stays its own action.
 */
export function actionForEvent(map: Keymap, scope: Scope, event: KeyLike, shiftFallback = false): ActionId | null {
  const value = comboFromEvent(event);
  if (!value) return null;
  const find = (combo: string) => {
    const found = actionFor(map, scope, combo);
    const parts = splitCombo(combo);
    if (found || !shiftFallback || !parts.includes('Shift')) return found;
    return actionFor(map, scope, parts.filter((p, i) => p !== 'Shift' || i === parts.length - 1).join('+'));
  };
  const latin = latinCombo(event, value);
  return find(value) ?? (latin ? find(latin) : null);
}

/**
 * On a layout whose letters aren't Latin (Russian, Ukrainian, Greek, Hebrew,
 * Arabic…) the K key types "л": the combo as if it typed its Latin letter,
 * so letter shortcuts work without switching layouts (as in browsers and
 * most apps). Only a non-Latin letter on a letter key: Latin layouts
 * (AZERTY, Dvorak) keep going by the letter typed, and a symbol by itself.
 */
function latinCombo(event: KeyLike, value: string): string | null {
  const letter = /^Key([A-Z])$/.exec(event.code ?? '')?.[1];
  const key = splitCombo(value).pop()!;
  // \p{L}, not `isLetter`: Hebrew and Arabic letters have no case.
  if (!letter || !/^\p{L}$/u.test(key) || /^[A-Z]$/.test(key)) return null;
  return [...splitCombo(value).slice(0, -1), letter].join('+');
}

/** Another action in the same scope that already has `value`. */
export function conflictFor(map: Keymap, id: ActionId, value: string): ActionId | null {
  return ACTION_IDS.find((other) => other !== id && scopeOf(other) === scopeOf(id) && map[other].includes(value)) ?? null;
}

/**
 * Gives `id` the key `value`. 'replace' makes it the action's only key, 'add'
 * adds it. If another action has it: 'take' removes it from that action,
 * 'swap' (replace only) also gives that action `id`'s previous keys.
 */
export function assignKey(map: Keymap, id: ActionId, value: string, mode: 'replace' | 'add', resolve: 'take' | 'swap' = 'take'): Keymap {
  const next = { ...map };
  const other = conflictFor(map, id, value);
  const previous = map[id];
  next[id] = mode === 'replace' ? [value] : [...new Set([...previous, value])].slice(-MAX_KEYS);
  if (other) {
    const rest = map[other].filter((k) => k !== value);
    // Swapping hands the other action this one's keys, minus any it would clash with, up to the most one may have (its own first).
    next[other] = resolve === 'swap' && mode === 'replace' ? [...new Set([...rest, ...previous.filter((k) => !conflictFor(next, other, k))])].slice(0, MAX_KEYS) : rest;
  }
  return next;
}

/** Puts `id` back to its default keys, taking them from any action that has one; says which did. */
export function resetAction(map: Keymap, id: ActionId): { map: Keymap; took: { key: string; from: ActionId }[] } {
  const next = { ...map, [id]: [...ACTIONS[id].keys] };
  const took: { key: string; from: ActionId }[] = [];
  for (const key of ACTIONS[id].keys) {
    const other = conflictFor(map, id, key);
    if (!other) continue;
    next[other] = next[other].filter((k) => k !== key);
    took.push({ key, from: other });
  }
  return { map: next, took };
}

// ── Labels ──

const KEY_NAMES: Record<string, MessageKey> = {
  Ctrl: 'settings.keys.ctrl',
  Alt: 'settings.keys.alt',
  Shift: 'settings.keys.shift',
  Meta: 'settings.keys.meta',
  Space: 'settings.keys.space',
  PageUp: 'settings.keys.page-up',
  PageDown: 'settings.keys.page-down',
  Home: 'settings.keys.home',
  End: 'settings.keys.end',
  Insert: 'settings.keys.insert',
  Delete: 'settings.keys.delete',
  Backspace: 'settings.keys.backspace',
  Enter: 'settings.keys.enter',
  Escape: 'settings.keys.escape',
  Tab: 'settings.keys.tab',
  ContextMenu: 'settings.keys.menu',
};
const ARROWS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

/** A combo as people read it, in the interface's language: "Ctrl+K", "Umschalt+G", "→". */
export function keyLabel(value: string): string {
  return splitCombo(value).map((p) => ARROWS[p] ?? (KEY_NAMES[p] ? t(KEY_NAMES[p]) : p)).join('+');
}

/** An action's keys as people read them, or '' when it has none. */
export const keysLabel = (keys: readonly string[]) => keys.map(keyLabel).join('  ·  ');

// ── The keymap in use ──

let current: Keymap = defaultKeymap();

/** The keymap in use (the defaults until `loadKeymap` has read the saved one). */
export const keymap = (): Keymap => current;

/** The first key of `id`, as people read it, or null when it has none (for tooltips). */
export function firstKey(id: ActionId): string | null {
  const key = current[id][0];
  return key ? keyLabel(key) : null;
}

/**
 * Keeps `element`'s tooltip naming the action's current key ("Search (/)"),
 * read when it's hovered or focused, so a key changed in Settings shows up.
 */
export function showShortcut(element: HTMLElement, label: string | (() => string), id: ActionId): void {
  const refresh = () => {
    const key = firstKey(id);
    const text = typeof label === 'function' ? label() : label;
    element.title = key ? t('browse.nav.with-shortcut', { label: text, shortcut: key }) : text;
  };
  refresh();
  element.addEventListener('pointerenter', refresh);
  element.addEventListener('focus', refresh);
}

/**
 * Reads the saved keymap. Returns the actions put back to their defaults and
 * those left with no key (see `parseSavedKeymap`), saved at once so the
 * person hears of it once.
 */
export async function loadKeymap(): Promise<{ reset: ActionId[]; keyless: ActionId[] }> {
  const { map, reset, keyless } = parseSavedKeymap(await settings.get(KEYMAP_KEY).catch(() => null));
  current = map;
  if (reset.length || keyless.length) await saveKeymap(map);
  return { reset, keyless };
}

/** Uses and saves `map`. */
export async function saveKeymap(map: Keymap): Promise<void> {
  current = map;
  await settings.set(KEYMAP_KEY, overrides(map));
}
