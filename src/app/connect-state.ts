/**
 * Orbit Connect's state in the page (Rust runs it, see src-tauri/src/connect/):
 * turning it on and off, this device's name, the device list everything else
 * reads, and sending a title to another device. Apart from app/connect.ts,
 * which plays what other devices send, so the player and Settings needn't
 * import the pages that one opens.
 */
import { invoke } from '@tauri-apps/api/core';
import { errorText } from '../components/state-message';
import { toast } from '../components/toast';
import { t, type MessageKey } from '../i18n';
import { handoffStarted, OFF, parseConnectStatus, parseRemotePlayback, type ConnectDevice, type ConnectPlay, type ConnectStatus, type RemotePlayback } from '../lib/connect';
import { settings } from '../lib/ipc';
import { isAndroid } from '../lib/platform';

/** Dispatched on `document` whenever the device list or pairing changes, so buttons and Settings redraw. */
export const CONNECT_CHANGED = 'orbit:connect-changed';

/** This device's own (not backed up, see backup.rs `LOCAL_SETTINGS`). */
export const CONNECT_SETTINGS = { enabled: 'connect.enabled', name: 'connect.name' } as const;

let current: ConnectStatus = OFF;

/** The latest status (off until Connect is turned on). */
export const connectState = (): ConnectStatus => current;

function keep(payload: unknown): ConnectStatus {
  current = parseConnectStatus(payload);
  document.dispatchEvent(new CustomEvent(CONNECT_CHANGED));
  return current;
}

/** Runs a Connect command that answers with the status, and keeps it. */
export const connectCommand = (command: string, args?: Record<string, unknown>): Promise<ConnectStatus> => invoke<unknown>(command, args).then(keep);

export const refreshConnect = () => connectCommand('connect_status');

export const defaultName = () => t(isAndroid ? 'connect.default-name.tv' : 'connect.default-name.pc');

/** The name this device goes by on the network: the one the person gave it, else "Orbit PC" / "Orbit TV". */
export async function deviceName(): Promise<string> {
  const saved = await settings.get(CONNECT_SETTINGS.name).catch(() => null);
  return typeof saved === 'string' && saved.trim() ? saved.trim() : defaultName();
}

/** Turns Connect on (and keeps it on across restarts); rejects with a coded error without a home network. */
export async function startConnect(): Promise<ConnectStatus> {
  const status = await connectCommand('connect_start', { name: await deviceName() });
  await settings.set(CONNECT_SETTINGS.enabled, true);
  return status;
}

export async function stopConnect(): Promise<ConnectStatus> {
  const status = await connectCommand('connect_stop');
  await settings.set(CONNECT_SETTINGS.enabled, false);
  return status;
}

/** A new name for this device, announced at once while Connect is on. */
export async function renameDevice(name: string): Promise<ConnectStatus> {
  // By character, so an emoji at the end isn't cut in half (which Rust would refuse as invalid text).
  const trimmed = [...name.trim()].slice(0, 40).join('').trim();
  await settings.set(CONNECT_SETTINGS.name, trimmed);
  return current.running ? connectCommand('connect_start', { name: trimmed || defaultName() }) : current;
}

/** Plays `play` on `device`; says so (`said`), or why not. True once it's on its way. */
export async function playOn(device: ConnectDevice, play: ConnectPlay, said: MessageKey = 'connect.toast.sent'): Promise<boolean> {
  try {
    await invoke('connect_play', { id: device.id, play });
    toast(t(said, { device: device.name }));
    return true;
  } catch (err) {
    console.warn('Orbit Connect: could not play on another device', err);
    toast(errorText(err, { fallback: 'connect.failed' }));
    return false;
  }
}

/** What `device` is playing now (null: nothing, or no answer). */
export const remotePlayback = (device: ConnectDevice): Promise<RemotePlayback | null> =>
  invoke<unknown>('connect_remote_status', { id: device.id })
    .then((payload) => parseRemotePlayback(payload) ?? null)
    .catch(() => null);

/** How long a handoff may take to start on the other device (finding sources there included), and how often it's asked. */
const HANDOFF_WAIT_MS = 60_000;
const HANDOFF_POLL_MS = 1000;

/**
 * Hands `play` over to `device` (`before`: what it played when asked). True once it plays it there:
 * only then may this device stop. False if it refused it, or didn't start it in time (couldn't find it, say).
 */
export async function handOff(device: ConnectDevice, play: ConnectPlay, before: RemotePlayback | null): Promise<boolean> {
  if (!(await playOn(device, play, 'connect.toast.handing-off'))) return false;
  const deadline = Date.now() + HANDOFF_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, HANDOFF_POLL_MS));
    if (handoffStarted(before, await remotePlayback(device), play.position)) {
      toast(t('connect.toast.sent', { device: device.name }));
      return true;
    }
  }
  toast(t('connect.handoff-failed', { device: device.name }));
  return false;
}

/** The waits between tries to turn Connect back on at launch; the last repeats. */
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

let resuming = false;

/**
 * Turns Connect back on at launch if it was left on. Without a network yet (Wi-Fi still joining, say) it
 * tries again, less and less often, and at once when the network comes back, until it's on or turned off.
 */
export function resumeConnect(): void {
  // Already trying (at launch, or after a network change Rust couldn't follow, `stopped`): one loop is enough.
  if (resuming) return;
  resuming = true;
  let tries = 0;
  let timer: number | undefined;
  let busy = false;
  const onOnline = () => void attempt();
  const done = () => {
    resuming = false;
    window.clearTimeout(timer);
    window.removeEventListener('online', onOnline);
  };
  async function attempt(): Promise<void> {
    if (busy) return;
    busy = true;
    window.clearTimeout(timer);
    try {
      if ((await settings.get(CONNECT_SETTINGS.enabled).catch(() => null)) !== true) {
        done();
        await refreshConnect().catch(() => {});
        return;
      }
      await connectCommand('connect_start', { name: await deviceName() });
      done();
    } catch (err) {
      console.warn('Could not turn Orbit Connect back on; trying again', err);
      timer = window.setTimeout(onOnline, RETRY_DELAYS_MS[Math.min(tries++, RETRY_DELAYS_MS.length - 1)]);
    } finally {
      busy = false;
    }
  }
  window.addEventListener('online', onOnline);
  void attempt();
}
