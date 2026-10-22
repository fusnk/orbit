/**
 * Home's tile rows (Settings → Home rows → Add a row → Tiles, and the
 * Dashboard layout): status tiles (a new episode, finished downloads, My
 * Library), "Today on Orbit" (moods, Surprise me and Shorts), and what's on the
 * person's favourite Live TV channels. What they show is worked out in
 * dashboard-data.ts.
 */
import { locale, t, tn } from '../../i18n';
import type { RoomContext } from '../../app/router';
import { liveTvAllowed } from '../../catalog/parental';
import type { CatalogRef, Title } from '../../catalog/titles';
import { rail } from '../../components/cards';
import { icon, type IconName } from '../../components/icons';
import { h } from '../../lib/dom';
import { isShown } from '../../lib/shown';
import { allDownloads, onDownloadsChange } from '../../library/downloads';
import { libraryEntries, onLibraryChange } from '../../library/library';
import { latestNewEpisode, onWatchChange } from '../../library/watch';
import { tvChannels, tvGuide, type TvChannel } from '../../live/iptv';
import { channelLogo, clock, favouritesInOrder, progressBar, progressOf } from '../../live/surf';
import { isAndroid } from '../../lib/platform';
import { openSurprise } from '../discover/surprise';
import { playChannel } from '../live';
import { createShortsPage } from '../shorts';
import { airedText, onNow, statusItems, type OnNow, type StatusItem } from './dashboard-data';
import { createMoodPage } from './mood-page';
import { moodLabel } from './row-render';
import type { MoodId } from './moods';
import './dashboard.css';

/** Dispatched on `document` each time Home is shown, so tiles can catch up on what changed elsewhere. */
export const HOME_SHOWN = 'orbit:home-shown';

/** Favourites shown in "Live TV · On now". */
const LIVE_CARDS = 4;
/** Favourites whose guide is read to choose them (ones with a programme on come first). */
const LIVE_CANDIDATES = 12;
const MINUTE_MS = 60_000;

export interface TileDeps {
  ctx: RoomContext;
  refs: readonly CatalogRef[];
  openDetail(title: Title): void;
  play(title: Title): void;
}

/** A tile: accent icon, bold name, a muted line, and an optional accent tag. */
function tile(className: string, focusId: string, glyph: IconName, name: string, line: string, onOpen: () => void, tag?: string): HTMLButtonElement {
  const button = h(
    'button',
    { class: className, 'data-focus-id': focusId },
    h('span', { class: 'tile-head' }, h('span', { class: 'tile-icon' }, icon(glyph)), tag ? h('span', { class: 'tile-tag' }, tag) : ''),
    h('span', { class: 'tile-name' }, name),
    h('span', { class: 'tile-line' }, line),
  );
  button.addEventListener('click', onOpen);
  return button;
}

// ── Status tiles ──

function statusTile(item: StatusItem, deps: TileDeps): HTMLButtonElement {
  switch (item.kind) {
    case 'episode': {
      const code = t('titles.common.episode-code', { season: item.episode.season, episode: item.episode.episode });
      const line = t('homerows.status.episode-line', { name: item.title.name, episode: code, aired: airedText(item.airedAt, Date.now(), locale()) });
      const button = tile('status-tile', 'status:episode', 'episodes', t('homerows.status.new-episode'), line, () => deps.openDetail(item.title), t('homerows.status.new'));
      button.title = line;
      return button;
    }
    case 'downloads':
      return tile('status-tile', 'status:downloads', 'download', t('downloads.nav'), tn('homerows.status.ready', item.count), () => deps.ctx.go('downloads'));
    case 'library':
      return tile('status-tile', 'status:library', 'list', t('titles.common.my-library'), tn('homerows.status.titles', item.count), () => deps.ctx.go('library'));
  }
}

/**
 * New episode, downloads ready and My Library at a glance. It follows them
 * as they change (redrawing only when what it says does, so focus stays put);
 * with nothing to say it's empty, and Home leaves it out.
 */
export function statusTiles(deps: TileDeps): HTMLElement {
  const group = h('div', { class: 'status-tiles', role: 'group', 'aria-label': t('homerows.status.label') });
  let shown = '';
  const draw = () => {
    const items = statusItems({ newEpisode: latestNewEpisode(), downloads: allDownloads(), library: libraryEntries().length });
    const key = JSON.stringify(items.map((item) => (item.kind === 'episode' ? [item.kind, item.title.id, item.episode.videoId, item.airedAt] : [item.kind, item.count])));
    if (key === shown) return;
    shown = key;
    const focused = document.activeElement instanceof HTMLElement && group.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    group.replaceChildren(...items.map((item) => statusTile(item, deps)));
    if (focused) group.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  };
  draw();
  // Cheap to work out, and it only redraws on a real change.
  whileKept(group, draw, (poke) => [onWatchChange(poke), onDownloadsChange(poke), onLibraryChange(poke)]);
  return group;
}

// ── Today on Orbit ──

/** The moods offered as tiles, each with its icon. */
const TODAY: readonly [Extract<MoodId, 'short' | 'feel-good' | 'hidden-gems'>, IconName][] = [
  ['short', 'clock'],
  ['feel-good', 'smile'],
  ['hidden-gems', 'gem'],
];

/** Three moods (each opens its page of titles) and Surprise me. */
export function todayRow(title: string, deps: TileDeps): HTMLElement {
  const moods = TODAY.map(([mood, glyph]) => tile('today-tile', `today:${mood}`, glyph, moodLabel(mood), t(`homerows.today.${mood}`), () => deps.ctx.open(createMoodPage(mood, deps.refs, deps.ctx))));
  const surprise = tile('today-tile', 'today:surprise', 'shuffle', t('insights.surprise.title'), t('homerows.today.surprise'), () => openSurprise('movie', { play: deps.play, openDetail: deps.openDetail }));
  // Android has no yt-dlp to find trailers with (they open in the YouTube app there).
  const shorts = isAndroid ? [] : [tile('today-tile', 'today:shorts', 'film', t('shorts.title'), t('shorts.tile'), () => deps.ctx.open(createShortsPage(deps.ctx)))];
  return rail({ title, cards: [...moods, surprise, ...shorts], variant: 'tiles' });
}

// ── Live TV · On now ──

/** The person's favourite channels, when Live TV is set up and the profile may use it. */
export async function liveFavourites(): Promise<TvChannel[]> {
  if (!liveTvAllowed()) return [];
  return favouritesInOrder(await tvChannels().catch(() => [] as TvChannel[]));
}

function liveCard({ channel, now }: OnNow, list: readonly TvChannel[], ctx: RoomContext): HTMLButtonElement {
  const time = now ? t('homerows.live.time', { start: clock(now.start), end: clock(now.stop) }) : '';
  const card = h(
    'button',
    { class: 'live-now-card', 'data-focus-id': `live-now:${channel.source}/${channel.key}`, 'aria-label': t('homerows.live.play', { name: channel.name }), title: now?.description ?? channel.name },
    channelLogo(channel, 'live-now-logo'),
    h(
      'span',
      { class: 'live-now-text' },
      h('span', { class: 'live-now-programme' }, now?.title ?? channel.name),
      h('span', { class: 'live-now-meta' }, now ? `${channel.name} · ${time}` : (channel.group ?? '')),
      now ? progressBar(progressOf(now)) : h('span', { class: 'live-progress empty', 'aria-hidden': 'true' }),
    ),
  );
  card.addEventListener('click', () => playChannel(channel, ctx, list));
  return card;
}

/**
 * What's on the first favourite channels; choosing one plays it, and Up/Down
 * in the player surf the favourites. The cards are drawn at once from the
 * channels and fill in from the guide; they catch up every minute while Home
 * is on screen, and whenever it's shown again (favourites may have changed).
 */
export function liveNowRow(title: string, initial: readonly TvChannel[], ctx: RoomContext): HTMLElement {
  let favourites = initial;
  const section = rail({ title, cards: onNow(favourites, [], LIVE_CARDS).map((entry) => liveCard(entry, favourites, ctx)), variant: 'live-now' });
  const track = section.querySelector<HTMLElement>('.rail-track')!;
  let generation = 0;
  /** `first`: the guide for the cards just drawn, before the row is in the page. */
  const refresh = async (reread: boolean, first = false) => {
    if (!first && (!isShown(section) || document.hidden)) return;
    const current = ++generation;
    if (reread) favourites = await liveFavourites();
    const guides = await tvGuide(favourites.slice(0, LIVE_CANDIDATES)).catch(() => []);
    if (current !== generation) return;
    const focused = document.activeElement instanceof HTMLElement && track.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    track.replaceChildren(...onNow(favourites, guides, LIVE_CARDS).map((entry) => liveCard(entry, favourites, ctx)));
    section.hidden = !favourites.length;
    if (focused) track.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  };
  void refresh(false, true);
  whileKept(section, (reread: boolean) => void refresh(reread), (poke) => {
    const timer = window.setInterval(() => poke(false), MINUTE_MS);
    const visible = () => poke(false);
    const shown = () => poke(true);
    document.addEventListener('visibilitychange', visible);
    document.addEventListener(HOME_SHOWN, shown);
    return [() => window.clearInterval(timer), () => document.removeEventListener('visibilitychange', visible), () => document.removeEventListener(HOME_SHOWN, shown)];
  });
  return section;
}

const KEPT_UPDATE = 'orbit:tile-row-update';

/**
 * Runs `update` on `row` each time something `subscribe` sets up pokes it,
 * for as long as the row is kept. Home drops a row it replaces (Live TV
 * favourites changed, the row taken out and added again); the subscriptions
 * hold the row only weakly, so it can be freed, and the next poke after that
 * ends them (the timer, the listeners) instead of leaving them behind.
 */
function whileKept<T = void>(row: HTMLElement, update: (detail: T) => void, subscribe: (poke: (detail: T) => void) => (() => unknown)[]): void {
  row.addEventListener(KEPT_UPDATE, (event) => update((event as CustomEvent<T>).detail));
  const ref = new WeakRef(row);
  const stops = subscribe((detail) => {
    const kept = ref.deref();
    if (kept) kept.dispatchEvent(new CustomEvent(KEPT_UPDATE, { detail }));
    else for (const stop of stops) stop();
  });
}
