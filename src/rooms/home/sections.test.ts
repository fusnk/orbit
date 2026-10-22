import { describe, expect, it, vi } from 'vitest';
import type { Title } from '../../catalog/titles';

const connected: ((on: boolean) => void)[] = [];
vi.mock('../../catalog/tmdb', () => ({
  tmdbConnected: () => new Promise<boolean>((resolve) => connected.push(resolve)),
  recommendationsFor: async () => [],
  streamingCatalog: async () => [],
  streamingServices: async () => [],
}));
vi.mock('../../catalog/letterboxd', () => ({}));
vi.mock('../../catalog/streaming', () => ({}));
vi.mock('../../components/cards', () => ({ asyncRail: ({ title }: { title: string }) => title, rail: () => '' }));
vi.mock('../../library/library', () => ({ inLibrary: () => false }));
vi.mock('../../library/watch', () => ({ lastWatchedAt: () => 0 }));
vi.mock('../streaming/service', () => ({ createServicePage: () => null }));
vi.mock('../title-card', () => ({ titleCard: () => null }));

const { renderForYou } = await import('./sections');

const seed: Title = { id: 'tt1', type: 'movie', name: 'Alien', genres: [], origins: [] };
const parts = { openDetail: () => {}, withMenu: (card: HTMLElement) => card };

describe('"Because you watched…"', () => {
  it('is drawn by the latest call only, even when an older one finishes last', async () => {
    let shown: unknown[] = [];
    const slot = { replaceChildren: (...children: unknown[]) => void (shown = children) } as unknown as HTMLElement;
    const older = renderForYou(slot, [seed], parts);
    // The history behind it is cleared: no seeds, so the row goes at once.
    await renderForYou(slot, [], parts);
    expect(shown).toEqual([]);
    connected.shift()!(true);
    await older;
    expect(shown).toEqual([]);
  });
});
