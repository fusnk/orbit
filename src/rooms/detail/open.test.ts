import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomContext } from '../../app/router';
import type { Title } from '../../catalog/titles';

let resolveMeta: (title: Title | null) => void = () => {};
const playTitle = vi.fn(async () => {});
const openStreams = vi.fn();
vi.mock('../../catalog/service', () => ({ loadMeta: () => new Promise((resolve) => (resolveMeta = resolve)) }));
vi.mock('./streams', () => ({ playTitle, openStreams }));
vi.mock('./index', () => ({ createDetail: () => ({}) }));
vi.mock('../../library/queue', () => ({ loadQueue: async () => {} }));
vi.mock('../../components/menu', () => ({ withContextMenu: (card: unknown) => card }));
vi.mock('./title-actions', () => ({
  nextEpisode: (title: Title) => title.seasons?.[0] && { season: 1, episode: title.seasons[0].episodes[0] },
  nothingAired: () => false,
  shuffleTitle: async () => {},
  titleMenu: () => [],
}));

const { titleHandlers } = await import('./open');

/** A page outlet whose shown view can be swapped, as the router does. */
function outlet() {
  const page = { first: {} as object };
  vi.stubGlobal('document', { querySelector: (selector: string) => (selector === '.outlet > .view-shown' ? page.first : null) });
  return page;
}

const show: Title = { id: 'tt2', type: 'series', name: 'Show', genres: [], origins: [] };
const full: Title = { ...show, seasons: [{ number: 1, episodes: [{ id: 'tt2:1:1', number: 1, title: 'One' }] }] };

describe("a card's Play for a show", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    playTitle.mockClear();
  });

  it('plays the next episode once its list arrives', async () => {
    outlet();
    const ctx = { open: vi.fn() } as unknown as RoomContext;
    titleHandlers(ctx).play(show);
    resolveMeta(full);
    await vi.waitFor(() => expect(playTitle).toHaveBeenCalledOnce());
  });

  it('plays an episode of another type with episodes (an addon’s "anime"), not the whole title', async () => {
    outlet();
    const ctx = { open: vi.fn() } as unknown as RoomContext;
    titleHandlers(ctx).play({ ...show, type: 'anime' });
    resolveMeta({ ...full, type: 'anime' });
    await vi.waitFor(() => expect(playTitle).toHaveBeenCalledOnce());
    expect(playTitle).toHaveBeenCalledWith(expect.objectContaining({ type: 'anime' }), expect.objectContaining({ episode: expect.objectContaining({ season: 1 }) }));
  });

  it('does nothing if the person moved to another page meanwhile', async () => {
    const page = outlet();
    const ctx = { open: vi.fn() } as unknown as RoomContext;
    titleHandlers(ctx).play(show);
    page.first = {};
    resolveMeta(full);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(playTitle).not.toHaveBeenCalled();
    expect(ctx.open).not.toHaveBeenCalled();
  });
});
