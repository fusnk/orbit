/**
 * `stremio://` and `orbit://` install links from a website's "Install" button.
 * Rust checks the link and turns it into an https manifest URL
 * (src-tauri/src/deep_link.rs); here the Addons page opens on its review, the
 * same one a pasted URL gets. Nothing is installed until the person confirms,
 * and a link to this machine or the home network isn't even fetched until they
 * press Continue (install.ts).
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { ADDON_LINK } from '../rooms/addons/install';
import { reportError } from './errors';
import { afterSetup } from './onboarding/gate';
import { afterPlayer } from './player-gate';

type Link = { kind: 'addon'; url: string } | { kind: 'unusable' };

type Go = (room: string, options: { root: boolean }) => void;

async function take(go: Go): Promise<void> {
  const link = await invoke<Link | null>('deep_link_take');
  if (!link) return;
  if (link.kind !== 'addon' || typeof link.url !== 'string') return toast(t('deeplink.unusable'));
  // At its root: a title page left open over it would hide the panel, and the link would go nowhere.
  go('addons', { root: true });
  document.querySelector('.outlet .addons-page .addons-panel')?.dispatchEvent(new CustomEvent(ADDON_LINK, { detail: link.url }));
}

/**
 * Takes the link Orbit was started with, then any a later launch (or macOS) hands over.
 * While first-run setup is open a link waits in Rust and is taken once setup ends, so it
 * neither closes setup nor is lost when setup reloads the window for a new language.
 * While a video plays it waits the same way until the player closes (app/player-gate.ts).
 */
export function startDeepLinks(go: Go): void {
  const open = () => void take(go).catch((err: unknown) => reportError('Could not open an install link', err, 'warn'));
  // A video playing isn't stopped for the link's review either: it waits in Rust until the player closes, and a toast says so.
  const handle = () =>
    afterSetup(() => {
      if (afterPlayer(open)) toast(t('deeplink.after-video'));
    });
  // Listening first, so a link that arrives in between isn't missed.
  void listen('deep-link', handle)
    .then(handle)
    .catch((err: unknown) => reportError('Could not listen for install links', err, 'warn'));
}
