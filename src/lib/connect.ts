/**
 * Orbit Connect's pure parts (Rust runs it, see src-tauri/src/connect/):
 * reading what Rust hands over (the device list, a title another device asks
 * this one to play, another device's playback), and building what this one
 * sends. Everything from Rust is read again here all the same: a play
 * command's fields came from another device.
 */
import * as v from 'valibot';

const Kind = v.picklist(['pc', 'tv']);
const Id = v.pipe(v.string(), v.regex(/^[0-9a-f]{32}$/));
/** At most 40 characters, counted as Rust caps them (wire.rs `device_name`): an emoji is one, not two UTF-16 units. */
const MAX_NAME = 40;
const Name = v.pipe(v.string(), v.minLength(1), v.check((name) => [...name].length <= MAX_NAME));
const Count = v.pipe(v.number(), v.integer(), v.minValue(0));

const Key = v.pipe(v.string(), v.regex(/^([0-9a-f]{64})?$/));

const DeviceSchema = v.object({
  id: Id,
  name: Name,
  kind: Kind,
  /** Its long-term key: what pairing with it is checked against (empty if none is known). */
  key: v.optional(Key, ''),
  paired: v.boolean(),
  online: v.boolean(),
  /** Paired with a code, before keys: it has to pair again. */
  repair: v.optional(v.boolean(), false),
  /** Announced with a paired device's id but another key: not that device. */
  impostor: v.optional(v.boolean(), false),
});

/** A pairing whose number the person compares with the other device's. */
const PromptSchema = v.object({ id: Id, name: Name, kind: Kind, sas: v.pipe(v.string(), v.regex(/^\d{6}$/)), outgoing: v.boolean(), waiting: v.boolean() });

/** What Settings and "Play on…" show (see `Status` in src-tauri/src/connect/mod.rs). */
const StatusSchema = v.object({
  running: v.boolean(),
  name: v.nullable(Name),
  kind: Kind,
  expiresIn: v.nullable(Count),
  locked: v.boolean(),
  prompt: v.optional(v.nullable(PromptSchema), null),
  devices: v.array(DeviceSchema),
  maxDevices: Count,
});

export type ConnectDevice = v.InferOutput<typeof DeviceSchema>;
export type ConnectStatus = v.InferOutput<typeof StatusSchema>;
export type ConnectPrompt = v.InferOutput<typeof PromptSchema>;
export type DeviceKind = v.InferOutput<typeof Kind>;

export const OFF: ConnectStatus = { running: false, name: null, kind: 'pc', expiresIn: null, locked: false, prompt: null, devices: [], maxDevices: 0 };

export function parseConnectStatus(payload: unknown): ConnectStatus {
  const parsed = v.safeParse(StatusSchema, payload);
  return parsed.success ? parsed.output : OFF;
}

/** Devices to play on or control: paired and online. */
export const playTargets = (status: ConnectStatus): ConnectDevice[] => (status.running ? status.devices.filter((d) => d.paired && d.online && !d.repair) : []);

/** Devices on the network offered for pairing. */
export const pairable = (status: ConnectStatus): ConnectDevice[] => (status.running ? status.devices.filter((d) => !d.paired) : []);

const Language = v.nullable(v.pipe(v.string(), v.regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/)));
const Number0 = v.pipe(v.number(), v.integer(), v.minValue(0));

/** A title to play, as it travels between devices (see `Play` in wire.rs): what names it, never where it streams from. */
const PlaySchema = v.object({
  type: v.picklist(['movie', 'series']),
  id: v.pipe(v.string(), v.regex(/^[A-Za-z0-9:._-]{1,120}$/)),
  season: v.nullable(Number0),
  episode: v.nullable(Number0),
  position: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0))),
  audio: Language,
  subtitle: Language,
  handoff: v.boolean(),
});

export type ConnectPlay = v.InferOutput<typeof PlaySchema>;

/** A title another device asks this one to play (`connect://play`): who asked, and what. */
const IncomingSchema = v.object({ from: v.pipe(v.string(), v.check((name) => [...name].length <= MAX_NAME)), play: PlaySchema });

export function parseIncomingPlay(payload: unknown): { from: string; play: ConnectPlay } | null {
  const parsed = v.safeParse(IncomingSchema, payload);
  return parsed.success ? parsed.output : null;
}

/** What to send to play `title` (and its episode) elsewhere; with `at`, it continues from there (a handoff). */
export function playMessage(
  title: { type: string; id: string },
  episode: { season: number; number: number } | undefined,
  at?: { position: number; audio: string | null; subtitle: string | null },
): ConnectPlay | null {
  if (title.type !== 'movie' && title.type !== 'series') return null;
  const message: ConnectPlay = {
    type: title.type,
    id: title.id,
    season: title.type === 'series' && episode ? episode.season : null,
    episode: title.type === 'series' && episode ? episode.number : null,
    position: at && Number.isFinite(at.position) && at.position > 0 ? Math.floor(at.position) : null,
    audio: at?.audio ?? null,
    subtitle: at?.subtitle ?? null,
    handoff: !!at,
  };
  return v.safeParse(PlaySchema, message).success ? message : null;
}

const Track = v.object({ id: v.pipe(v.number(), v.integer()), title: v.nullable(v.string()), lang: v.nullable(v.string()), selected: v.boolean() });
const Maybe = v.nullable(v.pipe(v.number(), v.finite()));

/** Another device's playback, as Rust checked it (wire.rs `Status`). */
const RemoteStatusSchema = v.object({
  playing: v.nullable(
    v.object({
      title: v.string(),
      detail: v.nullable(v.string()),
      live: v.boolean(),
      canNext: v.boolean(),
      maxVolume: v.pipe(v.number(), v.finite()),
      playback: v.object({ position: Maybe, duration: Maybe, paused: v.boolean(), buffering: v.boolean(), volume: Maybe, muted: v.boolean() }),
      audio: v.array(Track),
      subtitles: v.array(Track),
    }),
  ),
});

export type RemotePlayback = NonNullable<v.InferOutput<typeof RemoteStatusSchema>['playing']>;

export function parseRemotePlayback(payload: unknown): RemotePlayback | null | undefined {
  const parsed = v.safeParse(RemoteStatusSchema, payload);
  // undefined: not an answer at all (as good as no answer).
  return parsed.success ? parsed.output.playing : undefined;
}

/** How far from the moment handed over another device may be playing and still count as having picked it up: it can start a little earlier, and plays on while it's asked. */
const HANDOFF_EARLY = 30;
const HANDOFF_LATE = 120;

/**
 * Whether another device has started what was handed to it (`at`: the second it was handed over at,
 * null from the start): it plays something new since `before` (what it played when asked), from that
 * moment. Accepting the title isn't enough: it may still fail to find it, and this device keeps playing until then.
 */
export function handoffStarted(before: RemotePlayback | null, now: RemotePlayback | null, at: number | null): boolean {
  if (!now) return false;
  const near = (position: number | null) => at === null || (position !== null && position >= at - HANDOFF_EARLY && position <= at + HANDOFF_LATE);
  if (at !== null && (now.playback.position === null || !near(now.playback.position))) return false;
  if (!before || before.title !== now.title || before.detail !== now.detail) return true;
  // The same as before: only if it has moved to the moment handed over.
  return at !== null && !near(before.playback.position);
}

/** "1:02:03" or "2:03". */
export function clockTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '–:––';
  const s = Math.floor(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

/** The next volume a step up or down makes, held to 0 and the device's limit. */
export function stepVolume(volume: number | null, step: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round((volume ?? 100) + step)));
}
