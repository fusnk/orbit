import { expect, it, vi } from 'vitest';

/** Enough of an element for a day cell: children, listeners, replaceWith and focus. */
class FakeEl {
  children: (FakeEl | string)[] = [];
  parent: FakeEl | null = null;
  listeners: Record<string, () => void> = {};
  focused = false;
  constructor(
    public tag: string,
    public attrs: Record<string, unknown>,
  ) {}
  append(...nodes: (FakeEl | string)[]) {
    for (const node of nodes) {
      if (node instanceof FakeEl) node.parent = this;
      this.children.push(node);
    }
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners[type] = fn;
  }
  replaceWith(...nodes: FakeEl[]) {
    const at = this.parent!.children.indexOf(this);
    this.parent!.children.splice(at, 1, ...nodes);
    for (const node of nodes) node.parent = this.parent;
  }
  focus() {
    this.focused = true;
  }
}
vi.mock('../../lib/dom', () => ({
  h: (tag: string, attrs: Record<string, unknown>, ...children: (FakeEl | string)[]) => {
    const el = new FakeEl(tag, attrs);
    el.append(...children.filter((c) => c !== ''));
    return el;
  },
}));
vi.mock('../../i18n', () => ({ locale: () => 'en', t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${Object.values(params).join(',')}` : key) }));
vi.mock('../../lib/ipc', () => ({ settings: {}, withDialog: () => {} }));
vi.mock('../../components/icons', () => ({ icon: () => '' }));
vi.mock('../../components/toast', () => ({ toast: () => {} }));
vi.mock('../../components/state-message', () => ({ connectTmdbButton: () => ({}), errorText: () => '', retryWhenOnline: () => {} }));
vi.mock('../../theme/appearance', () => ({ reducedMotion: () => true }));
vi.mock('../../library/spoilers', () => ({ hiddenFor: () => ({}), episodeName: () => '' }));
vi.mock('./radar', () => ({ calendarEvents: () => [], featuredCard: () => ({}), releaseCode: () => '', soonSection: () => ({}), weekSection: () => ({}) }));
vi.mock('./upcoming', () => ({ upcomingSection: () => ({}) }));

const { dayCell } = await import('./calendar');
const chip = (name: string) => new FakeEl('button', { class: 'calendar-chip', name }) as unknown as HTMLElement;
const tags = (cell: FakeEl) => cell.children.map((c) => (c instanceof FakeEl ? `${c.tag}.${String(c.attrs.class)}` : c));

it('shows a day with a few releases whole, with nothing to press', () => {
  const cell = dayCell('calendar-day', new Date(2026, 9, 21), [chip('a'), chip('b')]) as unknown as FakeEl;
  expect(tags(cell)).toEqual(['span.calendar-date', 'button.calendar-chip', 'button.calendar-chip']);
});

it('"+N more" is a button in the focus order that shows the rest of the day in place', () => {
  const chips = ['a', 'b', 'c', 'd', 'e'].map(chip);
  const cell = dayCell('calendar-day', new Date(2026, 9, 21), chips) as unknown as FakeEl;
  const more = cell.children[4] as FakeEl;
  expect(tags(cell)).toEqual(['span.calendar-date', 'button.calendar-chip', 'button.calendar-chip', 'button.calendar-chip', 'button.calendar-more']);
  expect(more.attrs['data-focus-id']).toBe('calendar-more:2026-10-21');
  expect(more.children).toEqual(['titles.calendar.more:2']);
  more.listeners.click!();
  expect(cell.children.slice(1)).toEqual(chips);
  // The keyboard lands on the first release that just appeared.
  expect((chips[3] as unknown as FakeEl).focused).toBe(true);
});
