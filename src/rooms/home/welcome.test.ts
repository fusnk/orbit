import { describe, expect, it, vi } from 'vitest';

// Tests run without a DOM: elements are EventTargets with what the card touches.
class FakeEl extends EventTarget {
  hidden = false;
  constructor(attrs: Record<string, unknown> = {}) {
    super();
    if (attrs.hidden) this.hidden = true;
  }
}
vi.stubGlobal('document', new EventTarget());
vi.mock('../../lib/dom', () => ({ h: (_tag: string, attrs?: Record<string, unknown>) => new FakeEl(attrs) }));
vi.mock('../../components/icons', () => ({ icon: () => null }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../settings', () => ({ openSettingsTo: () => {} }));
vi.mock('../../app/onboarding/checklist', () => ({ checklistStarted: async () => false }));
vi.mock('../../app/onboarding/state', () => ({ ONBOARDING_CLOSED: 'closed' }));
vi.mock('../../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));
vi.mock('../../addons/routing', () => ({ isUsable: () => true }));

const streamAddon = { manifest: { resources: [{ name: 'stream' }] } };
let installed: unknown[] = [];
const listeners = new Set<() => void>();
vi.mock('../../addons/registry', () => ({
  list: async () => installed,
  onAddonsChange: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));

const { createWelcomeCard } = await import('./welcome');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the welcome card', () => {
  it('goes once a stream addon is installed, without a restart', async () => {
    const card = createWelcomeCard({} as never) as unknown as FakeEl;
    await settle();
    expect(card.hidden).toBe(false);
    installed = [streamAddon];
    for (const listener of listeners) listener();
    await settle();
    expect(card.hidden).toBe(true);
  });
});
