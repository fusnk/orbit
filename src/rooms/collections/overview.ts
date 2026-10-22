/**
 * All of the profile's collections: a tile each, in the person's order, with
 * New, Import, Export and Arrange (move up or down, with keys or a controller).
 */
import { markActivity } from '../../app/activity';
import { VIEW_DISCARDED, type RoomContext } from '../../app/router';
import { rail } from '../../components/cards';
import { createTextField } from '../../components/text-field';
import { toast } from '../../components/toast';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { collectionsLoadError, customCollections, loadCollections, onCollectionsChange, saveExport, shiftCollection, type Collection } from '../../library/collections';
import { exportCollections } from '../../library/nuvio-collections';
import { createCollectionEditor } from './edit';
import { createImportPage } from './import';
import { createCollectionPage } from './page';
import { collectionTile, tmdbHint } from './parts';
import { findCollections } from './search';
import './collections.css';
import { errorState, errorText } from '../../components/state-message';

/**
 * A Home row of collection tiles. Row styles: Poster keeps each collection's
 * own shape, Landscape and Top 10 make them all landscape or all posters.
 * With none yet, it says how to make or import some.
 */
export function collectionsRail(options: { title: string; collections: readonly Collection[]; style: 'poster' | 'landscape' | 'top10'; ctx: RoomContext }): HTMLElement {
  const { ctx } = options;
  const seeAll = () => ctx.open(createCollectionsPage(ctx));
  if (!options.collections.length) {
    const open = h('button', { class: 'button' }, t('collections.row.open'));
    open.addEventListener('click', seeAll);
    return h(
      'section',
      { class: 'rail' },
      h('div', { class: 'rail-header' }, h('h2', { class: 'rail-heading' }, options.title)),
      h('div', { class: 'rail-header collections-row-empty' }, h('p', { class: 'muted' }, t('collections.row.empty')), open, tmdbHint(ctx)),
    );
  }
  const shape = options.style === 'landscape' ? 'landscape' : options.style === 'top10' ? 'poster' : undefined;
  return rail({ title: options.title, onSeeAll: seeAll, cards: options.collections.map((c) => collectionTile(c, () => ctx.open(createCollectionPage(c.id, ctx)), shape ?? c.shape)) });
}

export function createCollectionsPage(ctx: RoomContext): HTMLElement {
  let arranging = false;
  const body = h('div', { class: 'collections-body' });
  const status = h('div', { class: 'status', role: 'status' });
  const button = (label: string, run: () => void, cls = 'button glass') => {
    const b = h('button', { class: cls }, label);
    b.addEventListener('click', run);
    return b;
  };
  const arrange = button(t('collections.overview.arrange'), () => {
    arranging = !arranging;
    arrange.setAttribute('aria-pressed', String(arranging));
    draw();
  });
  arrange.setAttribute('aria-pressed', 'false');
  const exportButton = button(t('collections.overview.export'), () => showExport());
  // Finds a collection by name or group; filters as you type.
  const search = createTextField({ label: t('collections.search.label'), placeholder: t('collections.search.placeholder'), onSubmit: () => {}, className: 'collections-search' });
  search.addEventListener('input', () => draw());

  const page = h(
    'div',
    { class: 'collections-page' },
    h(
      'header',
      { class: 'list-page-header' },
      h('div', {}, h('h1', { class: 'page-title' }, t('collections.overview.title')), h('p', { class: 'muted' }, t('collections.overview.intro'))),
      h(
        'div',
        { class: 'hero-actions' },
        button(t('collections.overview.new'), () => ctx.open(createCollectionEditor(null, ctx)), 'button primary'),
        button(t('collections.overview.import'), () => ctx.open(createImportPage(ctx))),
        exportButton,
        arrange,
      ),
    ),
    tmdbHint(ctx),
    status,
    search,
    body,
  );
  markActivity(page, t('collections.activity'));

  function draw(): void {
    const all = customCollections();
    const focusId = document.activeElement instanceof HTMLElement && body.contains(document.activeElement) ? document.activeElement.dataset.focusId : undefined;
    exportButton.disabled = !all.length;
    arrange.disabled = all.length < 2;
    // Fewer than two (one deleted from its editor): nothing to arrange, and Arrange can't be pressed to leave.
    if (all.length < 2 && arranging) {
      arranging = false;
      arrange.setAttribute('aria-pressed', 'false');
    }
    // Arranging moves every collection, so it shows them all.
    search.hidden = !all.length || arranging;
    // Collections that couldn't be read aren't "none yet": say so, with Try again.
    const loadError = collectionsLoadError();
    if (!all.length && loadError !== null) {
      body.replaceChildren(errorState({ title: t('states.collections.failed'), err: loadError, retry: () => void loadCollections().then(draw) }));
      return;
    }
    if (!all.length) {
      body.replaceChildren(h('div', { class: 'grid-message empty' }, h('span', { class: 'home-message-title' }, t('collections.overview.empty')), h('p', { class: 'muted' }, t('collections.overview.empty-detail'))));
      return;
    }
    const open = (id: string) => () => ctx.open(createCollectionPage(id, ctx));
    if (!arranging) {
      const found = findCollections(all, search.value);
      body.replaceChildren(
        found.length
          ? h('div', { class: 'collections-grid' }, ...found.map((c) => collectionTile(c, open(c.id))))
          : h('div', { class: 'grid-message empty' }, h('span', { class: 'home-message-title' }, t('collections.search.none')), h('p', { class: 'muted' }, t('collections.search.none-detail'))),
      );
    } else {
      body.replaceChildren(
        h(
          'ol',
          { class: 'home-rows-list', 'aria-label': t('collections.overview.arrange') },
          ...all.map((c, i) => {
            const move = (step: -1 | 1) => void shiftCollection(c.id, step).catch((err: unknown) => toast(errorText(err)));
            const up = h('button', { class: 'button', 'data-focus-id': `${c.id}:up`, disabled: i === 0, 'aria-label': t('settings.library.move-up', { name: c.name }) }, t('settings.library.up'));
            up.addEventListener('click', () => move(-1));
            const down = h('button', { class: 'button', 'data-focus-id': `${c.id}:down`, disabled: i === all.length - 1, 'aria-label': t('settings.library.move-down', { name: c.name }) }, t('settings.library.down'));
            down.addEventListener('click', () => move(1));
            const edit = h('button', { class: 'button', 'data-focus-id': `${c.id}:edit` }, t('collections.page.edit'));
            edit.addEventListener('click', () => ctx.open(createCollectionEditor(c.id, ctx)));
            return h('li', { class: 'home-row-item' }, h('span', { class: 'home-row-name' }, c.group ? `${c.name} · ${c.group}` : c.name), h('div', { class: 'home-row-controls' }, edit, up, down));
          }),
        ),
      );
    }
    // Redrawing replaces the controls; focus goes back to the same one (or its row's other).
    if (focusId) {
      const row = focusId.split(':')[0]!;
      (body.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]:not(:disabled)`) ?? body.querySelector<HTMLElement>(`[data-focus-id^="${CSS.escape(row)}:"]:not(:disabled)`))?.focus();
    }
  }

  function showExport(): void {
    const text = JSON.stringify(exportCollections(customCollections(), t('collections.export.ungrouped')), null, 2);
    const save = button(t('integrations.bundle.save'), () => {
      void saveExport(text)
        .then((path) => path && (result.textContent = t('integrations.bundle.saved-to', { path })))
        .catch((err: unknown) => (result.textContent = errorText(err)));
    }, 'button primary');
    const copy = button(t('integrations.bundle.copy'), () => {
      navigator.clipboard
        .writeText(text)
        .then(() => (result.textContent = t('integrations.bundle.copied')))
        .catch(() => {
          // Where the clipboard isn't allowed, the text is shown to copy by hand.
          const area = h('textarea', { class: 'diagnostics-text', readonly: true, rows: '10', 'aria-label': t('collections.overview.export') });
          area.value = text;
          result.replaceChildren(t('integrations.bundle.copy-failed'), area);
        });
    });
    const result = h('p', { class: 'muted' });
    status.replaceChildren(h('div', { class: 'collections-export' }, h('p', {}, tn('collections.export.summary', customCollections().length)), h('div', { class: 'actions' }, save, copy), result));
    save.focus();
  }

  const stop = onCollectionsChange(draw);
  page.addEventListener(VIEW_DISCARDED, () => void stop(), { once: true });
  void loadCollections().then(draw);
  draw();
  return page;
}
