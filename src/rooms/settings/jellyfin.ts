/**
 * Settings → Integrations → Jellyfin: sign in to the person's own server.
 * The password goes to Rust once, which signs in and keeps only the server's
 * token (sealed); the page learns who is connected to which server.
 */
import { createTextField } from '../../components/text-field';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { connectJellyfin, disconnectJellyfin, jellyfinStatus, type JellyfinStatus } from '../../library/jellyfin';
import { addServerLatestRow } from '../home/rows';
import { row } from './playback';
import { errorText } from '../../components/state-message';

export function jellyfinSection(): HTMLElement {
  const body = h('div', {});
  const message = h('p', { class: 'provider-message', role: 'status' });

  function showConnected(status: JellyfinStatus): void {
    const disconnect = h('button', { class: 'button danger' }, t('jellyfin.settings.disconnect'));
    disconnect.addEventListener('click', () => {
      disconnect.disabled = true;
      void disconnectJellyfin()
        .then(() => {
          message.textContent = t('jellyfin.settings.disconnected');
          showForm();
          body.querySelector<HTMLElement>('input')?.focus();
        })
        .catch((err: unknown) => {
          message.textContent = errorText(err, { service: 'jellyfin', action: true });
          disconnect.disabled = false;
        });
    });
    const label = h(
      'span',
      { class: 'provider-status' },
      t('jellyfin.settings.connected-as', { user: status.userName, server: status.serverName }),
      status.insecure ? h('span', { class: 'tv-insecure', title: t('jellyfin.settings.insecure-title') }, t('jellyfin.settings.insecure')) : '',
    );
    body.replaceChildren(row(t('jellyfin.settings.server-label'), status.host, h('div', { class: 'provider-key' }, label, disconnect)));
  }

  function showForm(): void {
    const field = (label: string, placeholder: string) => createTextField({ label, placeholder, onSubmit: () => void connect() });
    const server = field(t('jellyfin.settings.server'), t('jellyfin.settings.server-placeholder'));
    server.type = 'url';
    const username = field(t('jellyfin.settings.username'), t('jellyfin.settings.username'));
    const password = field(t('jellyfin.settings.password'), t('jellyfin.settings.password'));
    password.type = 'password';
    const button = h('button', { class: 'button primary' }, t('jellyfin.settings.connect'));
    button.addEventListener('click', () => void connect());

    async function connect(): Promise<void> {
      if (!server.value.trim() || !username.value.trim() || button.disabled) return;
      button.disabled = true;
      message.textContent = t('jellyfin.settings.connecting');
      try {
        const { status, first } = await connectJellyfin(server.value, username.value, password.value);
        password.value = '';
        if (first) await addServerLatestRow('jellyfin').catch((err: unknown) => console.warn('Could not add the Jellyfin row to Home', err));
        message.textContent = first ? t('jellyfin.settings.connected-first', { server: status.serverName }) : t('jellyfin.settings.connected', { server: status.serverName });
        showConnected(status);
      } catch (err) {
        message.textContent = errorText(err, { service: 'jellyfin', action: true });
        button.disabled = false;
      }
    }

    body.replaceChildren(h('div', { class: 'tv-fields' }, server, username, password), h('p', { class: 'setting-hint' }, t('jellyfin.settings.fields-hint')), h('div', { class: 'hero-actions' }, button));
  }

  void jellyfinStatus().then((status) => (status ? showConnected(status) : showForm()));
  return h('div', { class: 'jellyfin-section tv-add' }, h('h3', { class: 'settings-subheading' }, 'Jellyfin'), h('p', { class: 'muted settings-intro' }, t('jellyfin.settings.intro')), body, message);
}
