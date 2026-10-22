/**
 * The sleep timer (Playback speed panel): pause after some minutes, or stop
 * at the end of this video so nothing plays next.
 */
import { toast } from '../../components/toast';
import { t } from '../../i18n';
import type { SleepChoice } from './panels';

export interface SleepHost {
  paused(): boolean;
  pause(): void;
  /** The choice changed or the timer went off: redraw. */
  changed(): void;
}

export function createSleepTimer(host: SleepHost) {
  let state: { choice: SleepChoice; at?: number } = { choice: 'off' };
  /**
   * "End of this video" went off: the timer reads Off, but nothing plays next until another
   * video starts (the status that follows the end would otherwise bring Next Up back).
   */
  let stoppedAtEnd = false;
  /** Whether playback was paused at the last check. */
  let lastPaused = false;

  return {
    choice: () => state.choice,
    /** When playback ends there's nothing next: the Next Up card stays away. */
    stopsAtEnd: () => state.choice === 'end' || stoppedAtEnd,
    pick(choice: SleepChoice): void {
      stoppedAtEnd = false;
      state = choice === 'off' || choice === 'end' ? { choice } : { choice, at: Date.now() + Number(choice) * 60_000 };
      host.changed();
    },
    note(): string {
      if (state.choice === 'end') return t('player.sleep.end-note');
      if (!state.at) return '';
      const minutes = Math.max(1, Math.ceil((state.at - Date.now()) / 60_000));
      return t('player.sleep.pauses-in', { minutes });
    },
    /** Pauses once the timer is up (checked as playback reports its position). */
    check(): void {
      const paused = host.paused();
      // Paused at the last check: no status comes during a pause, so a timer found up now ran out
      // while paused (checks come several times a second while playing). It's used up, quietly.
      const wasPaused = lastPaused;
      lastPaused = paused;
      if (!state.at || Date.now() < state.at) return;
      if (paused || wasPaused) {
        state = { choice: 'off' };
        host.changed();
        return;
      }
      state = { choice: 'off' };
      host.pause();
      toast(t('player.sleep.paused'));
      host.changed();
    },
    /** Another movie or episode started before this one ended: "end of this video" was for this one. */
    newVideo(): void {
      stoppedAtEnd = false;
      if (state.choice === 'end') state = { choice: 'off' };
    },
    /** The video ended: a timer set for its end is used up. */
    ended(): void {
      if (state.choice !== 'end') return;
      state = { choice: 'off' };
      stoppedAtEnd = true;
      toast(t('player.sleep.stopped'));
    },
  };
}
