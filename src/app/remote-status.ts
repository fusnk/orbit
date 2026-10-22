/**
 * Turning the phone remote on and off, and what Settings shows about it
 * (src-tauri/src/remote/ runs it). Apart from app/remote.ts, which opens
 * titles, so Settings and Quick settings needn't import the pages.
 */
import { invoke } from '@tauri-apps/api/core';
import { hasMessage, isRtl, language, t } from '../i18n';
import { en } from '../i18n/locales/en';
import { phoneKeys } from '../lib/remote';

/** Dispatched on `document` when a phone pairs, pairing closes, or the remote is turned on or off, so Settings can redraw. */
export const REMOTE_CHANGED = 'orbit:remote-changed';

/** What Settings shows (see `Status` in src-tauri/src/remote/mod.rs). */
export interface RemoteStatus {
  running: boolean;
  address: string | null;
  /** The QR code's link, with the one-time pairing token. */
  pairUrl: string | null;
  code: string | null;
  /** Seconds left to pair with the code. */
  expiresIn: number | null;
  qr: { size: number; cells: string } | null;
  devices: number;
  maxDevices: number;
  locked: boolean;
}

export const remoteChanged = () => document.dispatchEvent(new CustomEvent(REMOTE_CHANGED));

/** The phone page's words in the interface's language. */
export function phoneStrings(): { lang: string; rtl: boolean; strings: Record<string, string> } {
  const strings: Record<string, string> = {};
  for (const key of phoneKeys(Object.keys(en))) if (hasMessage(key)) strings[key] = t(key);
  return { lang: language(), rtl: isRtl(), strings };
}

export const remoteStatus = () => invoke<RemoteStatus>('remote_status');

/** Turns the remote on (and opens pairing); rejects with a coded error if there's no home network. */
export async function startRemote(): Promise<RemoteStatus> {
  const status = await invoke<RemoteStatus>('remote_start', { strings: phoneStrings() });
  remoteChanged();
  return status;
}

export async function stopRemote(): Promise<RemoteStatus> {
  const status = await invoke<RemoteStatus>('remote_stop');
  remoteChanged();
  return status;
}
