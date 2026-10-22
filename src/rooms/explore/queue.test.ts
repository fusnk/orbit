import { beforeEach, expect, it, vi } from 'vitest';

class FakeEl {
  dataset: Record<string, string> = {};
  attrs: Record<string, unknown> = {};
  children: FakeEl[] = [];
  textContent = '';
  isConnected = true;
  private listeners: (() => void)[] = [];
  get disabled() { return !!this.attrs.disabled; }
  addEventListener(_type: string, fn: () => void) { this.listeners.push(fn); }
  click() { this.listeners.forEach((fn) => fn()); }
  focus() { fakeDocument.activeElement = this; }
  replaceChildren(...nodes: unknown[]) { this.children = nodes.filter((n): n is FakeEl => n instanceof FakeEl); }
  descendants(): FakeEl[] { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  contains(node: unknown) { return node === this || this.descendants().includes(node as FakeEl); }
  querySelector(selector: string) {
    const action = /data-queue-action="([^"]+)"/.exec(selector)?.[1];
    return this.descendants().find((el) => el.dataset.queueAction === action && !el.disabled) ?? null;
  }
}
const fakeDocument = { activeElement: null as FakeEl | null };
vi.stubGlobal('document', fakeDocument);

vi.mock('../../lib/dom', () => ({
  h: (_tag: string, attrs: Record<string, unknown>, ...children: unknown[]) => {
    const el = new FakeEl();
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'data-queue-action') el.dataset.queueAction = String(v);
      else el.attrs[k] = v;
    }
    el.replaceChildren(...children);
    return el;
  },
}));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../components/icons', () => ({ icon: () => '' }));
vi.mock('../../components/cards', () => ({ backdropImage: () => '', withHue: (el: unknown) => el }));
vi.mock('../../catalog/titles', () => ({ fallbackHue: () => 0 }));
vi.mock('../../catalog/tmdb', () => ({ tmdbRating: () => undefined }));
vi.mock('../../lib/art-hue', () => ({ artHue: async () => null }));
vi.mock('../../theme/ambient', () => ({ setAmbientHue: () => {} }));
vi.mock('../detail/open', () => ({ titleHandlers: () => ({ openDetail: () => {} }) }));
vi.mock('./state', () => ({ hideTitle: () => {}, notHidden: () => true }));
const watch = vi.hoisted(() => ({ started: new Set<string>() }));
vi.mock('../../library/watch', () => ({ lastWatchedAt: (id: string) => (watch.started.has(id) ? 1 : 0) }));
const library = vi.hoisted(() => ({ saved: new Set<string>(), finish: () => {} }));
vi.mock('../../library/library', () => ({
  inLibrary: (id: string) => library.saved.has(id),
  toggleLibrary: (title: { id: string }) => {
    library.saved.add(title.id);
    return new Promise<boolean>((resolve) => { library.finish = () => resolve(true); });
  },
}));

const { createQueuePage } = await import('./queue');

beforeEach(() => {
  library.saved.clear();
  watch.started.clear();
});

it("keeps focus on the next title when an earlier title's Add finishes saving", async () => {
  const titles = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const root = createQueuePage(titles as never, {} as never) as unknown as FakeEl;
  const button = (action: string) => root.querySelector(`[data-queue-action="${action}"]`) as FakeEl;
  button('add').click();
  button('next').click();
  const nextOnB = fakeDocument.activeElement;
  expect(nextOnB?.dataset.queueAction).toBe('next');
  library.finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(fakeDocument.activeElement).toBe(nextOnB);
  expect(button('add')).not.toBeNull();
});

it('opens again without the titles saved or started since the queue was put together', () => {
  library.saved.add('a');
  watch.started.add('b');
  const titles = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const root = createQueuePage(titles as never, {} as never) as unknown as FakeEl;
  expect(root.children[1]?.textContent).toBe('C');
});
