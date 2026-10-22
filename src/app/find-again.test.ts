import { describe, expect, it, vi } from 'vitest';

vi.mock('./errors', () => ({ pageError: () => null, reportError: () => {} }));
vi.mock('../theme/appearance', () => ({ reducedMotion: () => true }));
vi.mock('./spatial', () => ({ onScreen: () => true }));
vi.mock('../components/layers', () => ({ closeLayers: () => {} }));
vi.stubGlobal('CSS', { escape: (s: string) => s });

// Tests run without a DOM: a tree of elements, each with its data attributes.
class FakeEl {
  parentElement: FakeEl | null = null;
  kids: FakeEl[] = [];
  constructor(public dataset: Record<string, string> = {}) {}
  add(...kids: FakeEl[]): this {
    for (const kid of kids) kid.parentElement = this;
    this.kids.push(...kids);
    return this;
  }
  get isConnected(): boolean {
    return this.parentElement ? this.parentElement.isConnected : this.dataset.root === 'page';
  }
  /** `[data-focus-scope]` or `[data-x="value"]` only. */
  private test(selector: string): boolean {
    const [, attr, value] = /^\[data-([\w-]+)(?:="(.*)")?\]$/.exec(selector)!;
    const key = attr!.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    return value === undefined ? key in this.dataset : this.dataset[key] === value;
  }
  closest(selector: string): FakeEl | null {
    return this.test(selector) ? this : (this.parentElement?.closest(selector) ?? null);
  }
  querySelector(selector: string): FakeEl | null {
    for (const kid of this.kids) {
      const found = kid.test(selector) ? kid : kid.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

const { findAgain } = await import('./router');

const card = (id: string) => new FakeEl({ focusId: `poster:${id}` });
const row = (scope: string, ...cards: FakeEl[]) => new FakeEl({ focusScope: scope }).add(new FakeEl().add(...cards));
const as = (el: FakeEl) => el as unknown as HTMLElement;

describe('finding the control that had focus again, after Back', () => {
  it('finds the card in the row it was in, when the same title is in an earlier row', () => {
    const left = card('tt1');
    row('row:mood', left);
    // The row was drawn again while away; Trending above it shows the same title.
    const trending = card('tt1');
    const again = card('tt1');
    const view = new FakeEl({ root: 'page' }).add(row('row:trending', trending), row('row:mood', again));
    expect(findAgain(as(view), as(left))).toBe(again);
  });

  it('narrows from the outer row to the rail inside it', () => {
    const left = card('tt1');
    new FakeEl({ focusScope: 'row:for-you' }).add(row('rail:Because you watched Heat', left));
    const first = card('tt1');
    const again = card('tt1');
    const view = new FakeEl({ root: 'page' }).add(new FakeEl({ focusScope: 'row:for-you' }).add(row('rail:Because you watched Alien', first), row('rail:Because you watched Heat', again)));
    expect(findAgain(as(view), as(left))).toBe(again);
  });

  it('keeps a card still on the page, and finds one by its id alone when its row is gone', () => {
    const view = new FakeEl({ root: 'page' });
    const shown = card('tt1');
    view.add(row('row:a', shown));
    expect(findAgain(as(view), as(shown))).toBe(shown);
    const left = card('tt2');
    row('row:gone', left);
    const elsewhere = card('tt2');
    view.add(row('row:b', elsewhere));
    expect(findAgain(as(view), as(left))).toBe(elsewhere);
    expect(findAgain(as(view), as(new FakeEl()))).toBeNull();
  });
});
