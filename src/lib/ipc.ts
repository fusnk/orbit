import { invoke } from '@tauri-apps/api/core';

/**
 * Dispatched on `document` after a setting is saved, with its key as the
 * detail. Every setting goes through `settings.set`, so the Settings page can
 * say "Saved" without each control having to report in.
 */
export const SETTING_SAVED = 'orbit:setting-saved';

/** Values are returned as `unknown`: callers validate them before use. */
export const settings = {
  get: (key: string) => invoke<unknown>('settings_get', { key }),
  set: (key: string, value: unknown) =>
    invoke<void>('settings_set', { key, value }).then(() => {
      // (Tests run without a page.)
      if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(SETTING_SAVED, { detail: key }));
    }),
};

/**
 * Runs a command that opens a system file dialog (folder or save) and gives
 * back the chosen path, or `null` if the dialog was cancelled. Focus then goes
 * back to where it was (the button that opened it): the dialog takes it from
 * the page, and keyboard or controller users would be left with none.
 */
export async function withDialog(command: string, args?: Record<string, unknown>): Promise<string | null> {
  const from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try {
    return await invoke<string | null>(command, args);
  } finally {
    if (from?.isConnected) from.focus({ preventScroll: true });
  }
}
