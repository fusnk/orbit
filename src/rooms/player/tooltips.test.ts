import { afterEach, expect, it, vi } from 'vitest';

const binding = vi.hoisted(() => ({ key: 'Space' as string | null }));
vi.mock('../../lib/keymap', () => ({ firstKey: () => binding.key, isActionId: (id: string) => id === 'playPause' }));
class ElementFake extends EventTarget {
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  children: ElementFake[] = [];
  hidden = true;
  isConnected = true;
  style: Record<string, string> = {};
  dir = '';
  lang = '';
  textContent = '';
  classList = { contains: () => false };
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  append(...nodes: ElementFake[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: ElementFake[]) { this.children = nodes; }
  remove() { this.isConnected = false; }
  closest() { return this.dataset.tooltipLabel ? this : null; }
  contains(node: unknown) { return node === this || this.children.includes(node as ElementFake); }
  querySelector() { return null; }
  querySelectorAll() { return this.children.filter((child) => child.dataset.tooltipLabel); }
  matches() { return true; }
  getBoundingClientRect() { return { left: 10, top: 100, width: 40, height: 20 }; }
}
vi.mock('../../lib/dom', () => ({ h: (_tag: string, attrs: Record<string, string>, ...children: unknown[]) => {
  const node = new ElementFake();
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  node.textContent = children.filter((v) => typeof v === 'string').join('');
  return node;
} }));
vi.stubGlobal('Element', ElementFake);
vi.stubGlobal('HTMLElement', ElementFake);
vi.stubGlobal('document', { documentElement: { dir: 'rtl', lang: 'ar' } });
vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
const { createPlayerTooltips } = await import('./tooltips');
afterEach(() => vi.useRealTimers());
function setup() {
  const root = new ElementFake();
  const button = new ElementFake();
  button.dataset = { tooltipLabel: 'Play', tooltipAction: 'playPause' };
  root.children.push(button);
  const api = createPlayerTooltips(root as unknown as HTMLElement);
  const tip = root.children[1]!;
  const emit = (name: string) => { const event = new Event(name); Object.defineProperty(event, 'target', { value: button }); root.dispatchEvent(event); };
  return { api, tip, emit };
}
it('delays hover, reads the current binding, and cancels pending work on dispose', () => {
  vi.useFakeTimers();
  const { api, tip, emit } = setup();
  emit('pointerover');
  vi.advanceTimersByTime(299);
  expect(tip.hidden).toBe(true);
  binding.key = 'P';
  vi.advanceTimersByTime(1);
  expect(tip.hidden).toBe(false);
  expect(tip.children[1]!.textContent).toBe('P');
  expect(tip.dir).toBe('rtl');
  api.hide();
  emit('pointerover');
  api.dispose();
  vi.runAllTimers();
  expect(tip.hidden).toBe(true);
  expect(tip.isConnected).toBe(false);
});
it('shows on keyboard focus and hides on focusout without moving focus', () => {
  const { api, tip, emit } = setup();
  emit('focusin');
  expect(tip.hidden).toBe(false);
  emit('focusout');
  expect(tip.hidden).toBe(true);
  api.dispose();
});

it('keeps tooltip coordinates inside the viewport and omits unassigned shortcuts', () => {
  binding.key = null;
  vi.stubGlobal('window', { innerWidth: 50, innerHeight: 60 });
  const { api, tip, emit } = setup();
  emit('focusin');
  expect(tip.children).toHaveLength(1);
  expect(tip.style.left).toBe('8px');
  expect(tip.style.top).toBe('32px');
  api.dispose();
  vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
});

