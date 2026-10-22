/**
 * What the person's own media servers (Jellyfin, Plex) have in common on the
 * page: the titles Rust sends (already checked there), how they become
 * Orbit titles and picker streams, and the playback reports that keep the
 * server's resume points and watched marks in step.
 */
import type { Stream } from '../addons/types';
import { noteServerRating } from '../catalog/parental';
import { seasonsFrom, type Title } from '../catalog/titles';

/** How often the server hears where playback is (also on pause, resume and stop). */
export const REPORT_EVERY_MS = 20_000;

/** A movie or show as Rust sends it. */
export interface ServerItem {
  titleId: string;
  type: 'movie' | 'series';
  name: string;
  year?: string | null;
  description?: string | null;
  genres: string[];
  rating?: string | null;
  /** The server's age rating ("PG-13", "de/16"…), for a content limit on a title TMDB can't rate. */
  certification?: string | null;
  runtime?: string | null;
  /** Image keys for the server's art protocol. */
  poster?: string | null;
  background?: string | null;
  logo?: string | null;
}

export interface ServerEpisode {
  id: string;
  season: number;
  episode: number;
  title?: string | null;
  overview?: string | null;
  thumbnail?: string | null;
  released?: string | null;
}

export interface ServerLibrary {
  id: string;
  name: string;
  /** Jellyfin's "Mixed movies and shows" libraries are 'mixed'. */
  kind: 'movies' | 'tvshows' | 'mixed';
}

export interface ServerVersion {
  address: string;
  /** Quality words, e.g. "1080p HEVC HDR10 5.1". */
  label: string;
  name?: string | null;
  size?: number | null;
  /** Where the server says the person stopped, in seconds. */
  resume?: number | null;
  /** When the server says it was last played (ms), if it says. */
  resumeAt?: number | null;
}

/**
 * How much later the server's time must be to count as watched elsewhere since: Orbit's own
 * reports move it too, a moment after Orbit's history, and the two clocks may differ a little.
 */
const SERVER_LATER_MS = 60_000;

/**
 * Where to resume a video from the person's own server (seconds): Orbit's place (`local.position`,
 * 0 when not part-way; `updatedAt` when Orbit last had it, if ever), unless the server's place is
 * from later (played in another of its apps since). With nothing in Orbit's history, the server's.
 */
export function resumeFrom(local: { position: number; updatedAt?: number | undefined }, server: { resume?: number | undefined; resumeAt?: number | undefined }): number {
  const remote = server.resume ?? 0;
  if (server.resumeAt !== undefined && local.updatedAt !== undefined) {
    if (remote > 0 && server.resumeAt > local.updatedAt + SERVER_LATER_MS) return remote;
    // Orbit's is the newer word, even a 0: finished (by Orbit's threshold) or marked unwatched since.
    return local.position;
  }
  return local.position || remote;
}

/** What Settings shows about a connected server. */
export interface ServerStatus {
  serverName: string;
  userName: string;
  host: string;
  /** Plain http: the sign-in and video travel unencrypted. */
  insecure: boolean;
}

export type ServerFeed = 'resume' | 'latest' | 'library';

const orNone = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

/** A server's item as a title; `origin` is the server ("jellyfin" or "plex", and its name). */
export function serverItemTitle(item: ServerItem, origin: { key: string; name: string }, art: (key: string) => string): Title {
  // A title only the server has is rated by the server's word (see catalog/parental.ts).
  noteServerRating(item.titleId, item.certification);
  const image = (key: string | null | undefined) => (key ? art(key) : undefined);
  return {
    id: item.titleId,
    type: item.type,
    name: item.name,
    poster: image(item.poster),
    background: image(item.background),
    logo: image(item.logo),
    description: orNone(item.description),
    year: orNone(item.year),
    runtime: orNone(item.runtime),
    genres: item.genres,
    rating: orNone(item.rating),
    origins: [origin],
  };
}

/** A server-only title's details, its episodes grouped into seasons. */
export function serverMetaTitle(meta: { item: ServerItem; episodes: ServerEpisode[] }, origin: { key: string; name: string }, art: (key: string) => string, now = new Date()): Title {
  const title = serverItemTitle(meta.item, origin, art);
  if (meta.item.type !== 'series') return title;
  const videos = meta.episodes.map((e) => ({
    id: e.id,
    season: e.season,
    episode: e.episode,
    title: e.title ?? '',
    overview: orNone(e.overview),
    thumbnail: e.thumbnail ? art(e.thumbnail) : undefined,
    released: orNone(e.released),
  }));
  return { ...title, seasons: seasonsFrom(videos, now) };
}

/** A version on a server as a stream, so the picker reads its quality like any other. */
export function serverVersionStream(version: ServerVersion, server: string): Stream {
  return {
    url: version.address,
    torrent: false,
    name: `${server}\n${version.label}`,
    description: orNone(version.name),
    filename: undefined,
    videoSize: orNone(version.size),
    videoHash: undefined,
    bingeGroup: undefined,
    subtitles: [],
  };
}

export type ReportEvent = 'start' | 'progress' | 'stop';
/** `duration` (seconds) is null while mpv doesn't know it yet. */
export type ReportSend = (event: ReportEvent, address: string, position: number, paused: boolean, duration: number | null) => void;

/**
 * A server's reports sent one after another, each once the one before has
 * been answered (or failed). Sent together they could arrive in any order,
 * and the end's last progress landing after its stop shows the video as
 * playing again on the server.
 */
export function inOrder(send: (...args: Parameters<ReportSend>) => Promise<unknown>): ReportSend {
  let last: Promise<unknown> = Promise.resolve();
  return (...args) => {
    last = last.then(() => send(...args)).catch(() => {});
  };
}

/**
 * Tells a server where playback of one of its videos is, from the player's
 * status events (mpv's): when it starts, every `REPORT_EVERY_MS` while it
 * plays, when it pauses or resumes, and when it stops. Reports go out in the
 * background; nothing waits for them.
 */
export function createServerReporter(isAddress: (url: string) => boolean, send: ReportSend, now: () => number = Date.now) {
  let current: { address: string; position: number; paused: boolean; duration: number | null; at: number } | null = null;
  /** Stopped (it ended): mpv keeps reporting its last frame, which isn't a new start. */
  let finished: string | null = null;
  const stop = () => {
    if (current) send('stop', current.address, current.position, true, current.duration);
    finished = current?.address ?? finished;
    current = null;
  };
  return {
    /** A status event for `address` (any source: others are ignored). */
    status(address: string, position: number | null, paused: boolean, duration: number | null = null): void {
      if (!isAddress(address) || position === null || address === finished) return;
      if (current?.address !== address) {
        stop();
        current = { address, position, paused, duration, at: now() };
        send('start', address, position, paused, duration);
        return;
      }
      const due = paused !== current.paused || now() - current.at >= REPORT_EVERY_MS;
      current.position = position;
      current.duration = duration ?? current.duration;
      if (!due) return;
      current.paused = paused;
      current.at = now();
      send('progress', address, position, paused, current.duration);
    },
    /** Playback ended or the player closed. */
    stop,
    /** Another file (or the same one again) is being opened. */
    newFile(): void {
      stop();
      finished = null;
    },
  };
}
