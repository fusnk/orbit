import { expect, it, vi } from 'vitest';

/** Every element made, with its text and click handler, so the test can press the tabs. */
const made = vi.hoisted(() => [] as { text: string; className: string; click?: () => void }[]);
class FakeEl {
  dataset: Record<string, string> = {};
  hidden = false;
  textContent = '';
  text = '';
  className = '';
  click?: () => void;
  addEventListener(type: string, listener: () => void) {
    if (type === 'click') this.click = listener;
  }
  setAttribute() {}
  removeAttribute() {}
  replaceChildren() {}
  append() {}
  focus() {}
  querySelector() {
    return null;
  }
}
const pager = vi.hoisted(() => ({ fire: () => {} }));
vi.stubGlobal(
  'IntersectionObserver',
  class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      pager.fire = () => callback([{ isIntersecting: true }]);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

interface Call {
  kind: string;
  page: number;
  answer(result: { titles: { id: string }[]; done: boolean }): void;
}
const calls = vi.hoisted(() => [] as Call[]);

vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../app/router', () => ({ VIEW_DISCARDED: 'discarded' }));
vi.mock('../../catalog/streaming', () => ({ regionName: (code: string) => code }));
vi.mock('../../catalog/tmdb', () => ({
  servicePage: (_service: string, _region: string, kind: string, _genre: unknown, page: number) => new Promise((answer) => calls.push({ kind, page, answer })),
}));
vi.mock('../../components/cards', () => ({ asyncRail: () => new FakeEl(), gridSkeletons: () => [], rankedCard: () => new FakeEl() }));
vi.mock('../../lib/art-hue', () => ({ artHue: async () => null }));
vi.mock('../../lib/dom', () => ({
  h: (_tag: string, attrs: { class?: string } | undefined, ...children: unknown[]) => {
    const el = new FakeEl();
    el.className = attrs?.class ?? '';
    el.text = children.filter((c) => typeof c === 'string').join('');
    made.push(el);
    return el;
  },
}));
vi.mock('../../components/state-message', () => ({ errorState: () => new FakeEl(), stateMessage: () => new FakeEl() }));
vi.mock('../../theme/ambient', () => ({ setAmbientHue: () => {} }));
vi.mock('../detail/open', () => ({ titleHandlers: () => ({ openDetail() {}, withMenu: (card: unknown) => card }) }));
vi.mock('../title-card', () => ({ titleCard: () => new FakeEl() }));
vi.mock('./service.css', () => ({}));

const { createServicePage } = await import('./service');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** The tab drawn last with this label (the tabs are redrawn on every switch). */
const tab = (label: string) => made.filter((el) => el.className === 'segment' && el.text === label).at(-1)!;
// The latest request for it (a stale one from an earlier tab may also be waiting).
const pending = (kind: string, page: number) => calls.filter((c) => c.kind === kind && c.page === page && !('done' in c)).at(-1);
const answer = (kind: string, page: number, done: boolean) => {
  const call = pending(kind, page)!;
  Object.assign(call, { done: true });
  call.answer({ titles: [{ id: `${kind}-${page}-${Math.random()}` }], done });
};

it('an old All page answering after a switch away and back leaves the new All paging both kinds', async () => {
  createServicePage({ key: 'netflix', name: 'Netflix' } as never, 'US', {} as never, 'all');
  answer('movie', 1, false);
  answer('series', 1, false);
  await settle();
  // Scrolled: page 2 of both is on its way…
  pager.fire();
  expect(pending('movie', 2) && pending('series', 2)).toBeTruthy();
  // …when the person switches to Movies and straight back to All.
  tab('browse.search.movies').click!();
  tab('browse.search.all').click!();
  // The old page 2 lands now: shows ran out there.
  answer('movie', 2, false);
  answer('series', 2, true);
  await settle();
  // The new All's page 1, then its page 2 must still ask for shows.
  answer('movie', 1, false);
  answer('series', 1, false);
  await settle();
  pager.fire();
  expect(pending('series', 2)).toBeTruthy();
});
