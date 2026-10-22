import { beforeEach, expect, it, vi } from 'vitest';

interface Fake {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit;
  targets: Set<object>;
  disconnected: boolean;
}
const made: Fake[] = [];
vi.stubGlobal(
  'IntersectionObserver',
  class {
    fake: Fake;
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
      this.fake = { callback, options, targets: new Set(), disconnected: false };
      made.push(this.fake);
    }
    observe(el: object) {
      this.fake.targets.add(el);
    }
    unobserve(el: object) {
      this.fake.targets.delete(el);
    }
    disconnect() {
      this.fake.disconnected = true;
      this.fake.targets.clear();
    }
  },
);

const { nearObserver, setScrollRoot, whenNear } = await import('./near-view');
const fire = (fake: Fake, target: object, isIntersecting: boolean) => fake.callback([{ target, isIntersecting } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);

beforeEach(() => {
  made.length = 0;
});

it('watches the outlet, so the margin reaches past what is on screen', () => {
  const outlet = {} as Element;
  setScrollRoot(outlet);
  nearObserver(() => {}, '150% 0px');
  expect(made[0]!.options).toEqual({ root: outlet, rootMargin: '150% 0px' });
  nearObserver(() => {}, '100% 0px', '0px 50%');
  expect(made[1]!.options).toEqual({ root: outlet, rootMargin: '100% 0px', scrollMargin: '0px 50%' });
});

it('runs once when either the window or the outlet sees the element near, then stops watching', () => {
  setScrollRoot({} as Element);
  const el = {} as Element;
  const run = vi.fn();
  whenNear(el, '0px 0px 100% 0px', run);
  expect(made).toHaveLength(2);
  expect(made[0]!.options.root).toBeUndefined();
  fire(made[1]!, el, false);
  expect(run).not.toHaveBeenCalled();
  fire(made[1]!, el, true);
  fire(made[0]!, el, true);
  expect(run).toHaveBeenCalledTimes(1);
  expect(made.every((fake) => fake.disconnected)).toBe(true);
});
