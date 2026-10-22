import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { KeyTarget } from './keys';

// The handler reads the focused element; tests run without a DOM.
beforeAll(() => {
  vi.stubGlobal('Node', class {});
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  vi.stubGlobal('document', { activeElement: null, body: {} });
});

vi.mock('../../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));

const { playerKeyHandler, timingNote } = await import('./keys');
const { assignKey, keymap, saveKeymap } = await import('../../lib/keymap');

function target(): KeyTarget & { seeks: number[] } {
  const seeks: number[] = [];
  return new Proxy({ seeks } as KeyTarget & { seeks: number[] }, {
    get: (obj, prop) => {
      if (prop === 'seeks') return seeks;
      if (prop === 'regions' || prop === 'controls') return [];
      if (prop === 'seekStep') return () => 10;
      if (prop === 'seekBy') return (s: number) => seeks.push(s);
      // Number keys jump; recorded with the seeks, as tenths.
      if (prop === 'jumpTo') return (f: number) => (seeks.push(f * 10), true);
      if (prop === 'closed' || prop === 'asking' || prop === 'panelOpen') return () => false;
      return obj[prop as keyof typeof obj] ?? (() => {});
    },
  });
}

const press = (key: string, repeat = false, code = '', shiftKey = false) =>
  ({ key, code, repeat, ctrlKey: false, altKey: false, metaKey: false, shiftKey, target: document.body, preventDefault() {}, stopPropagation() {} }) as unknown as KeyboardEvent;

describe('TV remote keys in the player', () => {
  it('fast-forward and rewind jump by the seek step, held or not', () => {
    const p = target();
    const handle = playerKeyHandler(p);
    handle(press('MediaFastForward'));
    handle(press('MediaFastForward', true));
    handle(press('MediaRewind'));
    expect(p.seeks).toEqual([10, 10, -10]);
  });
});

describe('Enter in the player', () => {
  it('reaches the controls when nothing is focused (a remote or gamepad has no Tab), and is a focused control’s own otherwise', () => {
    const focused: string[] = [];
    const p = Object.assign(target(), { toggle: { focus: () => focused.push('toggle') }, panel: { contains: () => false } }) as unknown as KeyTarget;
    const handle = playerKeyHandler(p);
    handle(press('Enter'));
    expect(focused).toEqual(['toggle']);
    vi.stubGlobal('document', { activeElement: { focused: 'a button' }, body: {} });
    try {
      handle(press('Enter'));
    } finally {
      vi.stubGlobal('document', { activeElement: null, body: {} });
    }
    expect(focused).toEqual(['toggle']);
  });
});

describe('Enter while the controls are hidden', () => {
  it('brings them back instead of pressing the focused button nobody can see', () => {
    const shown: string[] = [];
    const button = { focused: 'Next episode' };
    const bar = { contains: (el: unknown) => el === button };
    const base = { bar, top: { contains: () => false }, panel: { contains: () => false }, showControls: () => shown.push('shown') };
    vi.stubGlobal('document', { activeElement: button, body: {} });
    try {
      let prevented = 0;
      const enter = { ...press('Enter'), preventDefault: () => prevented++ } as unknown as KeyboardEvent;
      playerKeyHandler(Object.assign(target(), base, { controlsHidden: () => true }) as unknown as KeyTarget)(enter);
      expect(shown).toEqual(['shown']);
      expect(prevented).toBe(1);
      // Shown: Enter is the button's own (the browser presses it).
      playerKeyHandler(Object.assign(target(), base, { controlsHidden: () => false }) as unknown as KeyTarget)(enter);
      expect(prevented).toBe(1);
    } finally {
      vi.stubGlobal('document', { activeElement: null, body: {} });
    }
  });
});

describe('number keys in the player', () => {
  it('jump on any layout: AZERTY and Czech type other characters on the number row without Shift', () => {
    const p = target();
    const handle = playerKeyHandler(p);
    handle(press('3', false, 'Digit3'));
    // AZERTY: the 1 key types "&", Shift+1 types "1"; Czech: the 2 key types "ě".
    handle(press('&', false, 'Digit1'));
    handle(press('1', false, 'Digit1', true));
    handle(press('ě', false, 'Digit2'));
    // US: Shift+1 is "!", not a jump.
    handle(press('!', false, 'Digit1', true));
    expect(p.seeks).toEqual([3, 1, 1, 2]);
  });
});

describe('Backspace in the player', () => {
  it('closes an overlay (the shortcut list) as Esc does, rather than leaving the player behind it', () => {
    let overlay = true;
    const claimed: string[] = [];
    const p = Object.assign(target(), { dismiss: () => (overlay ? ((overlay = false), true) : false) }) as unknown as KeyTarget;
    const handle = playerKeyHandler(p);
    const backspace = { ...press('Backspace'), preventDefault: () => claimed.push('Backspace') } as unknown as KeyboardEvent;
    handle(backspace);
    expect(overlay).toBe(false);
    // Claimed, so the app's Back (leaving the player) doesn't run too.
    expect(claimed).toEqual(['Backspace']);
    // With nothing left to close, it's the app's Back again.
    handle(backspace);
    expect(claimed).toEqual(['Backspace']);
  });
});

describe('the timing view', () => {
  it('names the timing keys as they’re mapped now, and says nothing of a key that’s gone', async () => {
    expect(timingNote()).toBe('For releases that are out of sync. G and H move subtitles; Shift+G and Shift+H move audio.');
    await saveKeymap(assignKey(keymap(), 'player.sub-earlier', 'Y', 'replace'));
    expect(timingNote()).toContain('Y and H move subtitles');
    await saveKeymap({ ...keymap(), 'player.audio-later': [] });
    expect(timingNote()).toBeNull();
  });
});
