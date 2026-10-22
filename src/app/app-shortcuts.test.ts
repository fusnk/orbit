import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { appShortcut } from './app-shortcuts';

vi.mock('../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));

const press = (key: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, defaultPrevented: false, target: null, ...extra }) as KeyboardEvent;

describe('app shortcuts', () => {
  beforeAll(() => {
    // Node has no DOM: just enough for isEditing's instanceof checks.
    class Fake {}
    vi.stubGlobal('HTMLElement', Fake);
    vi.stubGlobal('HTMLInputElement', Fake);
    vi.stubGlobal('HTMLTextAreaElement', Fake);
  });
  afterAll(() => vi.unstubAllGlobals());

  it('find the action a key press is', () => {
    expect(appShortcut(press('/'))).toBe('app.search');
    expect(appShortcut(press('k', { ctrlKey: true }))).toBe('app.palette');
  });

  it('ignore a held key, so Ctrl+K held doesn’t flicker the palette open and shut', () => {
    expect(appShortcut(press('k', { ctrlKey: true, repeat: true }))).toBeNull();
    expect(appShortcut(press('/', { repeat: true }))).toBeNull();
  });

  it('ignore a key something else handled', () => {
    expect(appShortcut(press('/', { defaultPrevented: true }))).toBeNull();
  });
});
