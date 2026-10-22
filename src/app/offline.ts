import { t } from '../i18n';
import { toast } from '../components/toast';
import { h } from '../lib/dom';

/**
 * The "You're offline" banner under the title bar. It follows the browser's
 * online/offline events; Try again just rechecks, since requests resume on
 * their own once the connection is back.
 */
export function createOfflineBanner(): HTMLElement {
  const retry = h('button', { class: 'button' }, t('browse.search.retry'));
  const banner = h(
    'div',
    { class: 'offline-banner', role: 'status' },
    h('span', { class: 'offline-dot', 'aria-hidden': 'true' }),
    h('strong', {}, t('browse.offline.title')),
    h('span', { class: 'offline-detail' }, t('browse.offline.detail')),
    retry,
  );

  const sync = () => (banner.hidden = navigator.onLine);
  retry.addEventListener('click', () => {
    sync();
    if (!navigator.onLine) toast(t('browse.offline.still'));
  });
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
  return banner;
}
