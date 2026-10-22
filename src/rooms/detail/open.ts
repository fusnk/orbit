import type { RoomContext } from '../../app/router';
import { loadMeta } from '../../catalog/service';
import type { Title } from '../../catalog/titles';
import { withContextMenu, type MenuItem } from '../../components/menu';
import { loadQueue } from '../../library/queue';
import { createDetail } from './index';
import { pageLeft } from './page-left';
import { openStreams, playTitle } from './streams';
import { nextEpisode, nothingAired, shuffleTitle, titleMenu } from './title-actions';

/** How every page opens a title, plays it, and attaches the shared title menu. */
export function titleHandlers(ctx: RoomContext) {
  // The title menu asks whether a title is queued, so the queue is read before the first menu opens.
  void loadQueue();
  const openDetail = (title: Title) => ctx.open(createDetail(title, ctx));
  /** Plays the movie, or the series' next episode; `choose` always opens the source picker. */
  const start = (title: Title, choose: boolean) => {
    const go = (t: Title, episode?: ReturnType<typeof nextEpisode>) => {
      const options = episode ? { episode, ctx } : { ctx };
      if (choose) openStreams(t, options);
      else void playTitle(t, options);
    };
    // Anything but a movie may have episodes (a series, an addon's "anime"): its episode list says what to play.
    if (title.type === 'movie') return go(title);
    // The episode list can take a while: if the person has moved on meanwhile, nothing opens over where they are now.
    const left = pageLeft();
    void loadMeta(title.type, title.id)
      .catch(() => undefined)
      .then((full) => {
        if (left()) return;
        if (full === undefined) return openDetail(title);
        const detailed = full ?? title;
        // Nothing out yet: its page says so, rather than asking for the show as a movie.
        if (nothingAired(detailed)) return openDetail(detailed);
        go(detailed, nextEpisode(detailed));
      });
  };
  const play = (title: Title) => start(title, false);
  // Right-click, the Menu key or Shift+F10 on any card opens the shared title menu.
  // `extra` adds page-specific items (e.g. "Remove from this list").
  const withMenu = (card: HTMLElement, title: Title, extra: MenuItem[] = []) =>
    withContextMenu(card, () => [...titleMenu(title, { play: () => play(title), chooseSource: () => start(title, true), shuffle: () => void shuffleTitle(title, ctx), details: () => openDetail(title) }), ...extra]);
  return { openDetail, play, withMenu };
}
