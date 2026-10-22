import { describe, expect, it, vi } from 'vitest';

vi.mock('./errors', () => ({ pageError: () => fake('error'), reportError: () => {} }));
vi.mock('../theme/appearance', () => ({ reducedMotion: () => true }));
vi.mock('./spatial', () => ({ onScreen: () => true }));
vi.mock('../components/layers', () => ({ closeLayers: () => {} }));

// Tests run without a DOM: views are EventTargets with just what the router touches.
class FakeEl extends EventTarget {
  scrollTop = 0;
  isConnected = true;
  dataset: Record<string, string> = {};
  /** What `querySelector('[data-autofocus]')` finds in it. */
  autofocus: FakeEl | null = null;
  inert = false;
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  readonly classes = new Set<string>();
  readonly classList = {
    add: (c: string) => this.classes.add(c),
    remove: (c: string) => this.classes.delete(c),
    contains: (c: string) => this.classes.has(c),
  };
  constructor(public name: string) {
    super();
  }
  append(child: FakeEl) {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
    this.parentElement = null;
  }
  querySelectorAll() {
    return [];
  }
  querySelector(selector: string) {
    return selector === '[data-autofocus]' ? this.autofocus : null;
  }
  scrollTo() {}
  focus() {
    page.activeElement = this;
  }
  blur() {
    if (page.activeElement === this) page.activeElement = null;
  }
  contains(other: FakeEl | null): boolean {
    for (let at = other; at; at = at.parentElement) if (at === this) return true;
    return false;
  }
}
function fake(name: string): FakeEl {
  return new FakeEl(name);
}
const page = { activeElement: null as FakeEl | null };
vi.stubGlobal('CustomEvent', class extends Event {});
vi.stubGlobal('HTMLElement', FakeEl);
vi.stubGlobal('document', page);
vi.stubGlobal('CSS', { escape: (s: string) => s });

const { createRouter } = await import('./router');

function setup() {
  const views = new Map<string, FakeEl>();
  const rooms = ['home', 'movies'].map((id) => ({ id, label: id, render: () => (views.set(id, fake(id)).get(id) as unknown as HTMLElement) }));
  const states: { room: string; canGoBack: boolean; view: string }[] = [];
  const router = createRouter(rooms, fake('outlet') as unknown as HTMLElement, (s) => states.push({ room: s.room, canGoBack: s.canGoBack, view: (s.view as unknown as FakeEl).name }));
  return { router, states, views };
}

describe('router', () => {
  it('after choosing a page from the nav while on a title page there, one Back leaves the page', () => {
    const { router, states } = setup();
    router.go('home');
    router.go('movies');
    router.ctx.open(fake('detail') as unknown as HTMLElement);
    router.go('movies');
    expect(states.at(-1)).toMatchObject({ room: 'movies', view: 'movies', canGoBack: true });
    router.back();
    expect(states.at(-1)!.view).toBe('home');
  });

  it('after going to the top of a page from a title page there, Back leaves the page', () => {
    const { router, states } = setup();
    router.go('home');
    router.go('movies');
    router.ctx.open(fake('detail') as unknown as HTMLElement);
    router.goTop('movies');
    expect(states.at(-1)!.view).toBe('movies');
    router.back();
    expect(states.at(-1)!.view).toBe('home');
  });

  it("does nothing on Home's main view, where the Back arrow is hidden", () => {
    const { router, states } = setup();
    router.go('movies');
    router.go('home');
    const shown = states.length;
    expect(router.back()).toBe(false);
    expect(states.length).toBe(shown);
  });

  it('puts focus on the view’s main control when what had it is gone (a dialog’s button)', () => {
    const { router } = setup();
    router.go('movies');
    const detail = fake('detail');
    const play = fake('play');
    detail.autofocus = play;
    router.ctx.open(detail as unknown as HTMLElement);
    const cancel = fake('cancel');
    page.activeElement = cancel;
    router.ctx.open(fake('player') as unknown as HTMLElement);
    cancel.isConnected = false;
    page.activeElement = null;
    router.back();
    expect(page.activeElement).toBe(play);
  });

  it('keeps a `keep` page’s main view in the page, hidden, while other views show, and shows it again in place', () => {
    const outlet = fake('outlet');
    const home = fake('home');
    const rooms = [
      { id: 'home', label: 'home', keep: true, render: () => home as unknown as HTMLElement },
      { id: 'movies', label: 'movies', render: () => fake('movies') as unknown as HTMLElement },
    ];
    const router = createRouter(rooms, outlet as unknown as HTMLElement, () => {});
    router.go('home');
    const detail = fake('detail');
    router.ctx.open(detail as unknown as HTMLElement);
    expect(outlet.children).toEqual([home, detail]);
    expect(home.classList.contains('view-shown')).toBe(false);
    expect(home.inert).toBe(true);
    expect(detail.classList.contains('view-shown')).toBe(true);
    router.back();
    // The title page left for good; Home is the same element, never taken out.
    expect(outlet.children).toEqual([home]);
    expect(home.classList.contains('view-shown')).toBe(true);
    expect(home.inert).toBe(false);
    router.go('movies');
    const movies = outlet.children[1]!;
    expect(outlet.children).toEqual([home, movies]);
    // A page without `keep` leaves the page when another shows.
    router.go('home');
    expect(outlet.children).toEqual([home]);
    expect(movies.parentElement).toBe(null);
  });

  it('choosing the page already shown at its root scrolls it back to the top', () => {
    const outlet = Object.assign(fake('outlet'), { contains: () => false });
    const scrolled = vi.spyOn(outlet, 'scrollTo');
    const rooms = ['home'].map((id) => ({ id, label: id, render: () => fake(id) as unknown as HTMLElement }));
    const router = createRouter(rooms, outlet as unknown as HTMLElement, () => {});
    router.go('home');
    outlet.scrollTop = 900;
    router.go('home');
    expect(scrolled).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });
});
