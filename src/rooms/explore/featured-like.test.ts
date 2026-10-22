import { expect, it, vi } from 'vitest';

class FakeEl {
  attrs: Record<string, string> = {};
  private listeners: (() => void)[] = [];
  addEventListener(_type: string, fn: () => void) { this.listeners.push(fn); }
  click() { this.listeners.forEach((fn) => fn()); }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  replaceChildren() {}
  querySelector() { return null; }
}

vi.mock('../../lib/dom', () => ({
  h: (_tag: string, attrs: Record<string, string>) => {
    const el = new FakeEl();
    Object.assign(el.attrs, attrs);
    return el;
  },
}));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../components/icons', () => ({ icon: () => '' }));
vi.mock('../../components/toast', () => ({ toast: () => {} }));
vi.mock('../../catalog/tmdb', () => ({ tmdbList: async () => [{ id: 'tt1', type: 'movie', name: 'Pick', background: 'https://img/b.jpg', description: 'd' }] }));
vi.mock('../../library/library', () => ({ inLibrary: () => false, toggleLibrary: async () => {} }));
vi.mock('../../library/watch', () => ({ lastWatchedAt: () => 0 }));
vi.mock('../../theme/appearance', () => ({ appearance: () => ({ logos: false }) }));
vi.mock('../detail/title-actions', () => ({ primaryLabel: () => 'Play' }));
vi.mock('./state', () => ({ notHidden: () => true }));
const hero = vi.hoisted(() => ({ actions: [] as FakeEl[] }));
vi.mock('../home/hero', () => ({
  createHero: (items: unknown[], _actions: unknown, extras: { actions: (shown: () => unknown) => FakeEl[] }) => {
    hero.actions = extras.actions(() => items[0]);
    return new FakeEl();
  },
}));
const saved = vi.hoisted(() => ({ taste: { up: [] as { id: string }[], down: [] as string[], hidden: [], lists: [], hintDone: true } }));
vi.mock('../../catalog/taste', async (original) => {
  const real = await original<typeof import('../../catalog/taste')>();
  return {
    ...real,
    taste: async () => saved.taste,
    updateTaste: async (change: (t: typeof saved.taste) => typeof saved.taste) => (saved.taste = change(saved.taste)),
  };
});

const { renderFeatured } = await import('./featured');

it('a second thumbs up takes the first back', async () => {
  await renderFeatured(new FakeEl() as never, { play() {}, openDetail() {}, recommendations: async () => [] });
  const like = hero.actions[0]!;
  like.click();
  await vi.waitFor(() => expect(saved.taste.up.map((s) => s.id)).toEqual(['tt1']));
  expect(like.getAttribute('aria-pressed')).toBe('true');
  like.click();
  await vi.waitFor(() => expect(saved.taste.up).toEqual([]));
  expect(like.getAttribute('aria-pressed')).toBe('false');
});
