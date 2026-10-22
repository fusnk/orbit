/** Settings → General → Backup & help: backup and restore, and diagnostics for bug reports. */
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { withDialog } from '../../lib/ipc';
import { row } from './playback';
import { copyDiagnostics } from '../../app/errors';
import { errorText } from '../../components/state-message';
import { needsParentPin, parentPinPrompt } from '../profiles/content-limit';
import { pinField } from '../profiles/picker';

const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

/** Export a backup, or restore one (Orbit restarts to use it); with its status line under it. */
export function backupRows(): HTMLElement[] {
  const message = h('p', { class: 'provider-message', role: 'status' });
  const control = h('div', { class: 'wallpaper-control' });
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });

  function idle(): void {
    // Back from Cancel or an error: the buttons that had focus are replaced, so it goes to Restore rather than the page.
    const hadFocus = control.contains(document.activeElement);
    const exportButton = h('button', { class: 'button' }, t('settings.common.export'));
    exportButton.addEventListener('click', () => {
      void withDialog('backup_export')
        .then((path) => path && (message.textContent = t('settings.common.saved-to', { path })))
        .catch((err: unknown) => (message.textContent = errorText(err)));
    });
    const restore = h('button', { class: 'button' }, t('settings.advanced.restore-choose'));
    restore.addEventListener('click', () => input.click());
    control.replaceChildren(exportButton, restore, input);
    if (hadFocus) restore.focus();
  }

  // Restoring replaces settings, so it's confirmed first; then Orbit restarts to use them.
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) return void (message.textContent = t('settings.advanced.too-large'));
    message.textContent = t('settings.advanced.restore-confirm', { name: file.name });
    const confirm = h('button', { class: 'button primary' }, t('settings.advanced.restore'));
    const cancel = h('button', { class: 'button' }, t('settings.common.cancel'));
    cancel.addEventListener('click', () => {
      message.textContent = '';
      idle();
    });
    const restore = async (text: string, guardianPin?: string) => {
      await invoke('backup_import', { text, guardianPin: guardianPin ?? null });
      await invoke('player_stop').catch(() => {});
      location.reload();
    };
    // A flag rather than `disabled` (which would drop focus): a second press while it restores does nothing.
    let restoring = false;
    confirm.addEventListener('click', () => {
      if (restoring) return;
      restoring = true;
      confirm.setAttribute('aria-busy', 'true');
      void file
        .text()
        .then(async (text) => {
          try {
            await restore(text);
          } catch (err) {
            // On a profile with a content limit, restoring needs a parent's PIN (Rust checks it).
            if (!needsParentPin(err)) throw err;
            message.textContent = '';
            control.replaceChildren(parentPinPrompt(pinField, t('parental.parent-pin-prompt'), (pin) => restore(text, pin), idle));
          }
        })
        .catch((err: unknown) => {
          message.textContent = errorText(err);
          idle();
        })
        .finally(() => (restoring = false));
    });
    control.replaceChildren(confirm, cancel);
    confirm.focus();
  });

  idle();
  return [row(t('settings.advanced.backup'), t('settings.advanced.backup-hint'), control), message];
}

/** "Open log folder" and "Copy diagnostics", for bug reports. Everything in them is redacted by Rust. */
export function diagnosticsSection(): HTMLElement {
  const status = h('p', { class: 'provider-message', role: 'status' });
  const open = h('button', { class: 'button' }, t('settings.advanced.open-logs'));
  open.addEventListener('click', () => {
    status.replaceChildren();
    void invoke('diagnostics_open_folder').catch((err: unknown) => (status.textContent = errorText(err)));
  });
  const copy = h('button', { class: 'button' }, t('settings.advanced.copy-diagnostics'));
  copy.addEventListener('click', () => copyDiagnostics(status, errorText));
  return h('div', { class: 'diagnostics-section' }, row(t('settings.advanced.diagnostics'), t('settings.advanced.diagnostics-hint'), h('div', { class: 'wallpaper-control' }, open, copy)), status);
}
