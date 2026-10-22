/**
 * Discord Rich Presence while browsing (Settings → Integrations, off by
 * default): "Watching Orbit" with what the person is doing, e.g. "Browsing
 * movies" or "Viewing details · Breaking Bad". The player shows "Watching"
 * itself (see rooms/player/presence.ts). Search text and list names are
 * never shared.
 */
import { t } from '../i18n';
import { invoke } from '@tauri-apps/api/core';
import { settings } from '../lib/ipc';
import { onHistoryPauseChange } from '../library/history-pause';
import { DISCORD_KEY } from '../rooms/player/presence';
import { discordOptions, discordSilenced, loadDiscordOptions } from './discord-options';

/** What each page is, when no view on it says more. */
const ROOMS: Record<string, string> = {
  home: t('browse.activity.home'),
  movies: t('browse.activity.movies'),
  series: t('browse.activity.series'),
  anime: t('browse.activity.anime'),
  live: t('browse.activity.live'),
  search: t('browse.activity.search'),
  library: t('browse.activity.library'),
  settings: t('browse.activity.settings'),
};

/** Since Orbit opened: Discord shows the time elapsed. */
const since = Math.round(Date.now() / 1000);
let enabled = false;
let last = '';
let stopPause: (() => void) | undefined;

/** Marks a pushed view (a title's page, a person's…) with what it shows. */
export function markActivity(view: HTMLElement, what: string, name?: string, image?: string): void {
  view.dataset.activity = what;
  if (name) view.dataset.activityName = name;
  if (image) view.dataset.activityImage = image;
}

export async function loadActivitySetting(): Promise<void> {
  const [on] = await Promise.all([settings.get(DISCORD_KEY).catch(() => null), loadDiscordOptions()]);
  enabled = on === true;
  // Pausing watch history silences Discord (discordSilenced): clear what it shows right away.
  stopPause ??= onHistoryPauseChange(activityOptionsChanged);
}

/** Settings → Integrations toggled it; turning it off clears the profile. */
export function setActivityEnabled(on: boolean): void {
  enabled = on;
  last = '';
  if (!on) void invoke('discord_clear').catch(() => {});
}

/** An option changed in Settings: the next view is sent again, or cleared if browsing isn't shared now. */
export function activityOptionsChanged(): void {
  last = '';
  if (enabled && (discordSilenced() || !discordOptions().whileBrowsing)) void invoke('discord_clear').catch(() => {});
}

/** Tells Discord about the view the router now shows (skipping the player, which reports itself). */
export function showActivity(room: string, view: HTMLElement): void {
  if (!enabled) return;
  // The player reports itself; whatever shows after it is new to Discord.
  if (view.classList.contains('player')) {
    last = '';
    return;
  }
  const options = discordOptions();
  if (discordSilenced() || !options.whileBrowsing) {
    if (last !== 'cleared') void invoke('discord_clear').catch(() => {});
    last = 'cleared';
    return;
  }
  // Hiding titles keeps only the kind of page ("Browsing movies"), never a title's name or poster.
  const named = !options.hideTitle;
  const title = (named ? view.dataset.activity : undefined) ?? ROOMS[room] ?? t('browse.activity.browsing');
  const state = named ? (view.dataset.activityName ?? '') : '';
  const image = named && options.poster ? (view.dataset.activityImage ?? null) : null;
  const key = `${title}|${state}|${image ?? ''}`;
  if (key === last) return;
  last = key;
  void invoke('discord_set_activity', {
    presence: { browsing: true, title, state, image, start: options.time === 'off' ? null : since, end: null },
  }).catch(() => {});
}
