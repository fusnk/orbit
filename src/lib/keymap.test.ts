import { describe, expect, it, vi } from 'vitest';
import { actionForEvent, assignKey, comboFromEvent, comboToSave, conflictFor, defaultKeymap, isCommand, isReserved, KEYMAP_KEY, keymap, loadKeymap, overrides, parseCombo, parseKeymap, parseSavedKeymap, resetAction, undoRedo, type KeyLike } from './keymap';

const saved = new Map<string, unknown>();
vi.mock('./ipc', () => ({
  settings: {
    get: async (key: string) => saved.get(key) ?? null,
    set: async (key: string, value: unknown) => void saved.set(key, value),
  },
}));

const press = (key: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe('keymap defaults', () => {
  const map = defaultKeymap();
  const player = (key: string, mods?: Partial<Omit<KeyLike, 'key'>>) => actionForEvent(map, 'player', press(key, mods), true);
  const app = (key: string, mods?: Partial<Omit<KeyLike, 'key'>>) => actionForEvent(map, 'app', press(key, mods));

  it('keeps every key the player always had', () => {
    expect([player(' '), player('k'), player('K')]).toEqual(['player.play-pause', 'player.play-pause', 'player.play-pause']);
    expect([player('ArrowLeft'), player('j'), player('ArrowRight'), player('l')]).toEqual(['player.seek-back', 'player.seek-back', 'player.seek-forward', 'player.seek-forward']);
    expect([player('ArrowUp'), player('ArrowDown')]).toEqual(['player.volume-up', 'player.volume-down']);
    expect([player('m'), player('f'), player('i'), player('c'), player('r'), player('z'), player('s'), player('n'), player('p'), player('e')]).toEqual([
      'player.mute',
      'player.fullscreen',
      'player.pip',
      'player.tracks',
      'player.replay',
      'player.fit',
      'player.screenshot',
      'player.next',
      'player.previous',
      'player.channels',
    ]);
    expect([player('PageUp'), player('PageDown')]).toEqual(['player.chapter-previous', 'player.chapter-next']);
    expect([player('g'), player('h'), player('G', { shiftKey: true }), player('H', { shiftKey: true })]).toEqual(['player.sub-earlier', 'player.sub-later', 'player.audio-earlier', 'player.audio-later']);
  });

  it('treats Shift as the player always did: ignored unless it means something', () => {
    expect(player('M', { shiftKey: true })).toBe('player.mute');
    expect(player('ArrowRight', { shiftKey: true })).toBe('player.seek-forward');
    expect(player(' ', { shiftKey: true })).toBe('player.play-pause');
    // Ctrl, Alt and Win combos were never player keys.
    expect(player('k', { ctrlKey: true })).toBeNull();
    expect(player('m', { altKey: true })).toBeNull();
  });

  it('keeps the app-wide shortcuts, with Ctrl+K now the command palette', () => {
    expect([app('k', { ctrlKey: true }), app('K', { ctrlKey: true }), app('/'), app(',', { ctrlKey: true }), app('?', { shiftKey: true })]).toEqual(['app.palette', 'app.palette', 'app.search', 'app.settings', 'app.shortcuts']);
    // Ctrl+Shift+K never searched.
    expect(app('K', { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(app('k')).toBeNull();
  });

  it('counts AltGr as typing, and Ctrl, Alt and Win as a command', () => {
    const altGraph = (key: string) => ({ ...press(key, { ctrlKey: true, altKey: true }), getModifierState: (m: string) => m === 'AltGraph' });
    expect(isCommand(altGraph('@'))).toBe(false);
    expect(isCommand(press('a'))).toBe(false);
    expect(isCommand(press('A', { shiftKey: true }))).toBe(false);
    expect([isCommand(press('k', { ctrlKey: true })), isCommand(press('x', { altKey: true })), isCommand(press('k', { metaKey: true }))]).toEqual([true, true, true]);
  });

  it('works on Cyrillic, Greek, Hebrew and Arabic layouts, where letter keys type other letters', () => {
    // Russian: the K key types "л", G "п"; the action is still the key's Latin letter.
    expect(player('л', { code: 'KeyK' })).toBe('player.play-pause');
    expect(player('П', { code: 'KeyG', shiftKey: true })).toBe('player.audio-earlier');
    expect(player('п', { code: 'KeyG' })).toBe('player.sub-earlier');
    expect(app('л', { code: 'KeyK', ctrlKey: true })).toBe('app.palette');
    // Hebrew: the E key types "ק".
    expect(player('ק', { code: 'KeyE' })).toBe('player.channels');
    // A symbol keeps its own meaning ("/" on Hebrew's Q key is still Search), and a key someone mapped to the letter typed wins.
    expect(app('/', { code: 'KeyQ' })).toBe('app.search');
    expect(actionForEvent(parseKeymap({ 'player.mute': ['Л'] }), 'player', press('л', { code: 'KeyK' }), true)).toBe('player.mute');
    // Latin layouts (AZERTY, Dvorak) go by the letter typed, never the key's place.
    expect(player('a', { code: 'KeyQ' })).toBeNull();
    expect(player('k', { code: 'KeyV' })).toBe('player.play-pause');
  });

  it('saves a letter key by its Latin letter, so a shortcut chosen on one layout works on the other', () => {
    expect(comboToSave(press('л', { code: 'KeyK', ctrlKey: true }))).toBe('Ctrl+K');
    expect(comboToSave(press('k', { code: 'KeyK' }))).toBe('K');
    expect(comboToSave(press('a', { code: 'KeyQ' }))).toBe('A');
    expect(comboToSave(press('?', { code: 'Slash', shiftKey: true }))).toBe('?');
  });

  it('steps speed with < and > and nudges with , and .', () => {
    // On a US keyboard < and > are Shift+, and Shift+.: the symbol carries the Shift.
    expect([player('<', { shiftKey: true }), player('>', { shiftKey: true }), player(','), player('.')]).toEqual(['player.speed-down', 'player.speed-up', 'player.seek-back-small', 'player.seek-forward-small']);
  });

  it('the new subtitles key clashes with nothing', () => {
    const map = defaultKeymap();
    expect(map['player.subtitles']).toEqual(['V']);
    expect(conflictFor(map, 'player.subtitles', 'V')).toBeNull();
  });

  it('has no key twice in a scope, and none reserved', () => {
    const map = defaultKeymap();
    expect(parseKeymap({})).toEqual(map);
    expect(parseKeymap(overrides(map))).toEqual(map);
    expect(overrides(map)).toEqual({});
  });
});

describe('combos', () => {
  it('normalises key presses', () => {
    expect(comboFromEvent(press('a'))).toBe('A');
    expect(comboFromEvent(press('A', { shiftKey: true }))).toBe('Shift+A');
    expect(comboFromEvent(press('?', { shiftKey: true }))).toBe('?');
    expect(comboFromEvent(press('k', { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }))).toBe('Ctrl+Alt+Shift+Meta+K');
    expect(comboFromEvent(press('F5', { shiftKey: true }))).toBe('Shift+F5');
    expect(comboFromEvent(press('+', { ctrlKey: true }))).toBe('Ctrl++');
    // AltGr typing "@" is the "@" key, not Ctrl+Alt+@.
    expect(comboFromEvent({ ...press('@', { ctrlKey: true, altKey: true }), getModifierState: (k) => k === 'AltGraph' })).toBe('@');
  });

  it('keeps a letter whose capital is two letters (German ß), so the key it was given survives a restart', () => {
    const combo = comboToSave(press('ß', { code: 'Minus' }));
    expect(combo).toBe('ß');
    expect(parseCombo(combo)).toBe('ß');
    expect(parseKeymap({ 'app.search': [combo] })['app.search']).toEqual(['ß']);
  });

  it('ignores modifiers alone and unknown keys', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Unidentified', 'Process', '']) expect(comboFromEvent(press(key))).toBeNull();
  });

  it('parses saved combos', () => {
    expect(parseCombo('ctrl+k')).toBe('Ctrl+K');
    expect(parseCombo('Ctrl++')).toBe('Ctrl++');
    expect(parseCombo('Space')).toBe('Space');
    for (const bad of ['', '+K', 'Ctrl+Ctrl+K', 'Hyper+K', 'NotAKey', 'Ctrl+', 'A'.repeat(50), '\u0007', ' ', 7, null]) expect(parseCombo(bad), String(bad)).toBeNull();
  });

  it('reserves navigation and Back keys', () => {
    for (const key of ['Escape', 'Tab', 'Shift+Tab', 'Enter', 'Backspace', 'MediaPlayPause']) {
      expect(isReserved('app', key), key).toBe(true);
      expect(isReserved('player', key), key).toBe(true);
    }
    // Arrows and Space move focus and press buttons outside the player, but are player keys.
    for (const key of ['ArrowLeft', 'Space', 'Shift+Space']) {
      expect(isReserved('app', key), key).toBe(true);
      expect(isReserved('player', key), key).toBe(false);
    }
    expect(isReserved('app', 'Alt+ArrowLeft')).toBe(false);
    expect(isReserved('app', 'Ctrl+Space')).toBe(false);
  });
});

describe('overrides', () => {
  it('applies saved keys and keeps the rest default', () => {
    const map = parseKeymap({ 'player.mute': ['U'], 'app.search': ['ctrl+f'] });
    expect(map['player.mute']).toEqual(['U']);
    expect(map['app.search']).toEqual(['Ctrl+F']);
    expect(map['player.fullscreen']).toEqual(['F']);
    expect(actionForEvent(map, 'player', press('m'), true)).toBeNull();
    expect(actionForEvent(map, 'player', press('u'), true)).toBe('player.mute');
  });

  it('an empty list leaves an action without a key', () => {
    expect(parseKeymap({ 'player.screenshot': [] })['player.screenshot']).toEqual([]);
  });

  it('drops invalid stored data', () => {
    const defaults = defaultKeymap();
    for (const junk of [null, undefined, 0, 'junk', true, [], [['player.mute', ['U']]], JSON.parse('{"__proto__": {"player.mute": ["U"]}}')]) expect(parseKeymap(junk)).toEqual(defaults);
    const map = parseKeymap({ 'player.nope': ['U'], 'player.mute': 'U', 'player.fit': ['Escape', 'X', 'x', null], 'app.search': ['ArrowLeft', 'Ctrl+F'], 'player.pip': Array(9).fill('Q') });
    expect(map['player.mute']).toEqual(['M']);
    expect(map['player.fit']).toEqual(['X']);
    expect(map['app.search']).toEqual(['Ctrl+F']);
    expect(map['player.pip']).toEqual(['I']);
  });

  it('settles a key saved for two actions: the chosen one wins over a default', () => {
    const map = parseKeymap({ 'player.screenshot': ['M'] });
    expect(map['player.screenshot']).toEqual(['M']);
    expect(map['player.mute']).toEqual([]);
    // Two overrides: the first in the list keeps it.
    const both = parseKeymap({ 'player.mute': ['Q'], 'player.fit': ['Q'] });
    expect(both['player.mute']).toEqual(['Q']);
    expect(both['player.fit']).toEqual([]);
    // Different scopes don't clash.
    expect(parseKeymap({ 'app.search': ['M'] })['player.mute']).toEqual(['M']);
  });
});

describe('Ctrl+K moving from Search to the command palette', () => {
  it('goes to the palette for anyone who never changed Search', () => {
    const map = parseKeymap({ 'player.mute': ['U'] });
    expect(map['app.search']).toEqual(['/']);
    expect(map['app.palette']).toEqual(['Ctrl+K']);
  });

  it('stays with Search when a saved Search override has it; the palette is then without a key', () => {
    const map = parseKeymap({ 'app.search': ['Ctrl+K'] });
    expect(map['app.search']).toEqual(['Ctrl+K']);
    expect(map['app.palette']).toEqual([]);
    expect(actionForEvent(map, 'app', press('k', { ctrlKey: true }))).toBe('app.search');
    // Saved again, both choices last: Search's keys and the palette having none.
    expect(parseKeymap(overrides(map))).toEqual(map);
    expect(parseKeymap({ 'app.search': ['Ctrl+K', '/', 'F3'] })['app.palette']).toEqual([]);
  });

  it('a Search override without Ctrl+K leaves it to the palette', () => {
    const map = parseKeymap({ 'app.search': ['F3'] });
    expect(map['app.search']).toEqual(['F3']);
    expect(map['app.palette']).toEqual(['Ctrl+K']);
  });

  it('both saved with Ctrl+K (only by hand: the Shortcuts page takes a key from its old action), Search keeps it', () => {
    const map = parseKeymap({ 'app.search': ['Ctrl+K'], 'app.palette': ['Ctrl+K'] });
    // Overrides settle in the Shortcuts page's order, so Search (listed first) keeps it; the palette must be given another key.
    expect(map['app.search']).toEqual(['Ctrl+K']);
    expect(map['app.palette']).toEqual([]);
  });
});

describe('editing', () => {
  it('finds conflicts within a scope only', () => {
    const map = defaultKeymap();
    expect(conflictFor(map, 'player.fit', 'M')).toBe('player.mute');
    expect(conflictFor(map, 'app.search', 'M')).toBeNull();
    expect(conflictFor(map, 'player.mute', 'M')).toBeNull();
  });

  it('replaces, adds, takes and swaps', () => {
    const map = defaultKeymap();
    expect(assignKey(map, 'player.mute', 'U', 'replace')['player.mute']).toEqual(['U']);
    expect(assignKey(map, 'player.mute', 'U', 'add')['player.mute']).toEqual(['M', 'U']);
    const taken = assignKey(map, 'player.fit', 'M', 'replace', 'take');
    expect([taken['player.fit'], taken['player.mute']]).toEqual([['M'], []]);
    const swapped = assignKey(map, 'player.fit', 'M', 'replace', 'swap');
    expect([swapped['player.fit'], swapped['player.mute']]).toEqual([['M'], ['Z']]);
    const swappedMany = assignKey(map, 'player.play-pause', 'M', 'replace', 'swap');
    expect([swappedMany['player.play-pause'], swappedMany['player.mute']]).toEqual([['M'], ['Space', 'K']]);
    // Saved and read back, an edit survives.
    expect(parseKeymap(overrides(swapped))).toEqual(swapped);
  });

  it('caps a swap at four keys, so it survives being saved and read back', () => {
    let map = defaultKeymap();
    for (const key of ['Q', 'W']) map = assignKey(map, 'player.play-pause', key, 'add');
    for (const key of ['U', 'Y']) map = assignKey(map, 'player.seek-back', key, 'add');
    const swapped = assignKey(map, 'player.seek-back', 'Space', 'replace', 'swap');
    expect(swapped['player.play-pause'].length).toBeLessThanOrEqual(4);
    expect(parseKeymap(overrides(swapped))).toEqual(swapped);
  });

  it('resets one action, taking back its keys', () => {
    const edited = assignKey(assignKey(defaultKeymap(), 'player.mute', 'U', 'replace'), 'player.fit', 'M', 'replace');
    const { map, took } = resetAction(edited, 'player.mute');
    expect(map['player.mute']).toEqual(['M']);
    expect(map['player.fit']).toEqual([]);
    expect(took).toEqual([{ key: 'M', from: 'player.fit' }]);
  });
});

describe('keys kept for editing text and menus', () => {
  // Shift+F10 / the menu key open context menus (components/menu.ts), Ctrl+Z/Y undo in Theme Studio,
  // Ctrl+↑/↓ jump groups in the command palette's field, and the clipboard keys are every text field's.
  const kept = ['ContextMenu', 'Shift+F10', 'Ctrl+ArrowUp', 'Ctrl+ArrowDown', 'Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z'];
  // Moving and selecting by word or to the ends, deleting a word, and pasting as plain text.
  const textKeys = ['Ctrl+ArrowLeft', 'Ctrl+ArrowRight', 'Ctrl+Shift+ArrowLeft', 'Ctrl+Shift+ArrowRight', 'Ctrl+Home', 'Ctrl+End', 'Ctrl+Shift+Home', 'Ctrl+Shift+End', 'Ctrl+Backspace', 'Ctrl+Delete', 'Ctrl+Shift+V'];

  it('include the text fields’ word and paste keys', () => {
    for (const combo of textKeys) expect([combo, isReserved('app', combo)]).toEqual([combo, true]);
    expect(parseSavedKeymap({ 'app.search': ['Ctrl+Shift+V'] }).reset).toEqual(['app.search']);
    expect(isReserved('player', 'Ctrl+ArrowLeft')).toBe(false);
  });

  it('are refused for an app action', () => {
    for (const combo of kept) expect([combo, isReserved('app', combo)]).toEqual([combo, true]);
  });

  it('stay free in the player, and their neighbours stay free outside it', () => {
    expect(isReserved('player', 'Ctrl+Z')).toBe(false);
    expect(['Ctrl+B', 'Alt+ArrowDown', 'Shift+F9', 'Ctrl+Shift+A'].map((c) => isReserved('app', c))).toEqual([false, false, false, false]);
  });

  it('put an action saved on one back to its defaults, and say which', () => {
    const { map, reset } = parseSavedKeymap({ 'app.search': ['Ctrl+ArrowDown'], 'app.settings': ['Ctrl+,', 'Ctrl+Z'], 'app.shortcuts': ['F1'] });
    expect(reset).toEqual(['app.search', 'app.settings']);
    expect([map['app.search'], map['app.settings'], map['app.shortcuts']]).toEqual([['/'], ['Ctrl+,'], ['F1']]);
  });

  it('an action put back whose default keys another shortcut took keeps what is free, else is named as keyless', () => {
    // Search's default "/" is now Settings'.
    const taken = parseSavedKeymap({ 'app.search': ['Ctrl+C'], 'app.settings': ['/'] });
    expect(taken.reset).toEqual([]);
    expect(taken.keyless).toEqual(['app.search']);
    expect(taken.map['app.search']).toEqual([]);
    expect(taken.map['app.settings']).toEqual(['/']);
    const still = parseSavedKeymap({ 'app.search': ['Ctrl+C'], 'app.settings': ['Ctrl+,'] });
    expect([still.reset, still.keyless, still.map['app.search']]).toEqual([['app.search'], [], ['/']]);
  });

  it('a player action on Ctrl+Z is not touched', () => {
    const { map, reset } = parseSavedKeymap({ 'player.mute': ['Ctrl+Z'] });
    expect(reset).toEqual([]);
    expect(map['player.mute']).toEqual(['Ctrl+Z']);
  });

  it('older reserved keys and junk are still dropped quietly', () => {
    expect(parseKeymap({ 'app.search': 'K' })).toEqual(defaultKeymap());
    expect(parseKeymap([1, 2])).toEqual(defaultKeymap());
    expect(parseSavedKeymap({ 'app.search': ['Escape'] })).toEqual({ map: { ...defaultKeymap(), 'app.search': [] }, reset: [], keyless: [] });
  });

  it('loading saves the reset at once, so it is reported only the first time', async () => {
    saved.set(KEYMAP_KEY, { 'app.palette': ['Ctrl+C'], 'app.search': ['F2'] });
    expect(await loadKeymap()).toEqual({ reset: ['app.palette'], keyless: [] });
    expect(keymap()['app.palette']).toEqual(['Ctrl+K']);
    expect(saved.get(KEYMAP_KEY)).toEqual({ 'app.search': ['F2'] });
    expect(await loadKeymap()).toEqual({ reset: [], keyless: [] });
    expect(keymap()['app.search']).toEqual(['F2']);
  });
});

describe('undo and redo keys (Theme Studio)', () => {
  it('are Ctrl+Z, and Ctrl+Y or Ctrl+Shift+Z, on any layout', () => {
    expect(undoRedo(press('z', { code: 'KeyZ', ctrlKey: true }))).toBe('undo');
    expect(undoRedo(press('y', { code: 'KeyY', ctrlKey: true }))).toBe('redo');
    expect(undoRedo(press('Z', { code: 'KeyZ', ctrlKey: true, shiftKey: true }))).toBe('redo');
    // Russian: the Z key types "я", Y "н".
    expect(undoRedo(press('я', { code: 'KeyZ', ctrlKey: true }))).toBe('undo');
    expect(undoRedo(press('н', { code: 'KeyY', ctrlKey: true }))).toBe('redo');
    // German QWERTZ: Z is where Y is on a US keyboard, and goes by the letter.
    expect(undoRedo(press('z', { code: 'KeyY', ctrlKey: true }))).toBe('undo');
    // Not without Ctrl, nor with AltGr (which types characters).
    expect(undoRedo(press('z', { code: 'KeyZ' }))).toBeNull();
    expect(undoRedo({ ...press('z', { code: 'KeyZ', ctrlKey: true, altKey: true }), getModifierState: (m) => m === 'AltGraph' })).toBeNull();
    expect(undoRedo(press('z', { code: 'KeyZ', ctrlKey: true, altKey: true }))).toBeNull();
  });
});
