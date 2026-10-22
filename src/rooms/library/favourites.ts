/**
 * My Library → Favourite episodes: the episodes hearted on a show's page or
 * in the player (library/favourite-episodes.ts), grouped by show, the show
 * with the newest favourite first. Picking one plays it (resuming as
 * Settings say); its show's name opens the show. Spoiler protection applies
 * to the names and stills, as on the show's page.
 */
import type { RoomContext } from '../../app/router';
import { shownNow, verdictNow } from '../../catalog/parental';
import { loadMeta } from '../../catalog/service';
import type { Episode, Title } from '../../catalog/titles';
import { artImage } from '../../components/cards';
import { favouriteHeart } from '../../components/favourite-heart';
import { icon } from '../../components/icons';
import { withContextMenu } from '../../components/menu';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { favouriteEpisodes, groupByShow, toggleFavouriteEpisode, type FavouriteEpisode } from '../../library/favourite-episodes';
import { episodeName, hiddenFor } from '../../library/spoilers';
import { episodeState } from '../../library/watch';
import { pageLeft } from '../detail/page-left';
import { playTitle } from '../detail/streams';

/** The stored favourite as an episode (what watch state, the heart and playback take). */
const asEpisode = (f: FavouriteEpisode): Episode => ({ id: f.videoId, number: f.episode, title: f.name, thumbnail: f.still });

/**
 * How many favourites My Library would list (for the tab's count): not those of shows the
 * content limit blocks, as the list leaves them out. One whose rating is still being looked
 * up counts, so the tab doesn't come and go while it's found (as History's count).
 */
export const favouritesCount = (): number => favouriteEpisodes().filter((f) => verdictNow(f.show) !== 'blocked').length;

/** `redraw` draws the tab again once the ratings of shows still being looked up for the content limit are in. */
export function favouritesSection(ctx: RoomContext, actions: { openDetail(title: Title): void; redraw(): void }): HTMLElement {
  // Only shows the profile's content limit allows, as History lists them.
  const groups = shownNow(groupByShow(favouriteEpisodes()), (group) => group.show, actions.redraw);
  if (!groups.length) {
    return h('section', { class: 'library-section' }, h('div', { class: 'library-empty' }, h('span', { class: 'library-empty-title' }, t('favourites.tab')), h('p', { class: 'muted' }, t('favourites.empty'))));
  }

  /** Plays the episode from the show's full details; its page when it can't be found there any more. */
  async function play(f: FavouriteEpisode): Promise<void> {
    // The episode list can take a while: if the person has moved on meanwhile, nothing opens over where they are now.
    const left = pageLeft();
    const full = await loadMeta(f.show.type, f.show.id).catch(() => null);
    if (left()) return;
    const season = full?.seasons?.find((s) => s.number === f.season);
    const episode = season?.episodes.find((e) => e.id === f.videoId) ?? season?.episodes.find((e) => e.number === f.episode);
    if (full && episode && !episode.airs) return playTitle(full, { episode: { season: f.season, episode }, ctx });
    actions.openDetail(f.show);
  }

  function card(f: FavouriteEpisode): HTMLElement {
    const episode = asEpisode(f);
    // Spoiler protection, as on the show's page.
    const hide = hiddenFor(episodeState(f.show, f.season, episode).kind);
    const code = t('titles.common.episode-code', { season: f.season, episode: f.episode });
    const name = episodeName(f.episode, f.name, hide.title);
    const still = h('span', { class: `frame fav-episode-still${hide.thumbnail ? ' spoiler-art' : ''}` }, f.still ? artImage(f.still, 'art') : '', h('span', { class: 'fav-episode-play', 'aria-hidden': 'true' }, icon('play', { filled: true })));
    const button = h(
      'button',
      { class: 'fav-episode', 'data-focus-id': `fav:${f.show.id}:${f.season}:${f.episode}` },
      still,
      h('span', { class: 'fav-episode-name' }, name.trim() ? `${code} · ${name}` : code),
      h('span', { class: 'fav-episode-show' }, f.show.name),
    );
    button.addEventListener('click', () => void play(f));
    withContextMenu(button, () => [
      { label: t('titles.actions.play'), action: () => void play(f) },
      { label: t('titles.actions.view-details'), action: () => actions.openDetail(f.show) },
      { label: t('favourites.remove'), action: () => void toggleFavouriteEpisode(f.show, f.season, episode) },
    ]);
    return h('div', { class: 'fav-episode-item' }, button, favouriteHeart(f.show, f.season, episode, { className: 'fav-episode-heart', focusId: `fav-heart:${f.show.id}:${f.season}:${f.episode}` }));
  }

  return h(
    'section',
    { class: 'library-section fav-episodes' },
    h('h2', { class: 'library-heading' }, t('favourites.tab')),
    ...groups.map(({ show, episodes }) => {
      const open = h('button', { class: 'fav-episodes-show', 'data-focus-id': `fav-show:${show.id}` }, show.name, icon('chevronRight'));
      open.addEventListener('click', () => actions.openDetail(show));
      return h('section', { class: 'fav-episodes-group' }, h('h3', { class: 'fav-episodes-heading' }, open), h('div', { class: 'fav-episodes-grid' }, ...episodes.map(card)));
    }),
  );
}
