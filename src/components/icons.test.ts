import { afterEach, describe, expect, it, vi } from 'vitest';
import { showIcon } from './icons';

/** Just enough of the DOM for icons: elements with attributes and children. */
class FakeElement {
  childNodes: FakeElement[] = [];
  attributes = new Map<string, string>();
  get firstChild(): FakeElement | null {
    return this.childNodes[0] ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...nodes: FakeElement[]): void {
    this.childNodes.push(...nodes);
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.childNodes = nodes;
  }
}

describe('showIcon', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds an icon only when the one shown changes', () => {
    const create = vi.fn(() => new FakeElement());
    vi.stubGlobal('document', { createElementNS: create });
    const button = new FakeElement() as unknown as Element;

    showIcon(button, 'play', { filled: true });
    const first = button.firstChild;
    const built = create.mock.calls.length;
    // A status redraw with nothing changed keeps the same icon.
    showIcon(button, 'play', { filled: true });
    expect(button.firstChild).toBe(first);
    expect(create.mock.calls.length).toBe(built);

    showIcon(button, 'pause', { filled: true });
    expect(button.firstChild).not.toBe(first);
    expect(button.childNodes).toHaveLength(1);
  });

  it('draws it again when something else replaced the contents', () => {
    vi.stubGlobal('document', { createElementNS: () => new FakeElement() });
    const button = new FakeElement() as unknown as Element;
    showIcon(button, 'play');
    button.replaceChildren();
    showIcon(button, 'play');
    expect(button.childNodes).toHaveLength(1);
  });
});
