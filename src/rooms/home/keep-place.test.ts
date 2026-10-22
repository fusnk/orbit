import { describe, expect, it, vi } from 'vitest';

// Tests run without a DOM: the fakes below stand in for HTMLElement.
class Base {}

// A slot holds a rail track of cards, each with its focus id.
class FakeEl extends Base {
  scrollLeft = 0;
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  dataset: Record<string, string> = {};
  constructor(
    public cls = '',
    focusId?: string,
  ) {
    super();
    if (focusId) this.dataset.focusId = focusId;
  }
  append(...kids: FakeEl[]) {
    for (const kid of kids) kid.parent = this;
    this.children.push(...kids);
  }
  replaceChildren(...kids: FakeEl[]) {
    for (const kid of this.children) kid.parent = null;
    this.children = [];
    this.append(...kids);
  }
  all(): FakeEl[] {
    return this.children.flatMap((kid) => [kid, ...kid.all()]);
  }
  contains(el: FakeEl | null) {
    for (let at = el; at; at = at.parent) if (at === this) return true;
    return false;
  }
  closest(selector: string): FakeEl | null {
    if (selector === '[data-focus-id]' && this.dataset.focusId) return this;
    return this.parent?.closest(selector) ?? null;
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string) {
    return this.all().filter((el) => (selector === '.rail-track' ? el.cls === 'rail-track' : !!el.dataset.focusId));
  }
  focus() {
    page.activeElement = this;
  }
}
const page = { activeElement: null as FakeEl | null };
vi.stubGlobal('HTMLElement', Base);
vi.stubGlobal('document', page);

const { dismissKeepingFocus, redrawKeepingPlace } = await import('./keep-place');

function railOf(ids: string[]): FakeEl {
  const track = new FakeEl('rail-track');
  track.append(...ids.map((id) => new FakeEl('card', `continue:${id}`)));
  const section = new FakeEl('rail');
  section.append(track);
  return section;
}

function setup(ids: string[]) {
  const slot = new FakeEl('cw-slot');
  slot.replaceChildren(railOf(ids));
  return { slot, draw: (next: string[]) => () => slot.replaceChildren(railOf(next)), as: (el: FakeEl) => el as unknown as HTMLElement };
}

describe('redrawing Continue Watching', () => {
  it("keeps focus on the same title's card", () => {
    const { slot, draw, as } = setup(['a', 'b', 'c']);
    slot.querySelectorAll('[data-focus-id]')[2]!.focus();
    redrawKeepingPlace(as(slot), draw(['c', 'a', 'b']));
    expect(page.activeElement?.dataset.focusId).toBe('continue:c');
  });

  it('moves focus to the card that took its place when its title was removed', () => {
    const { slot, draw, as } = setup(['a', 'b', 'c']);
    slot.querySelectorAll('[data-focus-id]')[1]!.focus();
    redrawKeepingPlace(as(slot), draw(['a', 'c']));
    expect(page.activeElement?.dataset.focusId).toBe('continue:c');
    page.activeElement = slot.querySelectorAll('[data-focus-id]')[1]!;
    redrawKeepingPlace(as(slot), draw(['a']));
    expect(page.activeElement?.dataset.focusId).toBe('continue:a');
  });

  it("keeps the row scrolled where it was, and leaves focus elsewhere alone", () => {
    const { slot, draw, as } = setup(['a', 'b', 'c']);
    const elsewhere = new FakeEl('button');
    page.activeElement = elsewhere;
    slot.querySelector('.rail-track')!.scrollLeft = 300;
    redrawKeepingPlace(as(slot), draw(['a', 'b', 'c', 'd']));
    expect(slot.querySelector('.rail-track')!.scrollLeft).toBe(300);
    expect(page.activeElement).toBe(elsewhere);
  });
});

// A page of sections: each has a few buttons, any of which may be disabled, and may itself be hidden.
class Node2 extends Base {
  hidden = false;
  disabled = false;
  parent: Node2 | null = null;
  kids: Node2[] = [];
  constructor(
    public tag: 'section' | 'button',
    public autofocus = false,
  ) {
    super();
  }
  add(...kids: Node2[]) {
    for (const kid of kids) kid.parent = this;
    this.kids.push(...kids);
    return this;
  }
  get nextElementSibling(): Node2 | null {
    const siblings = this.parent?.kids ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  contains(el: unknown): boolean {
    return el === this || this.kids.some((kid) => kid.contains(el));
  }
  closest(selector: string): Node2 | null {
    if (selector === '.home' ? !this.parent : selector === '[hidden]' && this.hidden) return this;
    return this.parent?.closest(selector) ?? null;
  }
  matches(): boolean {
    return this.tag === 'button' && !this.disabled;
  }
  querySelectorAll(): Node2[] {
    return this.kids.flatMap((kid) => [...(kid.matches() ? [kid] : []), ...kid.querySelectorAll()]);
  }
  querySelector(selector: string): Node2 | null {
    if (selector === '[data-autofocus]') return this.kids.flatMap((kid) => (kid.autofocus ? [kid] : (kid.querySelector(selector) ?? []))).at(0) ?? null;
    return this.querySelectorAll()[0] ?? null;
  }
  focus() {
    page.activeElement = this as never;
  }
}

describe('dismissing a card on Home', () => {
  function home() {
    const play = new Node2('button', true);
    const close = new Node2('button');
    const card = new Node2('section').add(close);
    const hiddenRow = new Node2('section').add(new Node2('button'));
    hiddenRow.hidden = true;
    const firstCard = new Node2('button');
    const disabled = new Node2('button');
    disabled.disabled = true;
    const row = new Node2('section').add(disabled, firstCard);
    new Node2('section').add(new Node2('section').add(play), card, hiddenRow, row);
    return { play, close, card, firstCard, row };
  }
  const as = (el: Node2) => el as unknown as HTMLElement;

  it('moves focus from its close button to the next thing shown below it', () => {
    const { close, card, firstCard } = home();
    close.focus();
    dismissKeepingFocus(as(card), () => (card.hidden = true));
    expect(card.hidden).toBe(true);
    expect(page.activeElement).toBe(firstCard);
  });

  it("falls back to the banner's main button when nothing follows it", () => {
    const { close, card, row, play } = home();
    row.hidden = true;
    close.focus();
    dismissKeepingFocus(as(card), () => (card.hidden = true));
    expect(page.activeElement).toBe(play);
  });

  it('leaves focus alone when it was elsewhere', () => {
    const { card, firstCard } = home();
    firstCard.focus();
    dismissKeepingFocus(as(card), () => (card.hidden = true));
    expect(page.activeElement).toBe(firstCard);
  });
});
