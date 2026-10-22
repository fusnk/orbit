/**
 * A custom collection's page: its titles in a grid. A dynamic collection
 * shows each source it can (one tab per source when there are several),
 * loading more as you scroll, and says what the others need.
 */
import { markActivity } from '../../app/activity';
import { VIEW_DISCARDED, VIEW_SHOWN, type RoomContext } from '../../app/router';
import type { Title } from '../../catalog/titles';
import { artImage, gridSkeletons } from '../../components/cards';
import { icon } from '../../components/icons';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { errorState, errorText, stateMessage } from '../../components/state-message';
import { pagingDone, sourcePager, sourceStatus, type Pager, type SourceContext } from '../../library/collection-sources';
import { findCollection, isDynamic, onCollectionsChange, removeFromCollection, type Collection } from '../../library/collections';
import { titleHandlers } from '../detail/open';
import { titleCard } from '../title-card';
import { createCollectionEditor } from './edit';
import { sourceContext, sourceName, statusText, tmdbHint } from './parts';
import { LONG_COLLECTION, matchesQuery } from './search';
import './collections.css';

export function createCollectionPage(id: string, ctx: RoomContext): HTMLElement {
  const { openDetail, withMenu } = titleHandlers(ctx);
  const header = h('header', { class: 'collection-hero' });
  const notes = h('div', { class: 'collection-notes' });
  const tabs = h('div', { class: 'segments collection-tabs', role: 'group', 'aria-label': t('collections.page.sources') });
  const grid = h('div', { class: 'title-grid' });
  const status = h('div', { class: 'grid-status' });
  const sentinel = h('div', { class: 'grid-sentinel', 'aria-hidden': 'true' });
  // A long collection of picked titles can be searched; one filled by sources pages in as you scroll, so it isn't.
  const search = createTextField({ label: t('collections.search.titles-label'), placeholder: t('collections.search.titles-placeholder'), onSubmit: () => {}, className: 'collections-search' });
  search.hidden = true;
  /** The picked titles' cards, made once per change, so typing only filters them. */
  let fixedCards: { title: Title; card: HTMLElement }[] = [];
  search.addEventListener('input', () => showFixed());
  const page = h('div', { class: 'collection-page' }, header, notes, tabs, search, grid, status, sentinel);
  // The collection's name stays private, like a list's.
  markActivity(page, t('collections.activity'));

  let context: SourceContext | null = null;
  let shown = '';
  let tab = 0;
  let pager: Pager | null = null;
  let done = true;
  let loading = false;
  let generation = 0;
  let items = 0;

  const card = (title: Title) => titleCard(title, () => openDetail(title), {}, (c) => withMenu(c, title));

  function drawHeader(c: Collection): void {
    const edit = h('button', { class: 'button glass', 'data-focus-id': 'collection-edit', 'data-autofocus': true }, icon('pencil'), t('collections.page.edit'));
    edit.addEventListener('click', () => ctx.open(createCollectionEditor(c.id, ctx)));
    header.replaceChildren(
      c.backdrop ? artImage(c.backdrop, 'collection-hero-art', true) : '',
      h('div', { class: 'collection-hero-shade', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'collection-hero-text' },
        h('span', { class: 'eyebrow' }, c.group ? t('collections.page.eyebrow-group', { group: c.group }) : t('collections.page.eyebrow')),
        h('h1', { class: 'page-title' }, c.name),
        h('p', { class: 'muted' }, isDynamic(c) ? tn('collections.page.source-count', c.sources.length) : tn('collections.page.title-count', c.titles.length)),
        h('div', { class: 'hero-actions' }, edit),
      ),
    );
  }

  function draw(): void {
    const c = findCollection(id);
    if (!c) {
      // Deleted: there's nothing left to show.
      if (page.isConnected) queueMicrotask(() => page.isConnected && ctx.back());
      return;
    }
    drawHeader(c);
    // Only a change to what it shows starts the grid over.
    const key = JSON.stringify([c.sources, c.titles.map((title) => title.id)]);
    if (key === shown || !context) return;
    shown = key;
    if (!isDynamic(c)) {
      notes.replaceChildren();
      tabs.hidden = true;
      done = true;
      const active = document.activeElement;
      const at = [...grid.children].findIndex((el) => el.contains(active));
      fixedCards = c.titles.map((title) => ({
        title,
        card: titleCard(title, () => openDetail(title), {}, (card) =>
          withMenu(card, title, [
            // The name as it is then: a rename doesn't redraw the cards (see `key`).
            { label: t('collections.page.remove'), action: () => void removeFromCollection(id, title.id).then(() => toast(t('collections.page.removed', { name: title.name, collection: findCollection(id)?.name ?? c.name }))).catch((err: unknown) => toast(errorText(err))) },
          ]),
        ),
      }));
      search.hidden = c.titles.length < LONG_COLLECTION;
      if (search.hidden) search.value = '';
      showFixed();
      if (!c.titles.length) status.replaceChildren(h('div', { class: 'grid-message empty' }, h('span', { class: 'home-message-title' }, t('collections.page.empty')), h('p', { class: 'muted' }, t('collections.page.empty-fixed'))));
      // A card that was focused (e.g. just removed from its menu): focus stays at its place, or goes to Edit when none are left.
      if (at >= 0 && !grid.contains(document.activeElement)) {
        const focusId = active instanceof HTMLElement ? active.dataset.focusId : undefined;
        const same = focusId ? grid.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`) : null;
        const next = same ?? (grid.children[Math.min(at, grid.children.length - 1)] as HTMLElement | undefined);
        (next ?? header.querySelector<HTMLElement>('[data-focus-id="collection-edit"]'))?.focus({ preventScroll: true });
      }
      return;
    }
    search.hidden = true;
    search.value = '';
    fixedCards = [];
    drawSources(c, context);
  }

  /** The picked titles that match the search. */
  function showFixed(): void {
    const shownCards = fixedCards.filter(({ title }) => matchesQuery(search.value, title.name));
    grid.replaceChildren(...shownCards.map(({ card }) => card));
    status.replaceChildren(fixedCards.length && !shownCards.length ? h('div', { class: 'grid-message empty' }, h('span', { class: 'home-message-title' }, t('collections.search.no-titles'))) : '');
  }

  function drawSources(c: Collection, ctxSources: SourceContext): void {
    const states = c.sources.map((source) => sourceStatus(source, ctxSources));
    const usable = c.sources.flatMap((source, i) => (states[i]!.state === 'ok' ? [source] : []));
    // What the others need, said once each.
    const problems = [...new Set(c.sources.flatMap((source, i) => (states[i]!.state === 'ok' ? [] : [`${sourceName(source, ctxSources)} — ${statusText(states[i]!)}`])))];
    notes.replaceChildren(...problems.map((text) => h('p', { class: 'collection-note' }, text)), states.some((s) => s.state === 'needs-tmdb') ? tmdbHint(ctx, { always: true }) : '');
    tab = Math.min(tab, Math.max(0, usable.length - 1));
    tabs.hidden = usable.length < 2;
    tabs.replaceChildren(
      ...usable.map((source, i) => {
        const button = h('button', { class: 'segment', 'aria-pressed': String(i === tab) }, sourceName(source, ctxSources));
        button.addEventListener('click', () => {
          tab = i;
          tabs.querySelectorAll('.segment').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
          start(sourcePager(source, ctxSources));
        });
        return button;
      }),
    );
    const current = usable[tab];
    start(current ? sourcePager(current, ctxSources) : null);
  }

  function start(next: Pager | null): void {
    generation++;
    pager = next;
    items = 0;
    done = !next;
    loading = false;
    grid.removeAttribute('aria-busy');
    grid.replaceChildren();
    status.replaceChildren(next ? '' : h('div', { class: 'grid-message empty' }, h('span', { class: 'home-message-title' }, t('collections.page.empty')), h('p', { class: 'muted' }, t('collections.page.empty-sources'))));
    loadMore();
  }

  function loadMore(): void {
    if (loading || done || !pager) return;
    const current = generation;
    loading = true;
    // Screen readers hold the grid's changes until the page is in.
    grid.setAttribute('aria-busy', 'true');
    status.replaceChildren(h('div', { class: 'title-grid' }, ...gridSkeletons(items ? 7 : 14)));
    pager
      .next()
      .then((result) => {
        if (current !== generation) return;
        // A title in two pages (or sources that overlap) shows once.
        const have = new Set([...grid.querySelectorAll<HTMLElement>('[data-focus-id^="poster:"]')].map((el) => el.dataset.focusId));
        const fresh = result.titles.filter((title) => !have.has(`poster:${title.id}`));
        done = pagingDone(result, fresh.length);
        items += fresh.length;
        grid.append(...fresh.map(card));
        status.replaceChildren(items || !done ? '' : stateMessage({ icon: 'list', title: t('collections.page.empty'), detail: t('collections.page.empty-source') }));
        // The observer only reports changes: when a page didn't fill a tall
        // window (or added nothing new), observing again asks whether the sentinel is still in view.
        if (!done) {
          pagerObserver.unobserve(sentinel);
          pagerObserver.observe(sentinel);
        }
      })
      .catch((err: unknown) => {
        if (current !== generation) return;
        status.replaceChildren(errorState({ title: t('collections.page.failed'), err, retry: loadMore, go: ctx.go }));
      })
      .finally(() => {
        if (current !== generation) return;
        loading = false;
        grid.removeAttribute('aria-busy');
      });
  }

  const pagerObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadMore();
  }, { rootMargin: '600px' });
  pagerObserver.observe(sentinel);
  const stop = onCollectionsChange(draw);
  // Back from the editor after deleting it: the page closes too.
  page.addEventListener(VIEW_SHOWN, draw);
  // A pushed page: once it's dropped, it stops listening.
  page.addEventListener(
    VIEW_DISCARDED,
    () => {
      stop();
      pagerObserver.disconnect();
    },
    { once: true },
  );

  const c = findCollection(id);
  if (c) drawHeader(c);
  void sourceContext().then((found) => {
    context = found;
    draw();
  });
  return page;
}
