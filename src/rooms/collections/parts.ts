/** Pieces the collection pages share: tiles, source names and states, the TMDB hint, playing a franchise in order. */
import type { RoomContext } from '../../app/router';
import { usableAddons } from '../../catalog/service';
import { tmdbConnected } from '../../catalog/tmdb';
import type { Title } from '../../catalog/titles';
import { artImage } from '../../components/cards';
import { toast } from '../../components/toast';
import { t, tn, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { settings } from '../../lib/ipc';
import { sourceLabel, type SourceContext, type SourceStatus } from '../../library/collection-sources';
import { coverOf, type Collection, type CollectionSource, type Shape, type TmdbKind } from '../../library/collections';
import { enqueue, loadQueue, QUEUE_LIMIT, queueItems, titleQueued } from '../../library/queue';
import { isWatched } from '../../library/watch';
import { playTitle } from '../detail/streams';
import { openSettingsTo } from '../settings';

/** The installed addons and whether TMDB is connected, for mapping sources. */
export async function sourceContext(): Promise<SourceContext> {
  const [addons, tmdb] = await Promise.all([usableAddons().catch(() => []), tmdbConnected()]);
  return { addons, tmdb };
}

const TMDB_KIND_LABELS: Record<TmdbKind, MessageKey> = {
  collection: 'collections.tmdb.collection',
  list: 'collections.tmdb.list',
  company: 'collections.tmdb.company',
  network: 'collections.tmdb.network',
  person: 'collections.tmdb.person',
  director: 'collections.tmdb.director',
  discover: 'collections.tmdb.discover',
};
export const tmdbKindLabel = (kind: TmdbKind) => t(TMDB_KIND_LABELS[kind]);

/** What a source is, when it has no name of its own: "TMDB collection 10", "Trakt list". */
export function sourceKindName(source: CollectionSource): string {
  switch (source.kind) {
    case 'addon':
      return t('collections.source.addon', { addon: source.addonName ?? source.addon });
    case 'tmdb':
      return source.id ? t('collections.source.tmdb-id', { kind: tmdbKindLabel(source.tmdb), id: source.id }) : tmdbKindLabel(source.tmdb);
    case 'trakt':
      return t('collections.source.trakt');
  }
}

export const sourceName = (source: CollectionSource, ctx: SourceContext) => sourceLabel(source, ctx, sourceKindName);

/** "✓ Ready", "Needs the addon X", "Needs a TMDB key", "Not supported". */
export function statusText(status: SourceStatus): string {
  switch (status.state) {
    case 'ok':
      return t('collections.status.ok');
    case 'needs-addon':
      return t('collections.status.needs-addon', { addon: status.name ?? status.addon });
    case 'missing-catalog':
      return t('collections.status.missing-catalog', { addon: status.addonName });
    case 'needs-tmdb':
      return t('collections.status.needs-tmdb');
    case 'unsupported':
      return t(status.reason === 'trakt' ? 'collections.status.trakt' : 'collections.status.tmdb-shows');
  }
}

/** A collection's tile: its cover (or a poster from it) and its name. `shape` overrides its own. */
export function collectionTile(c: Collection, onOpen: () => void, shape: Shape = c.shape): HTMLElement {
  const art = coverOf(c);
  const tile = h(
    'button',
    { class: `collection-tile ${shape}`, title: c.name, 'data-focus-id': `collection:${c.id}` },
    // The name shown in place of a missing cover is the picture's: screen readers hear the name once, from under it.
    h('span', { class: 'collection-tile-art', 'aria-hidden': 'true' }, h('span', { class: 'collection-tile-fallback' }, c.name), art ? artImage(art, 'art') : ''),
    h('span', { class: 'collection-tile-name' }, c.name),
  );
  tile.addEventListener('click', onOpen);
  return tile;
}

export const HINT_DISMISSED = 'collections.tmdb-hint-dismissed';

/**
 * "Add a TMDB key to see franchise collections", with a way to Settings and
 * a way to dismiss it for good. Shown only while no TMDB token is saved (and
 * `always` shows it even after dismissing, where a TMDB source was chosen).
 */
export function tmdbHint(ctx: RoomContext, options: { always?: boolean } = {}): HTMLElement {
  const open = h('button', { class: 'button primary small' }, t('search.no-tmdb.open'));
  const dismiss = h('button', { class: 'button glass small' }, t('collections.hint.dismiss'));
  const hint = h('div', { class: 'collections-hint', role: 'note', hidden: true }, h('p', {}, t('collections.hint.text')), h('div', { class: 'collections-hint-actions' }, open, options.always ? '' : dismiss));
  open.addEventListener('click', () => {
    openSettingsTo('integrations', '.tmdb-row');
    ctx.go('settings');
  });
  dismiss.addEventListener('click', () => {
    hint.hidden = true;
    void settings.set(HINT_DISMISSED, true).catch((err: unknown) => console.warn('Could not save the hint choice', err));
  });
  void Promise.all([tmdbConnected(), options.always ? false : settings.get(HINT_DISMISSED).catch(() => false)]).then(([connected, dismissed]) => {
    hint.hidden = connected || dismissed === true;
  });
  return hint;
}

/** Films not seen yet, in order; all of them if every one has been. */
const unwatched = (titles: readonly Title[]) => {
  const left = titles.filter((title) => !isWatched(title));
  return left.length ? left : [...titles];
};

/** Plays the first film not seen yet and queues the rest after it, in order. */
export async function playInOrder(titles: readonly Title[], ctx: RoomContext): Promise<void> {
  const [first, ...rest] = unwatched(titles);
  if (!first) return;
  // Only the parts right after the first that fit (ones already queued just move), so none is skipped.
  await loadQueue();
  let room = QUEUE_LIMIT - queueItems().length;
  const queued: Title[] = [];
  for (const title of rest) {
    if (!titleQueued(title.id) && room-- <= 0) break;
    queued.push(title);
  }
  // Each goes to the front, so the last first: they end up in order, before anything already queued.
  for (const title of [...queued].reverse()) await enqueue(title, null, 'next');
  if (queued.length < rest.length) toast(t('watching.queue.full'));
  void playTitle(first, { ctx });
}

/** Queues the films not seen yet (all, if every one has been), in order. */
export async function queueInOrder(titles: readonly Title[]): Promise<void> {
  let added = 0;
  for (const title of unwatched(titles)) {
    const result = await enqueue(title, null, 'end');
    if (result === 'full') {
      toast(t('watching.queue.full'));
      break;
    }
    if (result === 'added') added++;
  }
  toast(added ? tn('collections.franchise.queued', added) : t('collections.franchise.queued-none'));
}
