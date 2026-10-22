import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentLimit } from '../../catalog/ratings';
import type { Title } from '../../catalog/titles';

let profileLimit: ContentLimit;
/** Makes the ratings lookup fail, as offline or rate limited. */
let lookupFails = false;
/** While set, lookups wait for it: TMDB being slow. */
let hold: Promise<void> | undefined;
const ratings: Record<string, Record<string, string>> = { tt1: { US: 'G' }, tt3: { US: 'R' } };

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: { titles?: { id: string }[] }) => {
    if (cmd === 'profile_list') return [{ id: 'kid', name: 'Kid', color: '#46c28e', avatar: null, addonsFrom: null, hasPin: false, contentLimit: profileLimit }];
    if (cmd === 'profile_active') return 'kid';
    if (cmd === 'tmdb_token_saved') return true;
    if (cmd === 'tmdb_certifications') {
      if (lookupFails) throw new Error('offline');
      await hold;
      return args.titles!.map(({ id }) => ({ id, certs: ratings[id] ?? {}, adult: false }));
    }
    throw new Error(`unexpected ${cmd}`);
  },
}));
vi.mock('../../lib/ipc', () => ({ settings: { get: async () => null, set: async () => {} } }));
vi.mock('../../components/cards', () => ({ rail: (options: { cards: HTMLElement[] }) => ({ cards: options.cards }) }));

const title = (id: string): Title => ({ id, type: 'movie', name: id, genres: [], origins: [] });
/** A card as parental.ts sees it: hidden or not, on the page. */
const element = () => ({ hidden: false, dataset: {} as Record<string, string>, isConnected: true, closest: () => null }) as unknown as HTMLElement;
const rowOf = (row: HTMLElement | null) => (row as unknown as { cards: HTMLElement[] } | null)?.cards ?? null;

async function load(limit: ContentLimit) {
  profileLimit = limit;
  vi.resetModules();
  const parental = await import('../../catalog/parental');
  await parental.loadContentLimit();
  const { continueRail } = await import('./continue-row');
  return { ...parental, continueRail };
}

describe('Continue Watching on a limited profile', () => {
  beforeEach(() => {
    lookupFails = false;
    hold = undefined;
  });

  it('draws what the limit keeps, and nothing with no entries', async () => {
    const p = await load({ level: 'older-kids', allowUnrated: false, allowLiveTv: false });
    const titles = ['tt1', 'tt3'].map((id) => title(id));
    const cards = titles.map((t) => p.guardCard(element(), t));
    const redraw = vi.fn();
    expect(rowOf(await p.continueRail(titles, cards, redraw))).toEqual([cards[0]]);
    expect(await p.continueRail([], [], redraw)).toBeNull();
    expect(redraw).not.toHaveBeenCalled();
  });

  it('draws the row again once slow ratings land', async () => {
    const p = await load({ level: 'older-kids', allowUnrated: false, allowLiveTv: false });
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      let release!: () => void;
      hold = new Promise((r) => (release = r));
      const titles = ['tt1', 'tt3'].map((id) => title(id));
      const cards = titles.map((t) => p.guardCard(element(), t));
      const redraw = vi.fn();
      let row: HTMLElement[] | null | undefined;
      void p.continueRail(titles, cards, redraw).then((r) => (row = rowOf(r)));
      // The row's wait runs out with nothing rated yet: nothing to show.
      await vi.advanceTimersByTimeAsync(p.ROW_WAIT_MS + 1);
      expect(row).toBeNull();
      expect(redraw).not.toHaveBeenCalled();
      // The ratings land: the row is drawn again, now with the (G-rated) card.
      release();
      await vi.advanceTimersByTimeAsync(1);
      expect(redraw).toHaveBeenCalledTimes(1);
      hold = undefined;
      expect(rowOf(await p.continueRail(titles, cards, redraw))).toEqual([cards[0]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('draws the row again once ratings that couldn’t be looked up may be retried', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = await load({ level: 'older-kids', allowUnrated: false, allowLiveTv: false });
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      lookupFails = true;
      const titles = [title('tt1')];
      const cards = titles.map((t) => p.guardCard(element(), t));
      const redraw = vi.fn();
      let row: HTMLElement[] | null | undefined;
      void p.continueRail(titles, cards, redraw).then((r) => (row = rowOf(r)));
      await vi.advanceTimersByTimeAsync(p.ROW_WAIT_MS + 1);
      // Offline: blocked, nothing to show.
      expect(row).toBeNull();
      expect(redraw).not.toHaveBeenCalled();
      // Back online, and the retry wait over: drawn again, and the lookup now goes through.
      lookupFails = false;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(redraw).toHaveBeenCalledTimes(1);
      const again = p.continueRail(titles, titles.map((t) => p.guardCard(element(), t)), redraw);
      await vi.advanceTimersByTimeAsync(1);
      expect(rowOf(await again)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });
});
