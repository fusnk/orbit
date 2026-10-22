/**
 * Discord Rich Presence for the player (Settings → Integrations, off by
 * default): "Watching <title>" with the episode and time left. Rust passes
 * it to the Discord app on this PC. Discord rate-limits updates, so one is
 * sent only when something visible changes: another title, pause or play,
 * or a jump in time.
 */
import { invoke } from '@tauri-apps/api/core';
import { discordOptions, discordSilenced } from '../../app/discord-options';
import type { Title } from '../../catalog/titles';
import { t } from '../../i18n';
import type { EpisodeRef } from '../detail/title-actions';
import { episodeLine } from './format';

/** Settings → Integrations → Discord: true to share (default false). */
export const DISCORD_KEY = 'integrations.discord';
/** Seconds the predicted end can drift (a seek, a speed change) before Discord is told. */
const DRIFT_S = 15;

export interface Shown {
  /** Which movie or episode. */
  key: string;
  paused: boolean;
  /** Unix seconds when it would end at this speed (0 while paused). */
  end: number;
  /** The Settings → Discord options it was sent with, so changing one updates it. */
  options?: string;
}

/** Whether Discord should hear about `next`, given what it was last told. */
export function presenceChanged(last: Shown | undefined, next: Shown): boolean {
  if (!last || last.key !== next.key || last.paused !== next.paused || last.options !== next.options) return true;
  return !next.paused && Math.abs(last.end - next.end) > DRIFT_S;
}

const pausedText = (what: string) => (what ? t('player.presence.paused', { what }) : t('player.presence.paused-plain'));

export function createPresence() {
  let enabled = false;
  let last: Shown | undefined;

  return {
    configure(on: boolean): void {
      enabled = on;
    },
    /** `tv`: "Live TV" or "Catch-up" for Live TV, shown instead of episode details. */
    update(title: Title, episode: EpisodeRef | undefined, status: { timePos: number | null; duration: number | null; paused: boolean; speed: number | null }, tv?: string): void {
      const { timePos, duration, paused } = status;
      if (!enabled) return;
      const options = discordOptions();
      const optionsKey = JSON.stringify(options);
      // Nothing shared right now (a kids profile, or paused with "while paused" off): clear it once.
      if (discordSilenced() || (paused && !options.whilePaused)) {
        const hidden: Shown = { key: 'hidden', paused, end: 0, options: optionsKey };
        if (!presenceChanged(last, hidden)) return;
        last = hidden;
        void invoke('discord_clear').catch(() => {});
        return;
      }
      const name = options.hideTitle ? t('player.presence.something') : title.name;
      const image = options.hideTitle || !options.poster ? null : (title.poster ?? null);
      if (tv) {
        // A channel has no end: just its name, and whether it's paused.
        const shown: Shown = { key: title.id, paused, end: 0, options: optionsKey };
        if (!presenceChanged(last, shown)) return;
        last = shown;
        const what = options.hideTitle ? '' : tv;
        void invoke('discord_set_activity', { presence: { title: name, state: paused ? pausedText(what) : what, image, start: null, end: null } }).catch(() => {});
        return;
      }
      if (timePos === null || !duration) return;
      const now = Date.now() / 1000;
      const speed = status.speed && status.speed > 0 ? status.speed : 1;
      const next: Shown = { key: `${title.id}/${episode?.episode.id ?? ''}`, paused, end: paused ? 0 : Math.round(now + (duration - timePos) / speed), options: optionsKey };
      if (!presenceChanged(last, next)) return;
      last = next;
      const what = options.hideTitle ? '' : episode ? episodeLine(episode.season, episode.episode.number, episode.episode.title) : (title.year ?? t('player.presence.movie'));
      const start = Math.round(next.end - duration / speed);
      void invoke('discord_set_activity', {
        presence: {
          title: name,
          state: paused ? pausedText(String(what)) : what,
          image,
          // Discord draws the progress bar from both, and counts up from start alone; paused shows none.
          start: paused || options.time === 'off' ? null : start,
          end: paused || options.time !== 'progress' ? null : next.end,
        },
      }).catch(() => {});
    },
    /**
     * A file from this PC or a pasted link: nothing is shared, not even that something plays. Sent once
     * even when this player told Discord nothing yet, or the browsing status it was last told (what
     * app/activity.ts sent for the page the player opened over) would stay up all through the video.
     */
    hide(): void {
      if (!enabled || last?.key === 'hidden') return;
      last = { key: 'hidden', paused: false, end: 0 };
      void invoke('discord_clear').catch(() => {});
    },
    clear(): void {
      if (!last) return;
      last = undefined;
      void invoke('discord_clear').catch(() => {});
    },
  };
}
