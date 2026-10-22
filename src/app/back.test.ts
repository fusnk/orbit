import { beforeAll, describe, expect, it, vi } from 'vitest';

// Tests run without a DOM: the page is one EventTarget standing in for document and body.
class FakeKeyboardEvent extends Event {
  readonly key: string;
  readonly repeat = false;
  readonly isComposing: boolean;
  constructor(type: string, init: KeyboardEventInit) {
    super(type, init);
    this.key = init.key ?? '';
    this.isComposing = init.isComposing ?? false;
  }
}
const page = Object.assign(new EventTarget(), { activeElement: null, body: null as unknown });
page.body = page;

beforeAll(() => {
  vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent);
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', page);
  vi.stubGlobal('window', new EventTarget());
});

const { androidBack, installBackHandling, onBack } = await import('./back');

// Installed once for the whole file (as the app does at startup), so each test works in any order.
let pages = 0;
beforeAll(() => installBackHandling(() => (pages > 0 ? (pages--, true) : false)));

describe("Android's Back button", () => {

  it('closes what is open first, then goes back through pages, then lets Android leave', () => {
    pages = 1;
    const close = vi.fn();
    const off = onBack(close);
    expect(androidBack()).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    off();
    expect(androidBack()).toBe(true);
    expect(pages).toBe(0);
    expect(androidBack()).toBe(false);
  });
});

describe('Escape while an input method is composing', () => {
  it("cancels the input method's candidates, not the page or what is open", () => {
    const close = vi.fn();
    const off = onBack(close);
    page.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }));
    expect(close).not.toHaveBeenCalled();
    page.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
    off();
  });
});
