/**
 * The person's own media servers together (Jellyfin and Plex), and what's
 * already in their debrid cloud: what the source picker and the player ask
 * of "your servers", whichever are connected.
 */
import type { Stream } from '../addons/types';
import type { Title } from '../catalog/titles';
import { cloudSources, cloudStream, providerName } from './cloud';
import { historyPaused } from './history-pause';
import { createJellyfinReporter, jellyfinSources, versionStream } from './jellyfin';
import type { ServerVersion } from './media-server';
import { createPlexReporter, plexSources, plexVersionStream } from './plex';

export type OwnServerKind = 'jellyfin' | 'plex' | 'cloud';

export interface OwnServerFound {
  kind: OwnServerKind;
  serverName: string;
  version: ServerVersion;
  stream: Stream;
}

type EpisodeAsk = { season: number; number: number; id: string };

const SERVERS: readonly { kind: Exclude<OwnServerKind, 'cloud'>; find: (title: Title, episode?: EpisodeAsk) => Promise<{ serverName: string; versions: ServerVersion[] }>; stream: (v: ServerVersion) => Stream }[] = [
  { kind: 'jellyfin', find: jellyfinSources, stream: versionStream },
  { kind: 'plex', find: plexSources, stream: plexVersionStream },
];

/** The movie or episode in the debrid cloud: one per provider that has it (`serverName` is the provider). */
async function cloudFound(title: Title, episode?: EpisodeAsk): Promise<OwnServerFound[]> {
  try {
    const found = await cloudSources(title, episode);
    return found.map(({ provider, version }) => ({ kind: 'cloud' as const, serverName: providerName(provider), version, stream: cloudStream(provider, version) }));
  } catch (err) {
    console.warn('Could not look in the cloud', err);
    return [];
  }
}

/** Every version of a movie or episode on the profile's servers and in its cloud; one that fails is left out. */
export async function ownServerVersions(title: Title, episode?: EpisodeAsk): Promise<OwnServerFound[]> {
  const found = await Promise.all([
    ...SERVERS.map(async ({ kind, find, stream }) => {
      try {
        const { serverName, versions } = await find(title, episode);
        return versions.map((version) => ({ kind, serverName, version, stream: stream(version) }));
      } catch (err) {
        console.warn(`Could not ask ${kind === 'plex' ? 'Plex' : 'Jellyfin'}`, err);
        return [];
      }
    }),
    cloudFound(title, episode),
  ]);
  return found.flat();
}

/**
 * Keeps whichever server a video came from up to date on its playback.
 * While watch history is paused (history-pause.ts) the server isn't told
 * anything, so it doesn't mark the video watched or resumable either.
 */
export function createOwnServerReporter(reporters = [createJellyfinReporter(), createPlexReporter()]) {
  return {
    status(address: string, position: number | null, paused: boolean, duration: number | null = null): void {
      if (historyPaused()) return;
      for (const r of reporters) r.status(address, position, paused, duration);
    },
    stop(): void {
      if (historyPaused()) return;
      for (const r of reporters) r.stop();
    },
    newFile(): void {
      for (const r of reporters) r.newFile();
    },
  };
}
