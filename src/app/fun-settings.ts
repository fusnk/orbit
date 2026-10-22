/**
 * The little extras' switches (Settings → Appearance → Little extras), kept
 * in one setting. Read once at startup; a change is announced with
 * FUN_CHANGED so what's on screen (the seasonal glyph) can follow it.
 */
import { invoke } from '@tauri-apps/api/core';
import { isFunLanguage, languageChoice, RETURN_TO_KEY, setLanguage } from '../i18n';
import { settings } from '../lib/ipc';
import { FUN_DEFAULTS, FUN_KEY as KEY, parseFun, type FunPrefs } from '../lib/fun';

export const FUN_CHANGED = 'orbit:fun-changed';

let current: FunPrefs = FUN_DEFAULTS;

export const funPrefs = (): FunPrefs => current;

export async function loadFun(): Promise<void> {
  current = parseFun(await settings.get(KEY).catch(() => null));
}

export async function setFun(patch: Partial<FunPrefs>): Promise<void> {
  current = { ...current, ...patch };
  document.dispatchEvent(new CustomEvent(FUN_CHANGED));
  await settings.set(KEY, current);
  if (!current.languages && isFunLanguage(languageChoice())) await leaveFunLanguage();
}

/** A joke language can't stay on without its switch: back to the system language, redrawn from Settings → General. */
async function leaveFunLanguage(): Promise<void> {
  await setLanguage('system');
  try {
    sessionStorage.setItem(RETURN_TO_KEY, 'settings-general');
  } catch {
    // Without storage it opens as usual.
  }
  await invoke('player_stop').catch(() => {});
  location.reload();
}
