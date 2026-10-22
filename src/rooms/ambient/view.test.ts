import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Title } from '../../catalog/titles';
import type { Slide } from './slides';

/** Just enough of an element for the ambient view: children, classes, data, styles, and an image's decode. */
class FakeEl {
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classes = new Set<string>();
  src = '';
  alt = '';
  style = { setProperty() {}, getPropertyValue: () => '', strokeDashoffset: '' };
  classList = {
    toggle: (name: string, on?: boolean) => void ((on ?? !this.classes.has(name)) ? this.classes.add(name) : this.classes.delete(name)),
    add: (name: string) => void this.classes.add(name),
  };
  constructor(readonly tag: string) {}
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
    if (name === 'class') value.split(' ').forEach((c) => this.classes.add(c));
  }
  append(...nodes: (FakeEl | string)[]): void {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: (FakeEl | string)[]): void {
    this.children = [];
    this.append(...nodes);
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  querySelector(selector: string): FakeEl | null {
    const name = selector.replace(/^\./, '');
    for (const child of this.children) {
      if (child.classes.has(name)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  getAnimations(): Animation[] {
    return [];
  }
  /** The decode each image's src is answered with (see `pictures`). */
  decode(): Promise<void> {
    return pictures.get(this.src) ?? Promise.resolve();
  }
}
const pictures = new Map<string, Promise<void>>();

vi.mock('../../lib/dom', () => ({
  h: (tag: string, attrs: Record<string, string> = {}, ...children: (FakeEl | string)[]) => {
    const el = new FakeEl(tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    el.append(...children);
    return el;
  },
}));
vi.mock('../../i18n', () => ({ locale: () => 'en', t: (key: string) => key }));
vi.mock('../../lib/clock', () => ({ clockFormat: () => ({}), formatClock: () => '' }));
vi.mock('../../theme/appearance', () => ({ appearance: () => ({ logos: false }) }));

const { createAmbientView } = await import('./view');

const slide = (id: string): Slide => ({
  kind: 'trending',
  title: { id, type: 'movie', name: id, genres: [], origins: [], background: `https://img.example/${id}.jpg` } as Title,
});
const byClass = (root: FakeEl, name: string): FakeEl[] => [...(root.classes.has(name) ? [root] : []), ...root.children.flatMap((c) => byClass(c, name))];
const stageOf = (view: ReturnType<typeof createAmbientView>) => byClass(view.element as unknown as FakeEl, 'ambient-stage')[0]!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { createElementNS: (_ns: string, tag: string) => new FakeEl(tag) });
  pictures.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ambient view', () => {
  it('puts each slide’s scrim between its picture and its caption, so it shades under the type', async () => {
    const view = createAmbientView({ clock: false, details: true, still: false });
    await view.start(Promise.resolve([slide('a')]));
    const [shown] = stageOf(view).children;
    expect(shown!.children.map((c) => c.attrs.class)).toEqual(['ambient-frame', 'ambient-scrim', 'ambient-caption']);
  });

  it('marks the room as having a clock only when it shows one (the scrim shades its corner)', () => {
    expect((createAmbientView({ clock: true, details: true, still: false }).element as unknown as FakeEl).classes.has('with-clock')).toBe(true);
    expect((createAmbientView({ clock: false, details: true, still: false }).element as unknown as FakeEl).classes.has('with-clock')).toBe(false);
  });

  it('hidden and shown while the next picture loads, it still advances once and keeps the slide on screen', async () => {
    let arrive!: () => void;
    pictures.set('https://img.example/b.jpg', new Promise<void>((resolve) => (arrive = resolve)));
    const view = createAmbientView({ clock: false, details: true, still: false });
    await view.start(Promise.resolve([slide('a'), slide('b'), slide('c')]));
    expect(view.slide()?.title.id).toBe('a');

    // Time for the next slide, but b is still loading; the window is hidden and shown meanwhile.
    await vi.advanceTimersByTimeAsync(14_000);
    view.hold(true);
    view.hold(false);
    arrive();
    await vi.advanceTimersByTimeAsync(0);
    expect(view.slide()?.title.id).toBe('b');

    // One timer, so one advance: c arrives and stays on screen after the fade.
    await vi.advanceTimersByTimeAsync(14_000 + 5_000);
    expect(view.slide()?.title.id).toBe('c');
    // A second advance would present c again and then take it down as "the old picture".
    expect(stageOf(view).children).toHaveLength(1);
    view.close();
  });
});
