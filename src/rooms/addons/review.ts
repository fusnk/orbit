/**
 * "What this addon can do", drawn from `reviewManifest` (src/addons/review.ts).
 * Shown before installing, again from an addon's details page, and for each
 * addon in a bundle. Everything from the addon is set as text.
 */
import type { AddonReview } from '../../addons/review';
import { formatList, t, tn, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import './addons.css';

const TYPE_LABELS: Record<string, MessageKey> = {
  movie: 'integrations.addons.type-movie',
  series: 'integrations.addons.type-series',
  anime: 'integrations.addons.type-anime',
  tv: 'integrations.addons.type-tv',
  channel: 'integrations.addons.type-channel',
  other: 'integrations.addons.type-other',
};

const typeLabel = (type: string) => (TYPE_LABELS[type] ? t(TYPE_LABELS[type]) : type);
const list = (items: string[]) => formatList(items);

/** What the addon offers, one line each. */
function provides(review: AddonReview): string[] {
  const lines: string[] = [];
  const { catalogs } = review;
  if (catalogs.count) {
    const rest = catalogs.count - catalogs.names.length;
    const names = rest > 0 ? `${list(catalogs.names)} ${tn('integrations.review.more', rest)}` : list(catalogs.names);
    lines.push(tn('integrations.review.catalogs', catalogs.count, { names }));
  }
  if (review.meta) lines.push(t('integrations.review.meta'));
  if (review.streams) lines.push(t('integrations.review.streams'));
  if (review.subtitles) lines.push(t('integrations.review.subtitles'));
  if (review.addonCatalogs) lines.push(tn('integrations.review.addon-catalogs', review.addonCatalogs));
  if (review.otherResources.length) lines.push(t('integrations.review.other-resources', { names: list(review.otherResources) }));
  return lines;
}

/** The flags worth a closer look, as [text, warn]. */
function notes(review: AddonReview): [string, boolean][] {
  const out: [string, boolean][] = [];
  if (review.needsSetup) out.push([t('integrations.review.needs-setup'), false]);
  else if (review.configurable) out.push([t('integrations.review.configurable'), false]);
  if (review.p2p) out.push([t('integrations.review.p2p'), true]);
  if (review.adult) out.push([t('integrations.review.adult'), true]);
  return out;
}

/**
 * The review. `compact` (for bundle lists) leaves out the heading and the
 * network note, which the bundle page states once for all.
 */
export function renderReview(review: AddonReview, options: { compact?: boolean } = {}): HTMLElement {
  const lines = provides(review);
  const ids = [...review.ids.known, ...review.ids.other];
  const { source } = review;
  const facts: (HTMLElement | string)[] = [];
  if (review.types.length) facts.push(h('p', { class: 'muted' }, t('integrations.review.types', { types: list(review.types.map(typeLabel)) })));
  if (ids.length) facts.push(h('p', { class: 'muted' }, t('integrations.review.ids', { ids: list(ids) })));

  return h(
    'section',
    { class: options.compact ? 'addon-review compact' : 'addon-review', 'aria-label': t('integrations.review.heading') },
    options.compact ? '' : h('h3', {}, t('integrations.review.heading')),
    source && !options.compact
      ? h(
          'p',
          { class: 'addon-review-source' },
          t('integrations.review.from', { host: source.host }),
          h('span', { class: 'badge' }, source.local ? t('integrations.review.local') : t('integrations.review.secure')),
        )
      : '',
    h('ul', { class: 'addon-review-list' }, ...(lines.length ? lines : [t('integrations.review.nothing')]).map((line) => h('li', {}, line))),
    ...facts,
    ...notes(review).map(([text, warn]) => h('p', { class: warn ? 'addon-review-note warn' : 'addon-review-note' }, text)),
    options.compact
      ? ''
      : h('p', { class: 'muted' }, source ? t('integrations.review.network', { host: source.host }) : t('integrations.review.network-unknown')),
  );
}
