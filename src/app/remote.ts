/**
 * The phone remote's side in the page (Rust runs the server, see
 * src-tauri/src/remote/). Commands a paired phone sends arrive here, already
 * checked, as `remote://command`, and run through the actions the keyboard
 * uses: the player's own controls while it's open (remote-player.ts), and
 * otherwise the arrow pad's keys (the same presses a game controller makes)
 * and Orbit's own search and Play, so the profile's content limit applies as
 * it does to anything picked on screen.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { allowedTitles, verdictFor } from '../catalog/parental';
import { mergeResults, rankResults, searchableCatalogs } from '../catalog/search';
import { loadCatalog, usableAddons } from '../catalog/service';
import type { Title } from '../catalog/titles';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { foundTitles, MAX_REMOTE_RESULTS, NAV_KEYS, parseRemoteCommand, type RemoteCommand } from '../lib/remote';
import { titleHandlers } from '../rooms/detail/open';
import { reportError } from './errors';
import { pressKey } from './gamepad';
import { playAfterSetup } from './onboarding/gate';
import { runPicker } from './remote-picker';
import { remotePlayer, tellNowPlaying } from './remote-player';
import { remoteChanged, remoteStatus, startRemote } from './remote-status';
import type { RoomContext } from './router';

/** The latest search a phone asked for, and what it found. */
let found: { id: number; titles: Title[] } | null = null;

async function search(id: number, query: string): Promise<void> {
  let titles: Title[] = [];
  let failed: boolean;
  try {
    const catalogs = await usableAddons().then(searchableCatalogs);
    const settled = await Promise.allSettled(catalogs.map((ref) => loadCatalog(ref, [['search', query]])));
    failed = settled.length > 0 && settled.every((outcome) => outcome.status === 'rejected');
    const lists = settled.map((outcome) => (outcome.status === 'fulfilled' ? outcome.value : []));
    // Only what the profile's content limit allows, as Search shows.
    titles = (await allowedTitles(rankResults(mergeResults(lists), query))).slice(0, MAX_REMOTE_RESULTS);
  } catch (err) {
    console.warn('Phone remote: could not search', err);
    failed = true;
  }
  // A newer search finished first: this one's results are stale (Rust would drop them too).
  if (found && id < found.id) return;
  found = { id, titles };
  await invoke('remote_search_results', { id, results: foundTitles(titles), failed });
}

async function open(handlers: ReturnType<typeof titleHandlers>, searchId: number, index: number, play: boolean): Promise<void> {
  const title = found?.id === searchId ? found.titles[index] : undefined;
  if (!title) return;
  // The results were within the limit; checked again in case it changed since.
  if ((await verdictFor(title)) === 'blocked') return toast(t('parental.blocked.toast', { name: title.name }));
  playAfterSetup(() => (play ? handlers.play(title) : handlers.openDetail(title)));
}

function run(command: RemoteCommand, handlers: ReturnType<typeof titleHandlers>): void {
  switch (command.kind) {
    case 'nav':
      return pressKey(NAV_KEYS[command.key]);
    case 'search':
      return void search(command.id, command.query).catch((err: unknown) => reportError('Phone remote: could not send search results', err, 'warn'));
    case 'open':
      return void open(handlers, command.search, command.index, command.play).catch((err: unknown) => reportError('Phone remote: could not open a title', err, 'warn'));
    case 'browse':
    case 'mood':
    case 'surprise':
    case 'details':
    case 'pick':
      return void runPicker(command, (title) => playAfterSetup(() => handlers.play(title))).catch((err: unknown) => reportError('Phone remote: could not answer the picker', err, 'warn'));
  }
  // The rest are the player's; Rust sends them only while something plays.
  const player = remotePlayer();
  if (!player) return;
  switch (command.kind) {
    case 'pause':
      return player.setPaused(command.on);
    case 'seek-by':
      return player.seekBy(command.seconds);
    case 'seek-to':
      return player.seekTo(command.seconds);
    case 'volume':
      return player.setVolume(command.level);
    case 'mute':
      return player.setMuted(command.on);
    case 'next':
      return player.playNext();
    case 'subtitle':
      return player.subtitle(command.id);
    case 'audio':
      return player.audio(command.id);
    case 'stop':
      return player.stop();
  }
}

/** Starts listening for phones' commands (once, at startup). */
export function startRemoteBridge(ctx: RoomContext): void {
  // A title the phone opens or plays during first-run setup waits for it to end, as an install link does.
  const handlers = titleHandlers(ctx);
  // The window reloaded (a new language, say) while the remote kept running in Rust: nothing plays
  // now, and the phone page gets the new language's words.
  tellNowPlaying(null);
  void remoteStatus()
    .then((status) => (status.running ? startRemote() : undefined))
    .catch((err: unknown) => console.warn('Could not refresh the phone remote', err));
  void listen<unknown>('remote://command', (event) => {
    const command = parseRemoteCommand(event.payload);
    if (command) run(command, handlers);
  });
  void listen<{ reason?: string }>('remote://changed', (event) => {
    const reason = event.payload.reason;
    if (reason === 'paired') toast(t('remote.toast.paired'));
    if (reason === 'locked') toast(t('remote.toast.locked'));
    if (reason === 'moved') toast(t('remote.toast.moved'));
    remoteChanged();
  });
}
