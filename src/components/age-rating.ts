/**
 * The age-rating badge (PG-13, TV-MA, 12…) in a title's meta row, outlined
 * like a classification mark. The certification comes from TMDB through
 * Rust (catalog/parental.ts), in the person's region with the US as the
 * fallback; it's untrusted text, so it only ever becomes a text node.
 */
import { certificationFor, certificationOf } from '../catalog/parental';
import { cleanCertification } from '../catalog/ratings';
import type { Title } from '../catalog/titles';
import { t } from '../i18n';
import { h } from '../lib/dom';
import { appearance } from '../theme/appearance';

export function ageRatingBadge(cert: string): HTMLElement {
  return h('span', { class: 'cert', title: t('showcase.age-rating', { rating: cert }) }, cert);
}

/**
 * A place for `title`'s badge in a meta row, filled once its rating is known
 * (at once if it already is, else after the lookup). It stays empty when the
 * setting is off or the title is unrated, and brings its own separator dot
 * (`dot`), so nothing dangles. The slot is `display: contents` (styles.css),
 * so the badge lays out as one of the row's own items.
 */
export function ageRatingSlot(title: Pick<Title, 'id' | 'type'>, options: { dot?: boolean } = {}): HTMLElement {
  const slot = h('span', { class: 'cert-slot' });
  if (!appearance().ageRatings) return slot;
  const fill = (cert: string | null) => {
    const text = cleanCertification(cert);
    if (!text) return;
    const dot = options.dot ? [h('span', { class: 'meta-dot', 'aria-hidden': 'true' }, '·')] : [];
    slot.replaceChildren(...dot, ageRatingBadge(text));
  };
  const known = certificationOf(title);
  if (known) fill(known);
  else void certificationFor(title).then(fill, () => {});
  return slot;
}
