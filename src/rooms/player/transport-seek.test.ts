import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportStatus } from './transport';

/** Just enough of an element for the transport: attributes, classes, styles, children and events. */
class FakeElement extends EventTarget {
  attrs = new Map<string, string>();
  children: unknown[] = [];
  classes = new Set<string>();
  props = new Map<string, string>();
  dataset: Record<string, string> = {};
  textContent = '';
  title = '';
  hidden = false;
  value = '';
  max = '';
  disabled = false;
  offsetWidth = 100;
  captured: number[] = [];
  classList = {
    add: (...names: string[]) => names.forEach((n) => this.classes.add(n)),
    remove: (...names: string[]) => names.forEach((n) => this.classes.delete(n)),
    toggle: (name: string, on?: boolean) => ((on ?? !this.classes.has(name)) ? this.classes.add(name) : this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  };
  style = {
    setProperty: (name: string, value: string) => void this.props.set(name, value),
    getPropertyValue: (name: string) => this.props.get(name) ?? '',
  };
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  append(...nodes: unknown[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: unknown[]) {
    this.children = nodes;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1000, height: 10 };
  }
  setPointerCapture(id: number) {
    this.captured.push(id);
  }
  matches() {
    return false;
  }
  getContext() {
    return null;
  }
}

vi.mock('../../lib/dom', () => ({
  h: (_tag: string, attrs: Record<string, string | boolean> = {}, ...children: unknown[]) => {
    const el = new FakeElement();
    for (const [name, value] of Object.entries(attrs)) {
      if (name === 'class') String(value).split(' ').forEach((c) => el.classes.add(c));
      else if (name === 'hidden') el.hidden = value === true;
      else if (value !== false) el.setAttribute(name, value === true ? '' : value);
    }
    el.append(...children);
    return el;
  },
}));
vi.mock('../../components/icons', () => ({ icon: () => new FakeElement(), showIcon: () => {} }));
vi.mock('./keys', () => ({ withKey: (label: string) => label }));

vi.stubGlobal('document', { activeElement: null, documentElement: { clientWidth: 1000 } });
vi.stubGlobal('window', globalThis);

const { createTransport } = await import('./transport');

function setup(over: Partial<TransportStatus> = {}) {
  const status: TransportStatus = { timePos: 600, duration: 1200, paused: false, volume: 100, muted: false, cacheTime: null, speed: 1, passthrough: false, ...over };
  const seeks: number[] = [];
  const transport = createTransport({
    status: () => status,
    setPaused: (paused) => void (status.paused = paused),
    seekBy: () => {},
    seekTo: (seconds) => void seeks.push(seconds),
    setMuted: () => {},
    setVolume: () => {},
    segments: () => [],
    timeModeChanged: () => {},
  });
  const row = transport.seekRow as unknown as FakeElement;
  const bar = row.children[0] as FakeElement;
  const time = row.children[1] as FakeElement;
  const pointer = (type: string, clientX: number, button = 0) => bar.dispatchEvent(Object.assign(new Event(type), { clientX, button, pointerId: 1 }));
  return { status, seeks, transport, bar, time, pointer };
}

describe('the seek bar', () => {
  it('jumps where it is clicked and let go', () => {
    const { seeks, pointer } = setup();
    pointer('pointerdown', 250);
    pointer('pointerup', 250);
    expect(seeks).toEqual([300]);
  });

  it('does not jump for a right or middle click (only the main button seeks)', () => {
    const { seeks, transport, pointer } = setup();
    for (const button of [1, 2]) {
      pointer('pointerdown', 250, button);
      expect(transport.dragging()).toBe(false);
      pointer('pointerup', 250, button);
    }
    expect(seeks).toEqual([]);
  });
});

describe('the time readout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 22, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('moves the finish time on while paused, though mpv reports nothing then', () => {
    const { transport, time } = setup({ paused: true });
    transport.setTimeMode('finish');
    expect(time.textContent).toContain('10:10 PM');
    // Paused for ten minutes: the film now finishes ten minutes later.
    vi.advanceTimersByTime(10 * 60_000);
    expect(time.textContent).toContain('10:20 PM');
    transport.dispose();
  });

  it('stops following the clock in another mode, or once closed', () => {
    const { transport } = setup({ paused: true });
    transport.setTimeMode('finish');
    transport.setTimeMode('remaining');
    expect(vi.getTimerCount()).toBe(0);
    transport.setTimeMode('finish');
    transport.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
