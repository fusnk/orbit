import { VIEW_DISCARDED } from '../../app/router';
import { openDrawer } from '../../components/drawer';
import { createSwitch } from '../../components/switch';
import { createTextField } from '../../components/text-field';
import { t, tn, type MessageKey } from '../../i18n';
import { h } from '../../lib/dom';
import { anilistState, authorizeAniList, connectAniList, disconnectAniList, importAniListCandidates, onAniListChange, refreshAniList, setAniListEnabled } from '../../library/anilist';
import { inLibrary, toggleLibrary } from '../../library/library';
import { activeProfileId } from '../../library/profiles';
import { onSettingsPage } from './dependent-rows';
import { row } from './playback';

const ERRORS: Record<string, MessageKey> = {
  unconfigured: 'integrations.anilist.unconfigured', 'signed-out': 'integrations.anilist.signed-out', denied: 'integrations.anilist.denied', network: 'integrations.anilist.network',
  'invalid-data': 'integrations.anilist.invalid-data', keychain: 'integrations.anilist.keychain', 'rate-limited': 'integrations.anilist.rate-limited',
};

export function anilistSection(): HTMLElement {
  const body = h('div');
  const message = h('p', { class: 'provider-message', role: 'status', 'aria-live': 'polite' });
  const section = h('section', { class: 'anilist-section' }, h('h3', { class: 'settings-subheading' }, 'AniList'), body, message);
  let disposed = false;
  let busy = false;
  const failed = (error: unknown) => { message.textContent = t(ERRORS[String(error)] ?? 'integrations.anilist.failed'); };

  async function run(work: () => Promise<unknown>): Promise<void> {
    if (busy || disposed) return;
    const focused = document.activeElement instanceof HTMLElement && section.contains(document.activeElement) ? document.activeElement.dataset.anilistControl : undefined;
    busy = true;
    draw();
    try { await work(); } catch (error) { if (!disposed) failed(error); }
    finally {
      busy = false;
      if (!disposed) {
        draw();
        if (focused && section.isConnected) section.querySelector<HTMLElement>(`[data-anilist-control="${focused}"]:not(:disabled)`)?.focus({ preventScroll: true });
      }
    }
  }

  async function prepareImport(): Promise<void> {
    message.textContent = t('integrations.anilist.loading');
    const profile = await activeProfileId();
    const account = anilistState().account?.id;
    const titles = (await importAniListCandidates()).filter((title) => !inLibrary(title.id));
    if (disposed || (await activeProfileId()) !== profile || anilistState().account?.id !== account) return;
    if (!titles.length) { message.textContent = t('integrations.anilist.empty'); return; }
    message.textContent = '';
    const label = tn('integrations.anilist.confirm', titles.length);
    const confirm = h('button', { class: 'button primary' }, t('integrations.anilist.import'));
    const cancel = h('button', { class: 'button', 'data-autofocus': true }, t('integrations.common.cancel'));
    const summary = h('p', { role: 'status' });
    const close = openDrawer(h('div', {}, h('h2', {}, label), h('p', {}, t('integrations.anilist.confirm-hint')), h('p', { class: 'muted' }, t('integrations.anilist.mapping')), h('div', { class: 'provider-key' }, cancel, confirm), summary), label);
    cancel.addEventListener('click', close);
    confirm.addEventListener('click', () => {
      confirm.disabled = cancel.disabled = true;
      void (async () => {
        if ((await activeProfileId()) !== profile || anilistState().account?.id !== account) { close(); return; }
        let added = 0;
        let failures = 0;
        for (const title of titles) {
          if ((await activeProfileId()) !== profile) { close(); return; }
          if (inLibrary(title.id)) continue;
          if (await toggleLibrary(title)) added++; else failures++;
        }
        message.textContent = failures ? t('integrations.anilist.import-failed') : tn('integrations.anilist.imported', added);
        close();
      })().catch((error: unknown) => { failed(error); close(); });
    });
  }

  function draw(): void {
    if (disposed) return;
    const state = anilistState();
    if (state.error && !busy) failed(state.error);
    if (state.account) {
      const name = h('span', { class: 'provider-status' }, state.account.name);
      const identity = h('div', { class: 'anilist-account' }, ...(state.account.avatar ? [h('img', { class: 'anilist-avatar', src: state.account.avatar, alt: '', width: '40', height: '40' })] : []), name);
      const disconnect = h('button', { class: 'button danger', 'data-anilist-control': 'disconnect', disabled: busy }, t('integrations.common.disconnect'));
      disconnect.addEventListener('click', () => void run(disconnectAniList));
      const toggle = createSwitch('', state.enabled, (on) => void run(() => setAniListEnabled(on)));
      toggle.setAttribute('aria-label', t('integrations.anilist.update'));
      toggle.disabled = busy;
      toggle.dataset.anilistControl = 'enabled';
      const importButton = h('button', { class: 'button', 'data-anilist-control': 'import', disabled: busy }, t('integrations.anilist.import'));
      importButton.addEventListener('click', () => void run(prepareImport));
      body.replaceChildren(row(t('integrations.anilist.account'), t('integrations.anilist.hint'), h('div', { class: 'provider-key' }, identity, disconnect)), row(t('integrations.anilist.update'), t('integrations.anilist.update-hint'), toggle), row(t('integrations.anilist.import'), t('integrations.anilist.mapping'), importButton));
      return;
    }
    const authorize = h('button', { class: 'button', 'data-anilist-control': 'authorize', disabled: busy || !state.configured }, t('integrations.anilist.authorize'));
    authorize.addEventListener('click', () => void run(authorizeAniList));
    const token = createTextField({ label: t('integrations.anilist.token'), placeholder: t('integrations.anilist.token'), className: 'anilist-token', onSubmit: () => void connect() });
    token.dataset.anilistControl = 'token';
    token.type = 'password'; token.maxLength = 8192; token.disabled = busy || !state.configured;
    const connectButton = h('button', { class: 'button primary', 'data-anilist-control': 'connect', disabled: busy || !state.configured }, t('integrations.anilist.connect'));
    async function connect(): Promise<void> {
      if (busy || !token.value.trim()) return;
      const value = token.value.trim();
      token.value = '';
      message.textContent = t('integrations.anilist.connecting');
      await run(() => connectAniList(value));
    }
    connectButton.addEventListener('click', () => void connect());
    const controls = h('div', { class: 'provider-key anilist-controls' }, authorize, token, connectButton);
    if (state.connected) {
      const disconnect = h('button', { class: 'button danger', 'data-anilist-control': 'disconnect', disabled: busy }, t('integrations.common.disconnect'));
      disconnect.addEventListener('click', () => void run(async () => { await disconnectAniList(); message.textContent = ''; }));
      controls.append(disconnect);
    }
    body.replaceChildren(row(t('integrations.anilist.account'), state.configured ? t('integrations.anilist.token-hint') : t('integrations.anilist.unconfigured'), controls));
  }
  const dispose = () => { disposed = true; stop(); };
  // Settings is never discarded, but a redraw of Accounts (a reset, one of its settings saved elsewhere) replaces
  // this section: once it has been on a Settings page and no longer is, it stops drawing (as `whenSaved` does).
  let attached = false;
  const stop = onAniListChange(() => {
    if (onSettingsPage(section)) attached = true;
    else if (attached) return dispose();
    draw();
  });
  requestAnimationFrame(() => {
    section.closest('.room')?.addEventListener(VIEW_DISCARDED, dispose, { once: true });
  });
  draw();
  void refreshAniList().then(() => { if (!disposed) draw(); }, (error: unknown) => { if (!disposed) failed(error); });
  return section;
}