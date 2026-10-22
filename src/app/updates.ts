/**
 * Orbit's own updates, as the page sees them: Rust checks, downloads and
 * verifies (src-tauri/src/updater.rs); the page only asks for a check, shows
 * "Orbit x.y.z is ready" and installs when the person says so. Also the
 * "What's new" note, once, after an update.
 */
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { h } from '../lib/dom';
import { settings } from '../lib/ipc';
import { whatsNewFor } from '../lib/updates';
import { reportError } from './errors';
import { afterPlayer } from './player-gate';
import { beforeQuit, quitCancelled } from './quit';

/** Settings → General → About Orbit → "Update automatically" (Rust reads it as Orbit quits). */
export const AUTO_UPDATE_KEY = 'updates.auto';
/** Settings → General → About Orbit → "Check for updates automatically": on unless false (Rust reads it before each daily check). */
export const AUTO_CHECK_KEY = 'updates.check';
/** Written by Rust before an update installs; cleared once the note has been shown. */
const WHATS_NEW_KEY = 'updates.whats-new';
const READY_EVENT = 'update-ready';
const FAILED_EVENT = 'update-failed';
/** Dispatched on `document` with the version once an update is ready, for Settings → About. */
export const UPDATE_READY = 'orbit:update-ready';
/** Dispatched on `document` with the version when its download fails (Rust tries again later). */
export const UPDATE_FAILED = 'orbit:update-failed';

export interface UpdateStatus {
  /** False in development builds and builds without a release key. */
  enabled: boolean;
  busy: boolean;
  ready: string | null;
}
export type CheckOutcome = { state: 'off' | 'up-to-date' | 'busy' } | { state: 'downloading' | 'ready'; version: string };

export const updateStatus = () => invoke<UpdateStatus>('update_status');
export const checkForUpdates = () => invoke<CheckOutcome>('update_check');

/**
 * Installs the downloaded update; Orbit restarts into it (it doesn't return then).
 * False if it failed: Rust has let go of that download, so the next check fetches it again.
 */
export async function installUpdate(): Promise<boolean> {
  try {
    // Orbit restarts into the update: where the video got to and what's waiting for Stremio go first.
    await beforeQuit();
    await invoke('update_install');
    return true;
  } catch (err) {
    quitCancelled();
    reportError('Could not install the update', err, 'warn');
    toast(t('settingshome.updates.install-failed'));
    return false;
  }
}

/**
 * The banner under the title bar: "Orbit x.y.z is ready · Restart to update"
 * when an update is downloaded, and before that, once after an update, what's
 * new in it. Non-blocking, and Later / Got it put it away.
 */
export function createUpdateBanner(): HTMLElement {
  const banner = h('div', { class: 'offline-banner update-banner', role: 'status', hidden: true });

  function showReady(version: string): void {
    const restart = h('button', { class: 'button primary' }, t('settingshome.updates.restart'));
    const later = h('button', { class: 'button' }, t('settingshome.updates.later'));
    restart.addEventListener('click', () => {
      restart.disabled = true;
      void installUpdate().finally(() => (banner.hidden = true));
    });
    later.addEventListener('click', () => (banner.hidden = true));
    banner.replaceChildren(h('span', { class: 'offline-dot update-dot', 'aria-hidden': 'true' }), h('strong', { class: 'offline-detail' }, t('settingshome.updates.ready', { version })), restart, later);
    banner.hidden = false;
  }

  function showWhatsNew(version: string, notes: string): void {
    const close = h('button', { class: 'button' }, t('settingshome.whats-new.close'));
    close.addEventListener('click', () => (banner.hidden = true));
    const text = h('div', { class: 'offline-detail update-notes' }, h('strong', {}, t('settingshome.whats-new.heading', { version })));
    // Plain text only (see lib/updates.ts); the notes come from the release.
    text.append(h('p', {}, notes || t('settingshome.whats-new.plain', { version })));
    banner.replaceChildren(text, close);
    banner.hidden = false;
  }

  // Not over a video: accepting "Restart to update" ends playback with no warning, so the banner
  // waits for the player to close (Settings → About still says the update is ready meanwhile).
  const showReadyAfterVideo = (version: string): void => void afterPlayer(() => showReady(version));

  void listen<{ version: string }>(READY_EVENT, (event) => {
    showReadyAfterVideo(event.payload.version);
    document.dispatchEvent(new CustomEvent(UPDATE_READY, { detail: event.payload.version }));
  }).catch((err: unknown) => reportError('Could not listen for updates', err, 'warn'));
  void listen<{ version: string }>(FAILED_EVENT, (event) => {
    document.dispatchEvent(new CustomEvent(UPDATE_FAILED, { detail: event.payload.version }));
  }).catch((err: unknown) => reportError('Could not listen for updates', err, 'warn'));

  void (async () => {
    // Ready before this page loaded (e.g. the window reloaded for a new language).
    const status = await updateStatus();
    if (status.ready) return showReadyAfterVideo(status.ready);
    const saved = await settings.get(WHATS_NEW_KEY);
    if (saved == null) return;
    // Shown once: cleared whether or not it's for this version (an installer that was cancelled leaves a newer one).
    await settings.set(WHATS_NEW_KEY, null);
    const note = whatsNewFor(saved, await getVersion());
    if (note) showWhatsNew(note.version, note.notes);
  })().catch((err: unknown) => reportError('Could not read the update state', err, 'warn'));

  return banner;
}
