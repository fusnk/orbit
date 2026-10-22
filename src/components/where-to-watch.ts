/** Regional provider artwork from Rust's validated TMDB response; never addon HTML. */
import { badgeProviders, titleTopics } from '../catalog/title-topics';
import type { Title } from '../catalog/titles';
import { t } from '../i18n';
import { h } from '../lib/dom';
import { appearance } from '../theme/appearance';

export function whereToWatchSlot(title: Pick<Title, 'id' | 'type'>): HTMLElement {
  const slot = h('span', { class: 'watch-badge-slot' });
  if (!appearance().whereToWatch) return slot;
  void titleTopics(title).then((topics) => {
    if (!appearance().whereToWatch) return;
    slot.replaceChildren(...badgeProviders(topics).map((provider) => {
      const label = t('showcase.streaming-on', { provider: provider.name });
      const badge = h('span', { class: 'watch-badge', title: label }, h('img', { src: provider.logo, alt: label, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }));
      // Broken artwork must not leave an unknown provider or a dangling gap.
      badge.querySelector('img')!.addEventListener('error', () => badge.remove(), { once: true });
      return badge;
    }));
  }, () => {});
  return slot;
}
