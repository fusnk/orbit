/**
 * The line under the Settings categories: "Changes save automatically" until
 * something is saved, then a brief "Saved" with a check, then back.
 *
 * It listens for every saved setting (SETTING_SAVED, from lib/ipc) but only
 * speaks for the person's own changes: a save counts when it follows their
 * input closely, so background writes (watch progress, a sync) stay quiet.
 */
import { icon } from '../../components/icons';
import { t } from '../../i18n';
import { h } from '../../lib/dom';
import { SETTING_SAVED } from '../../lib/ipc';

/** How long "Saved" stays after the last save of a burst. */
export const SAVED_HOLD_MS = 1600;
/** A save this soon after a click, key or change is taken to be the person's. */
export const ACTION_WINDOW_MS = 5000;

/**
 * Turns a run of saves into one "Saved": `show` at the first, `hide` once
 * none has come for `holdMs`. A slider dragged or chips toggled quickly is
 * one moment, shown (and announced) once.
 */
export function createSavedPulse(show: () => void, hide: () => void, holdMs = SAVED_HOLD_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    saved(): void {
      if (timer === undefined) show();
      else clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        hide();
      }, holdMs);
    },
    get showing(): boolean {
      return timer !== undefined;
    },
  };
}

/** Whether a save at `at` follows the person's last action (at `lastAction`) closely enough to be theirs. */
export function followsAction(at: number, lastAction: number | null, windowMs = ACTION_WINDOW_MS): boolean {
  return lastAction !== null && at >= lastAction && at - lastAction <= windowMs;
}

/**
 * The indicator, for the sidebar of `room`. `ignore` lists keys saved as a
 * side effect of using Orbit rather than as a setting (e.g. the palette's recent picks),
 * with their per-profile copies (`<key>.<profile id>`).
 */
export function createSaveIndicator(room: HTMLElement, ignore: readonly string[] = []): HTMLElement {
  const idle = h('span', { class: 'settings-save-idle' }, t('settings.nav.footnote'));
  const done = h('span', { class: 'settings-save-done', 'aria-hidden': 'true' }, icon('check'), t('settingshome.saved'));
  // Announced separately, and only when "Saved" appears: the footnote coming back isn't news.
  const announce = h('span', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const element = h('div', { class: 'settings-save', 'data-state': 'idle' }, idle, done, announce);

  const pulse = createSavedPulse(
    () => {
      element.dataset.state = 'saved';
      announce.textContent = t('settingshome.saved-announce');
    },
    () => {
      element.dataset.state = 'idle';
      announce.textContent = '';
    },
  );

  let lastAction: number | null = null;
  const acted = () => {
    if (room.isConnected) lastAction = performance.now();
  };
  // On the document, so a choice made in a menu the page opened counts too.
  for (const type of ['pointerdown', 'keydown', 'change']) document.addEventListener(type, acted, true);
  document.addEventListener(SETTING_SAVED, (event) => {
    const key = (event as CustomEvent<string>).detail;
    if (!room.isConnected || ignore.some((ignored) => key === ignored || key.startsWith(`${ignored}.`)) || !followsAction(performance.now(), lastAction)) return;
    pulse.saved();
  });
  return element;
}
