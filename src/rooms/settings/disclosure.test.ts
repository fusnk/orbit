import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/icons', () => ({ icon: () => 'icon' }));

import { disclosure, showSection } from './disclosure';

/** Just enough of an element for a disclosure: attributes, children, `closest` by class. */
class FakeEl extends EventTarget {
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  hidden = false;
  focused = false;
  scrolled = false;
  constructor(readonly tag: string) {
    super();
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  append(...nodes: (FakeEl | string)[]): void {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      node.parent = this;
      this.children.push(node);
    }
  }
  contains(other: FakeEl): boolean {
    for (let el: FakeEl | null = other; el; el = el.parent) if (el === this) return true;
    return false;
  }
  closest(selector: string): FakeEl | null {
    const name = selector.replace(/^\./, '');
    if ((this.attrs.class ?? '').split(' ').includes(name)) return this;
    return this.parent?.closest(selector) ?? null;
  }
  focus(): void {
    this.focused = true;
  }
  scrollIntoView(): void {
    this.scrolled = true;
  }
}

describe('a section under a "More …" disclosure', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is opened, scrolled to and focused when the palette or Quick settings sends the person there', () => {
    vi.stubGlobal('document', { createElement: (tag: string) => new FakeEl(tag) });
    const section = new FakeEl('div');
    section.setAttribute('class', 'connect-section');
    const pair = new FakeEl('button');
    section.append(pair);
    const more = disclosure('general-test', 'More general settings', [section as unknown as HTMLElement]) as unknown as FakeEl;
    const region = more.children.find((el) => el.attrs.role === 'region')!;
    expect(region.hidden).toBe(true);

    showSection(pair as unknown as HTMLElement, '.connect-section');
    expect(region.hidden).toBe(false);
    expect(section.scrolled).toBe(true);
    expect(pair.focused).toBe(true);
  });
});
