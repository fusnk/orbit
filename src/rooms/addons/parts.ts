import type { InstalledAddon, Manifest } from '../../addons/types';
import { locale, t } from '../../i18n';
import { h } from '../../lib/dom';

type Attrs = Record<string, string | boolean>;

export function actionButton(label: string, onClick: () => void, attrs: Attrs = {}): HTMLButtonElement {
  const button = h('button', { class: 'button', ...attrs }, label);
  button.addEventListener('click', onClick);
  return button;
}

/** Remote logos load without a referrer and fall back to an initial if they fail. */
export function addonLogo(name: string, logo: string | undefined): HTMLElement {
  const fallback = h('div', { class: 'addon-logo fallback', 'aria-hidden': 'true' }, name.slice(0, 1).toLocaleUpperCase(locale()));
  if (!logo) return fallback;
  const img = h('img', { class: 'addon-logo', src: logo, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(fallback));
  return img;
}

export function badgeList(manifest: Manifest | null, addon?: InstalledAddon): HTMLElement {
  const badges: [label: string, warn: boolean][] = [];
  if (addon?.builtIn) badges.push([t('integrations.addons.badge-built-in'), false]);
  if (addon?.sharedBy) badges.push([t('integrations.addons.badge-shared-by', { name: addon.sharedBy }), false]);
  if (addon && !addon.urlReadable) badges.push([t('integrations.addons.badge-reinstall'), true]);
  if (addon && !manifest) badges.push([t('integrations.addons.badge-invalid'), true]);
  if (manifest?.behaviorHints.adult) badges.push([t('integrations.addons.badge-adult'), false]);
  if (manifest?.behaviorHints.configurable) badges.push([t('integrations.addons.badge-configurable'), false]);
  if (manifest?.behaviorHints.p2p) badges.push(['P2P', false]);
  return h('div', { class: 'badges' }, ...badges.map(([label, warn]) => h('span', { class: warn ? 'badge warn' : 'badge' }, label)));
}
