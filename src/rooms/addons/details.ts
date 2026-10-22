import { aggregate } from '../../addons/aggregate';
import { describeAddonError } from '../../addons/errors';
import { installedSource, reviewManifest } from '../../addons/review';
import { CatalogResponseSchema, parseWith } from '../../addons/schema';
import type { ManifestCatalog, MetaPreview, Sourced, UsableAddon } from '../../addons/types';
import { t, tn } from '../../i18n';
import { h } from '../../lib/dom';
import { actionButton, addonLogo, badgeList } from './parts';
import { renderReview } from './review';

const PREVIEW_LIMIT = 30;

/** Addon detail page with a live catalog preview that exercises the full request pipeline. */
export function createDetails(addon: UsableAddon, onBack: () => void): HTMLElement {
  const { manifest } = addon;
  const previewArea = h('div', { class: 'catalog-preview', 'aria-live': 'polite' });
  let controller: AbortController | null = null;

  const back = actionButton(t('integrations.addons.back'), () => {
    controller?.abort();
    onBack();
  }, { class: 'button back' });

  async function runPreview(catalog: ManifestCatalog): Promise<void> {
    controller?.abort();
    controller = new AbortController();
    previewArea.replaceChildren(h('p', { class: 'muted' }, t('integrations.addons.loading-catalog', { name: catalog.name ?? catalog.id })));

    const events = aggregate(
      [addon],
      { resource: 'catalog', type: catalog.type, id: catalog.id },
      (json) => parseWith(CatalogResponseSchema, json).metas,
      (meta) => `${meta.type}:${meta.id}`,
      controller.signal,
    );
    for await (const event of events) {
      if (event.type === 'partial') previewArea.replaceChildren(renderMetas(event.items));
      else if (event.type === 'error') previewArea.replaceChildren(h('p', { class: 'status error' }, describeAddonError(event.error)));
      else if (event.succeeded + event.failed === 0) {
        previewArea.replaceChildren(h('p', { class: 'muted' }, t('integrations.addons.enable-to-preview')));
      }
    }
  }

  const catalogs = manifest.catalogs.map((catalog) => {
    const required = catalog.extra.filter((e) => e.isRequired);
    const filters = catalog.extra.map((e) => (e.isRequired ? t('integrations.addons.filter-required', { name: e.name }) : e.name)).join(', ');
    return h(
      'li',
      { class: 'catalog-item' },
      h(
        'div',
        {},
        h('strong', {}, catalog.name ?? catalog.id),
        h('span', { class: 'muted' }, ` ${catalog.type}`),
        filters ? h('p', { class: 'muted' }, t('integrations.addons.filters', { filters })) : '',
      ),
      actionButton(t('integrations.addons.preview'), () => void runPreview(catalog), {
        // Catalogs with a required extra (usually `search`) can't be listed without input.
        disabled: required.length > 0,
        title: required.length ? t('integrations.addons.needs', { names: required.map((e) => e.name).join(', ') }) : '',
      }),
    );
  });

  const resources = manifest.resources.map((r) => `${r.name} (${r.types.join(', ')})`).join(', ');

  // The same review as before installing, shown on request.
  const review = renderReview(reviewManifest(manifest, installedSource(addon.displayHost)));
  review.hidden = true;
  const showReview = actionButton(t('integrations.review.heading'), () => {
    review.hidden = !review.hidden;
    showReview.setAttribute('aria-expanded', String(!review.hidden));
  }, { 'aria-expanded': 'false' });

  return h(
    'div',
    { class: 'addon-details' },
    back,
    h(
      'div',
      { class: 'addon-heading' },
      addonLogo(manifest.name, manifest.logo),
      h('div', {}, h('h1', { dir: 'auto' }, manifest.name), h('p', { class: 'muted' }, `v${manifest.version} · ${addon.displayHost}`), badgeList(manifest, addon)),
    ),
    // The addon's own words, in its language: laid out by their first letters, not the page's direction.
    manifest.description ? h('p', { dir: 'auto' }, manifest.description) : '',
    h('div', { class: 'actions' }, showReview),
    review,
    h(
      'dl',
      { class: 'facts' },
      h('dt', {}, t('integrations.addons.id')),
      h('dd', {}, manifest.id),
      h('dt', {}, t('integrations.addons.types')),
      h('dd', {}, manifest.types.join(', ') || '—'),
      h('dt', {}, t('integrations.addons.resources')),
      h('dd', {}, resources || '—'),
    ),
    h('h2', {}, t('integrations.addons.catalogs')),
    catalogs.length ? h('ul', { class: 'catalog-list' }, ...catalogs) : h('p', { class: 'muted' }, t('integrations.addons.no-catalogs')),
    previewArea,
  );
}

/** A catalog preview's poster; one that doesn't load becomes the plain frame a title without one has. */
function previewPoster(src: string): HTMLElement {
  const img = h('img', { class: 'poster', src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(h('div', { class: 'poster fallback', 'aria-hidden': 'true' })), { once: true });
  return img;
}

function renderMetas(items: Sourced<MetaPreview>[]): HTMLElement {
  const shown = items.slice(0, PREVIEW_LIMIT);
  const count = items.length > shown.length ? tn('integrations.addons.titles-showing', items.length, { shown: shown.length }) : tn('integrations.addons.titles', items.length);
  return h(
    'div',
    {},
    h('p', { class: 'muted' }, count),
    h(
      'ul',
      { class: 'meta-grid' },
      ...shown.map(({ item, origins }) =>
        h(
          'li',
          { class: 'meta-card' },
          item.poster ? previewPoster(item.poster) : h('div', { class: 'poster fallback', 'aria-hidden': 'true' }),
          h('span', { class: 'meta-name' }, item.name),
          h('span', { class: 'muted' }, [item.releaseInfo, t('integrations.addons.via', { names: origins.map((o) => o.name).join(', ') })].filter(Boolean).join(' · ')),
        ),
      ),
    ),
  );
}
