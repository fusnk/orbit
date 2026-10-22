import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomContext } from '../../app/router';
import type { Title } from '../../catalog/titles';
import type { QueueItem } from '../../library/queue';

let resolveMeta: (title: Title | null) => void = () => {};
const playTitle = vi.fn(async () => {});
vi.mock('../../catalog/service', () => ({ loadMeta: () => new Promise((resolve) => (resolveMeta = resolve)) }));
vi.mock('./streams', () => ({ playTitle }));

const { playQueued } = await import('./queue-actions');

/** A page outlet whose shown view can be swapped, as the router does. */
function outlet() {
  const page = { first: {} as object };
  vi.stubGlobal('document', { querySelector: (selector: string) => (selector === '.outlet > .view-shown' ? page.first : null) });
  return page;
}

const film: Title = { id: 'tt1', type: 'movie', name: 'Film', genres: [], origins: [] };
const item = { id: 'q1', title: film, episode: null } as unknown as QueueItem;

describe('playing a queued title', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    playTitle.mockClear();
  });

  it('plays it once its details arrive', async () => {
    outlet();
    playQueued(item, {} as RoomContext);
    resolveMeta(film);
    await vi.waitFor(() => expect(playTitle).toHaveBeenCalledOnce());
  });

  // E.g. "Play now" in the player's Queue panel, then Back out of the player while the details load.
  it('does nothing if the person moved to another page meanwhile', async () => {
    const page = outlet();
    playQueued(item, {} as RoomContext);
    page.first = {};
    resolveMeta(film);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(playTitle).not.toHaveBeenCalled();
  });
});
