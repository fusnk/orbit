import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Title } from '../../catalog/titles';
import type { PlayRequest } from './index';

/** Just enough of an element for the bridge's layer and its parent. */
class FakeEl {
  children: (FakeEl | string)[] = [];
  parentElement: FakeEl | null = null;
  offsetWidth = 0;
  classes = new Set<string>();
  classList = {
    add: (...names: string[]) => names.forEach((n) => this.classes.add(n)),
    remove: (...names: string[]) => names.forEach((n) => this.classes.delete(n)),
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, on?: boolean) => void ((on ?? !this.classes.has(name)) ? this.classes.add(name) : this.classes.delete(name)),
  };
  setAttribute(name: string, value: string): void {
    if (name === 'class') value.split(' ').forEach((c) => this.classes.add(c));
  }
  append(...nodes: (FakeEl | string)[]): void {
    for (const node of nodes) {
      if (typeof node !== 'string') node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: (FakeEl | string)[]): void {
    this.children = [];
    this.append(...nodes);
  }
}

vi.mock('../../components/cards', () => ({ artImage: () => new FakeEl() }));
vi.mock('../../components/title-logo', () => ({ titleHeading: () => new FakeEl() }));
vi.mock('../../library/spoilers', () => ({ hiddenFor: () => ({ thumbnail: false, title: false }), episodeName: (_n: number, title: string) => title }));
vi.mock('../../library/watch', () => ({ episodeState: () => ({ kind: 'watched' }) }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../lib/dom', () => ({
  h: (_tag: string, attrs: Record<string, string> = {}, ...children: (FakeEl | string)[]) => {
    const el = new FakeEl();
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    el.append(...children);
    return el;
  },
}));
vi.mock('../../lib/platform', () => ({ isAndroid: false }));
vi.mock('../../theme/appearance', () => ({ reducedMotion: () => false, effectsReduced: () => false }));
vi.mock('./next-up-bridge.css', () => ({}));

const { createNextUpBridge } = await import('./next-up-bridge');

const show = { id: 'tt1', type: 'series', name: 'Show', genres: [], origins: [], background: 'https://img.test/bg.jpg' } as unknown as Title;
const next = { title: show, episode: { season: 1, episode: { id: 'tt1:1:2', number: 2, title: 'Two' } } } as unknown as PlayRequest;

describe('the Next Up bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function setup() {
    const bridge = createNextUpBridge();
    const player = new FakeEl();
    const element = bridge.element as unknown as FakeEl;
    player.append(element);
    return { bridge, player, element };
  }

  it('covers the player with the still until the next episode shows, giving up only after 6 s', () => {
    const { bridge, player, element } = setup();
    bridge.begin(next, false);
    expect(element.classes.has('on')).toBe(true);
    expect(player.classes.has('bridging')).toBe(true);
    vi.advanceTimersByTime(5999);
    expect(element.classes.has('on')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(element.classes.has('on')).toBe(false);
    expect(player.classes.has('bridging')).toBe(false);
  });

  it("is gone at once when cancelled (the next episode refused by the profile's limit, an error, a resume question)", () => {
    const { bridge, player, element } = setup();
    bridge.begin(next, false);
    bridge.cancel();
    expect(element.classes.has('on')).toBe(false);
    expect(element.classes.has('leaving')).toBe(false);
    expect(player.classes.has('bridging')).toBe(false);
    expect(element.children.every((c) => typeof c === 'string' || !c.children.length)).toBe(true);
    // Nothing of the hand-off runs on later.
    vi.advanceTimersByTime(10_000);
    expect(element.classes.has('on')).toBe(false);
    expect(player.classes.has('bridging')).toBe(false);
  });
});
