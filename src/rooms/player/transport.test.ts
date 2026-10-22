import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { TransportStatus } from './transport';

// Tests run without a DOM: just enough of an element for the transport to build and draw itself.
class FakeElement extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  readonly style = { setProperty() {}, getPropertyValue: () => '' };
  value = '';
  max = '';
  title = '';
  hidden = false;
  textContent = '';
  /** Whether the pointer is pressed on it (`:active`). */
  pressed = false;
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  append() {}
  replaceChildren() {}
  matches(selector: string) {
    return selector === ':active' && this.pressed;
  }
}
const page = { activeElement: null as unknown, createElement: () => new FakeElement() };

beforeAll(() => {
  vi.stubGlobal('document', page);
});
vi.mock('../../components/icons', () => ({ icon: () => new FakeElement(), showIcon() {} }));

const { createTransport } = await import('./transport');

function transport(status: TransportStatus) {
  return createTransport({ status: () => status, setPaused() {}, seekBy() {}, seekTo() {}, setMuted() {}, setVolume() {}, segments: () => [], timeModeChanged() {} });
}

describe('the volume slider', () => {
  const status: TransportStatus = { timePos: 0, duration: 600, paused: false, volume: 50, muted: false, cacheTime: null, speed: 1, passthrough: false };

  it('follows the volume while it has keyboard focus (← → and M change it there), saying the new level', () => {
    const t = transport(status);
    t.render();
    page.activeElement = t.volume;
    status.volume = 55;
    t.render();
    expect(t.volume.value).toBe('55');
    expect(t.volume.getAttribute('aria-valuetext')).toBe('55%');
    status.muted = true;
    t.render();
    expect(t.volume.value).toBe('0');
  });

  it('is left alone while it is being dragged, so mpv’s report of the last step doesn’t pull the thumb back', () => {
    const t = transport({ ...status, volume: 50, muted: false });
    t.render();
    page.activeElement = t.volume;
    (t.volume as unknown as FakeElement).pressed = true;
    t.volume.value = '70';
    t.render();
    expect(t.volume.value).toBe('70');
  });
});
