import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayers, wrapTab } from './layers';

const el = () => ({ inert: false });

describe('modal layers', () => {
  it('keeps the app inert until the last layer closes', () => {
    const app = el();
    const layers = createLayers(() => app);
    const drawer = el();
    const removeDrawer = layers.push(drawer, () => {});
    const menu = el();
    const removeMenu = layers.push(menu, () => {});
    expect(app.inert).toBe(true);
    // Only the menu on top is interactive.
    expect(drawer.inert).toBe(true);
    expect(menu.inert).toBe(false);

    removeMenu();
    // The drawer is still open: the page behind must stay inert.
    expect(app.inert).toBe(true);
    expect(drawer.inert).toBe(false);

    removeDrawer();
    expect(app.inert).toBe(false);
  });

  it('copes with layers closing out of order', () => {
    const app = el();
    const layers = createLayers(() => app);
    const a = el();
    const b = el();
    const removeA = layers.push(a, () => {});
    const removeB = layers.push(b, () => {});
    removeA();
    removeA();
    expect(a.inert).toBe(false);
    expect(b.inert).toBe(false);
    expect(app.inert).toBe(true);
    removeB();
    expect(app.inert).toBe(false);
  });

  it('closes every layer, topmost first', () => {
    const layers = createLayers(() => el());
    const order: string[] = [];
    const removeA = layers.push(el(), () => (order.push('drawer'), removeA()));
    const removeB = layers.push(el(), () => (order.push('menu'), removeB()));
    layers.closeAll();
    expect(order).toEqual(['menu', 'drawer']);
  });

  it('leaves a layer only its own controls end (first-run setup) open when the page changes', () => {
    const app = el();
    const layers = createLayers(() => app);
    const setup = el();
    const removeSetup = layers.push(setup, null);
    const menu = el();
    let menuOpen = true;
    const removeMenu = layers.push(menu, () => ((menuOpen = false), removeMenu()));
    layers.closeAll();
    expect(menuOpen).toBe(false);
    // Setup is still there, on top and interactive, with the app behind it inert.
    expect(setup.inert).toBe(false);
    expect(app.inert).toBe(true);
    removeSetup();
    expect(app.inert).toBe(false);
  });
});

describe('Tab in a layer', () => {
  /** A layer of three buttons (the middle one hidden), with `document.activeElement` following focus. */
  function setup() {
    const doc = { activeElement: null as unknown };
    vi.stubGlobal('document', doc);
    const button = (shown: boolean) => {
      const b = { disabled: false, getClientRects: () => (shown ? [{}] : []), focus: () => (doc.activeElement = b) };
      return b;
    };
    const buttons = [button(true), button(false), button(true)];
    const layer = { querySelectorAll: () => buttons, contains: (el: unknown) => el === layer || buttons.includes(el as never) };
    const press = (shiftKey = false) => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Tab', shiftKey, ctrlKey: false, altKey: false, metaKey: false });
      wrapTab(layer as unknown as HTMLElement, event as unknown as KeyboardEvent);
      return event.defaultPrevented;
    };
    return { doc, layer, buttons, press };
  }
  afterEach(() => vi.unstubAllGlobals());

  it('wraps past the last control to the first, and back with Shift+Tab', () => {
    const { doc, buttons, press } = setup();
    buttons[2]!.focus();
    expect(press()).toBe(true);
    expect(doc.activeElement).toBe(buttons[0]);
    expect(press(true)).toBe(true);
    expect(doc.activeElement).toBe(buttons[2]);
  });

  it('leaves Tab between controls to the browser', () => {
    const { doc, buttons, press } = setup();
    buttons[0]!.focus();
    expect(press()).toBe(false);
    expect(doc.activeElement).toBe(buttons[0]);
  });

  it('takes Tab on the layer itself to its first control', () => {
    const { doc, layer, buttons, press } = setup();
    doc.activeElement = layer;
    expect(press()).toBe(true);
    expect(doc.activeElement).toBe(buttons[0]);
  });

  it('brings focus that fell out of the layer (onto the page) back into it', () => {
    const { doc, buttons, press } = setup();
    doc.activeElement = { tagName: 'BODY' };
    expect(press()).toBe(true);
    expect(doc.activeElement).toBe(buttons[0]);
    doc.activeElement = { tagName: 'BODY' };
    expect(press(true)).toBe(true);
    expect(doc.activeElement).toBe(buttons[2]);
  });
});
