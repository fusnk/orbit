/**
 * Ambient mode's settings (Settings → Appearance → Ambient mode). They're for
 * the whole app, not a profile: the screen going idle is about the room the
 * computer is in, not who's watching.
 */
import { settings } from '../../lib/ipc';
import { AMBIENT_SOURCES, type AmbientSource } from './slides';

export const AMBIENT_SETTINGS = {
  after: 'ambient.after',
  source: 'ambient.source',
  clock: 'ambient.clock',
  paused: 'ambient.paused',
} as const;

/** Minutes without input before it starts; 0 is Off. */
export const AMBIENT_AFTER_CHOICES = [0, 2, 5, 10, 15, 30] as const;

export interface AmbientPrefs {
  afterMinutes: (typeof AMBIENT_AFTER_CHOICES)[number];
  source: AmbientSource;
  clock: boolean;
  /** Also over a paused player. */
  paused: boolean;
}

export const DEFAULT_AMBIENT: AmbientPrefs = { afterMinutes: 10, source: 'both', clock: true, paused: true };

/** Saved values can come from a hand-edited backup: anything unexpected falls back to the default. */
export function parseAmbientPrefs(saved: { after?: unknown; source?: unknown; clock?: unknown; paused?: unknown }): AmbientPrefs {
  return {
    afterMinutes: AMBIENT_AFTER_CHOICES.find((n) => n === saved.after) ?? DEFAULT_AMBIENT.afterMinutes,
    source: AMBIENT_SOURCES.find((s) => s === saved.source) ?? DEFAULT_AMBIENT.source,
    clock: saved.clock !== false,
    paused: saved.paused !== false,
  };
}

let current: AmbientPrefs = DEFAULT_AMBIENT;
const listeners = new Set<(prefs: AmbientPrefs) => void>();

export const ambientPrefs = (): AmbientPrefs => current;

export async function loadAmbientPrefs(): Promise<AmbientPrefs> {
  const get = (key: string) => settings.get(key).catch(() => null);
  const [after, source, clock, paused] = await Promise.all([get(AMBIENT_SETTINGS.after), get(AMBIENT_SETTINGS.source), get(AMBIENT_SETTINGS.clock), get(AMBIENT_SETTINGS.paused)]);
  current = parseAmbientPrefs({ after, source, clock, paused });
  return current;
}

/** Applies a change straight away and saves it; rejects if saving fails (the change still applies this session). */
export async function setAmbientPrefs(patch: Partial<AmbientPrefs>): Promise<void> {
  current = { ...current, ...patch };
  for (const listener of listeners) listener(current);
  const writes: Promise<void>[] = [];
  if (patch.afterMinutes !== undefined) writes.push(settings.set(AMBIENT_SETTINGS.after, patch.afterMinutes));
  if (patch.source !== undefined) writes.push(settings.set(AMBIENT_SETTINGS.source, patch.source));
  if (patch.clock !== undefined) writes.push(settings.set(AMBIENT_SETTINGS.clock, patch.clock));
  if (patch.paused !== undefined) writes.push(settings.set(AMBIENT_SETTINGS.paused, patch.paused));
  await Promise.all(writes);
}

export function onAmbientPrefsChange(listener: (prefs: AmbientPrefs) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
