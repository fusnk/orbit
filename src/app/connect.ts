/**
 * Orbit Connect's receiving side (see src-tauri/src/connect/ and
 * connect-state.ts): a title another device asks this one to play is looked
 * up with this device's own addons and played through `playTitle`, the same
 * path as Play pressed here. So this device's profile, content limit and
 * sources decide, never the device that sent it.
 */
import { listen } from '@tauri-apps/api/event';
import { loadMeta } from '../catalog/service';
import type { Title } from '../catalog/titles';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { parseIncomingPlay, type ConnectPlay } from '../lib/connect';
import { playTitle } from '../rooms/detail/streams';
import { nextEpisode, type EpisodeRef } from '../rooms/detail/title-actions';
import { playAfterSetup } from './onboarding/gate';
import { refreshConnect, resumeConnect } from './connect-state';
import type { RoomContext } from './router';

/** The episode a play command names, in this device's own copy of the show; none named: what's next here. */
function episodeOf(title: Title, play: ConnectPlay): EpisodeRef | undefined {
  if (play.season === null || play.episode === null) return nextEpisode(title);
  const episode = title.seasons?.find((s) => s.number === play.season)?.episodes.find((e) => e.number === play.episode);
  return episode ? { season: play.season, episode } : undefined;
}

/** Plays what another device asked for: looked up with this device's addons, then as if Play were pressed here. */
async function receive(from: string, play: ConnectPlay, ctx: RoomContext): Promise<void> {
  const device = from || t('connect.another-device');
  const title = await loadMeta(play.type, play.id).catch(() => null);
  const episode = title?.type === 'series' ? episodeOf(title, play) : undefined;
  if (!title || (title.type === 'series' && !episode)) return toast(t('connect.toast.not-found', { device }));
  // Said before the sources are found, so the person here knows why something is starting.
  toast(t(play.handoff ? 'connect.toast.handoff' : 'connect.toast.started', { device, title: title.name }));
  await playTitle(title, { ...(episode ? { episode } : {}), ctx, connect: { start: play.position ?? undefined, audio: play.audio, subtitle: play.subtitle } });
}

/** Turns Connect back on if it was left on, and listens for other devices (once, at startup, after a profile is chosen). */
export function startConnectBridge(ctx: RoomContext): void {
  resumeConnect();
  void listen<{ reason?: string | null; name?: string | null }>('connect://changed', (event) => {
    const { reason, name } = event.payload;
    if (reason === 'paired') toast(t('connect.toast.paired', { device: name ?? t('connect.another-device') }));
    if (reason === 'pair-stopped') toast(t('connect.toast.pair-stopped'));
    // The network changed and Connect couldn't start again on the new one: tried again, less and less often.
    if (reason === 'stopped') resumeConnect();
    void refreshConnect().catch(() => {});
  });
  void listen<unknown>('connect://play', (event) => {
    const incoming = parseIncomingPlay(event.payload);
    // During first-run setup it waits for setup to end, as an install link does, rather than opening the player over it.
    if (incoming) playAfterSetup(() => void receive(incoming.from, incoming.play, ctx).catch((err: unknown) => console.warn('Orbit Connect: could not play', err)));
  });
}
