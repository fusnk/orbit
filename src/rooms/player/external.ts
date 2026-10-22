/**
 * Opening a source in another video player on this PC (Settings → Player →
 * External player). Rust finds and starts the program (src-tauri/src/external.rs);
 * this keeps the choice and decides which sources can go.
 *
 * Nothing is written to watch history when a source opens elsewhere: Orbit
 * can't see how far it plays, and an entry with no progress would send
 * Stremio sync a "not started" that could wipe real progress from another device.
 */
import { invoke } from '@tauri-apps/api/core';
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import { settings } from '../../lib/ipc';

/** Global, read by Rust too: `{ kind }`, or `{ kind: 'custom', path }`; null for none. */
export const EXTERNAL_KEY = 'player.external';
/** true: Play hands the best web source to the external player. */
export const EXTERNAL_ALWAYS_KEY = 'player.external-always';

export const EXTERNAL_KINDS = ['none', 'vlc', 'mpv', 'mpc-hc', 'mpc-be', 'potplayer', 'custom'] as const;
export type ExternalKind = (typeof EXTERNAL_KINDS)[number];
export interface ExternalChoice {
  kind: ExternalKind;
  path?: string;
}

export function parseExternal(value: unknown): ExternalChoice {
  if (!value || typeof value !== 'object') return { kind: 'none' };
  const { kind, path } = value as { kind?: unknown; path?: unknown };
  if (!EXTERNAL_KINDS.includes(kind as ExternalKind)) return { kind: 'none' };
  if (kind === 'custom') return typeof path === 'string' && path ? { kind, path } : { kind: 'none' };
  return { kind: kind as ExternalKind };
}

let choice: ExternalChoice = { kind: 'none' };
let always = false;

/** Reads the choice; the source picker and Play call this before deciding. */
export async function loadExternal(): Promise<void> {
  const [saved, alwaysSaved] = await Promise.all([settings.get(EXTERNAL_KEY).catch(() => null), settings.get(EXTERNAL_ALWAYS_KEY).catch(() => null)]);
  choice = parseExternal(saved);
  always = alwaysSaved === true;
}

/** Settings saved a new choice. */
export function externalChanged(next: { choice?: ExternalChoice; always?: boolean }): void {
  if (next.choice) choice = next.choice;
  if (next.always !== undefined) always = next.always;
}

export const externalConfigured = (): boolean => choice.kind !== 'none';
export const alwaysExternal = (): boolean => always && externalConfigured();

/**
 * Only web addresses can go: a torrent (magnet or info hash) needs Orbit's own
 * torrent engine, and most players can't take one, so the action isn't offered.
 */
export const canOpenExternally = (url: string, torrent = false): boolean => !torrent && /^https?:\/\//i.test(url);

/** Hands `url` to the external player; true once it has started. */
export async function openExternally(url: string): Promise<boolean> {
  try {
    await invoke('external_player_open', { url });
    toast(t('local.external.opened'));
    return true;
  } catch (err) {
    // Rust's message never includes the address (it may carry a debrid token).
    console.warn('Could not start the external player', err);
    toast(t('local.external.failed'));
    return false;
  }
}
