/**
 * Settings → Integrations → Plex: sign in with Plex's own page in the
 * browser (Orbit never sees the password), then pick a server if the
 * account has several. Rust keeps the tokens (sealed); the page learns who
 * is connected to which server.
 */
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { cancelPlexSignIn, choosePlexServer, disconnectPlex, plexStatus, reopenPlexSignIn, startPlexSignIn, waitForPlexSignIn, type PlexServerChoice, type PlexStatus } from '../../library/plex';
import { addServerLatestRow } from '../home/rows';
import { row } from './playback';
import { errorText } from '../../components/state-message';

export function plexSection(): HTMLElement {
  const body = h('div', {});
  const message = h('p', { class: 'provider-message', role: 'status' });
  /** Bumped when the person starts over or cancels, so a late answer is ignored. */
  let attempt = 0;

  const focusFirst = () => body.querySelector<HTMLElement>('button')?.focus();

  function showConnected(status: PlexStatus): void {
    const disconnect = h('button', { class: 'button danger' }, t('plex.settings.disconnect'));
    disconnect.addEventListener('click', () => {
      disconnect.disabled = true;
      void disconnectPlex()
        .then(() => {
          message.textContent = t('plex.settings.disconnected');
          showStart();
          focusFirst();
        })
        .catch((err: unknown) => {
          message.textContent = errorText(err, { service: 'plex', action: true });
          disconnect.disabled = false;
        });
    });
    const label = h(
      'span',
      { class: 'provider-status' },
      t('plex.settings.connected-as', { user: status.userName, server: status.serverName }),
      status.insecure ? h('span', { class: 'tv-insecure', title: t('plex.settings.insecure-title') }, t('plex.settings.insecure')) : '',
    );
    body.replaceChildren(row(t('plex.settings.server-label'), status.host, h('div', { class: 'provider-key' }, label, disconnect)));
  }

  async function choose(server: PlexServerChoice, run: number): Promise<void> {
    message.textContent = t('plex.settings.reaching', { server: server.name });
    for (const b of body.querySelectorAll('button')) b.disabled = true;
    try {
      const { status, first } = await choosePlexServer(server.id);
      if (run !== attempt) return;
      if (first) await addServerLatestRow('plex').catch((err: unknown) => console.warn('Could not add the Plex row to Home', err));
      message.textContent = first ? t('plex.settings.connected-first', { server: status.serverName }) : t('plex.settings.connected', { server: status.serverName });
      showConnected(status);
      focusFirst();
    } catch (err) {
      if (run !== attempt) return;
      message.textContent = errorText(err, { service: 'plex', action: true });
      for (const b of body.querySelectorAll('button')) b.disabled = false;
    }
  }

  function showServers(servers: PlexServerChoice[], run: number): void {
    const buttons = servers.map((server) => {
      const button = h('button', { class: 'button' }, server.owned ? server.name : t('plex.settings.shared', { server: server.name }));
      button.addEventListener('click', () => void choose(server, run));
      return button;
    });
    const cancel = h('button', { class: 'button' }, t('plex.settings.cancel'));
    cancel.addEventListener('click', () => void stop());
    message.textContent = t('plex.settings.choose');
    body.replaceChildren(h('div', { class: 'hero-actions' }, ...buttons, cancel));
    focusFirst();
  }

  async function stop(): Promise<void> {
    attempt++;
    await cancelPlexSignIn().catch(() => undefined);
    message.textContent = '';
    showStart();
    focusFirst();
  }

  async function connect(): Promise<void> {
    const run = ++attempt;
    message.textContent = t('plex.settings.opening');
    try {
      await startPlexSignIn();
    } catch (err) {
      if (run === attempt) message.textContent = errorText(err, { service: 'plex', action: true });
      return;
    }
    if (run !== attempt) return;
    const again = h('button', { class: 'button' }, t('plex.settings.open-again'));
    again.addEventListener('click', () => void reopenPlexSignIn().catch((err: unknown) => (message.textContent = errorText(err, { service: 'plex', action: true }))));
    const cancel = h('button', { class: 'button' }, t('plex.settings.cancel'));
    cancel.addEventListener('click', () => void stop());
    message.textContent = t('plex.settings.waiting');
    body.replaceChildren(h('div', { class: 'hero-actions' }, again, cancel));
    focusFirst();
    try {
      const servers = await waitForPlexSignIn();
      if (run !== attempt) return;
      showServers(servers, run);
      // The only server is picked straight away; shown as a choice all the same, so it can be tried again if it can't be reached.
      const only = servers.length === 1 ? servers[0] : undefined;
      if (only) await choose(only, run);
    } catch (err) {
      if (run !== attempt) return;
      message.textContent = errorText(err, { service: 'plex', action: true });
      showStart();
    }
  }

  function showStart(): void {
    const button = h('button', { class: 'button primary' }, t('plex.settings.connect'));
    button.addEventListener('click', () => void connect());
    body.replaceChildren(h('p', { class: 'setting-hint' }, t('plex.settings.connect-hint')), h('div', { class: 'hero-actions' }, button));
  }

  void plexStatus(true).then((status) => (status ? showConnected(status) : showStart()));
  return h('div', { class: 'plex-section tv-add' }, h('h3', { class: 'settings-subheading' }, 'Plex'), h('p', { class: 'muted settings-intro' }, t('plex.settings.intro')), body, message);
}
