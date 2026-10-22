/**
 * What Discord Rich Presence shares (Settings → Integrations → Discord), on
 * top of the on/off switch: the title, the poster, the time, and when it
 * shows at all. Read by app/activity.ts (browsing) and rooms/player/presence.ts.
 */
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { limited } from '../catalog/parental';
import { historyPaused } from '../library/history-pause';
import { settings } from '../lib/ipc';

export const DISCORD_OPTIONS_KEY = 'integrations.discord-options';

export const DISCORD_TIMES = ['progress', 'elapsed', 'off'] as const;
export type DiscordTime = (typeof DISCORD_TIMES)[number];

const OptionsSchema = v.object({
  /** "Watching something", with no name or poster. */
  hideTitle: v.fallback(v.boolean(), false),
  whilePaused: v.fallback(v.boolean(), true),
  whileBrowsing: v.fallback(v.boolean(), true),
  poster: v.fallback(v.boolean(), true),
  /** While watching: a progress bar (time left), time elapsed, or none. */
  time: v.fallback(v.picklist(DISCORD_TIMES), 'progress'),
  /** Nothing is shared while the profile has a content limit. */
  hideOnLimited: v.fallback(v.boolean(), true),
});
export type DiscordOptions = v.InferOutput<typeof OptionsSchema>;

export const parseDiscordOptions = (raw: unknown): DiscordOptions => v.parse(OptionsSchema, raw && typeof raw === 'object' ? raw : {});

let current = parseDiscordOptions(null);

export async function loadDiscordOptions(): Promise<void> {
  current = parseDiscordOptions(await settings.get(DISCORD_OPTIONS_KEY).catch(() => null));
}

export const discordOptions = (): DiscordOptions => current;

export async function setDiscordOptions(change: Partial<DiscordOptions>): Promise<void> {
  current = { ...current, ...change };
  await settings.set(DISCORD_OPTIONS_KEY, current);
}

/**
 * Turns "hide on limited profiles" on or off. Turning it off on a limited
 * profile would share what a child watches, so it needs a parent, as
 * loosening the limit does: Rust checks for one (the active profile, or
 * `guardianPin`) and rejects with `PARENT_PIN_NEEDED` otherwise; nothing is
 * saved then. Turning it on, or changing it on a profile without a limit,
 * asks no one.
 */
export async function setHideOnLimited(on: boolean, guardianPin?: string): Promise<void> {
  if (!on && limited()) await invoke<void>('profile_check_parent', { guardianPin: guardianPin ?? null });
  await setDiscordOptions({ hideOnLimited: on });
}

/**
 * True while nothing at all should reach Discord: watch history is paused
 * (playing should leave no trace anywhere), or a kids profile with that option on.
 */
export const discordSilenced = (): boolean => historyPaused() || (current.hideOnLimited && limited());
