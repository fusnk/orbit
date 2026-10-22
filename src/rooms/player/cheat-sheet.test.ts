import { beforeAll, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';

// Tests run without a DOM: elements that keep their text, so what the list says can be read.
class FakeElement extends EventTarget {
  children: (FakeElement | string)[] = [];
  hidden = false;
  setAttribute(name: string, value: string) {
    if (name === 'hidden') this.hidden = true;
    void value;
  }
  append(...nodes: (FakeElement | string)[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: (FakeElement | string)[]) {
    this.children = nodes;
  }
  get text(): string {
    return this.children.map((c) => (typeof c === 'string' ? c : c.text)).join(' ');
  }
}

beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => new FakeElement() });
});
vi.mock('../../components/icons', () => ({ icon: () => new FakeElement() }));
vi.mock('../settings/shortcuts', () => ({ ACTION_LABELS: new Proxy({}, { get: (_, id) => String(id) }) }));
vi.mock('../../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));

const { createCheatSheet } = await import('./cheat-sheet');

const listed = (live: boolean) => {
  const sheet = createCheatSheet({ numberJump: () => true, holdBoost: () => true, live: () => live });
  sheet.toggle('Slash');
  return (sheet.element as unknown as FakeElement).text;
};

describe("the player's shortcut list", () => {
  it('names the number keys and hold-for-2× where they work', () => {
    const text = listed(false);
    expect(text).toContain(t('playerplus.keys.number-jump'));
    expect(text).toContain(t('playerplus.keys.hold-boost'));
  });

  it('leaves them off on a live channel, which can’t jump into or speed up, as it does the speed and frame keys', () => {
    const text = listed(true);
    expect(text).not.toContain('player.speed-up');
    expect(text).not.toContain(t('playerplus.keys.number-jump'));
    expect(text).not.toContain(t('playerplus.keys.hold-boost'));
  });
});
