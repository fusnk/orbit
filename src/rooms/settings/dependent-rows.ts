/**
 * Rows that only matter after another choice (Settings): the Next Up
 * countdown when autoplay is Never, a trailer's delay when trailers are off…
 * They're hidden (the `hidden` attribute, so keyboard, controller and screen
 * readers skip them too) until their parent row allows them, and show again
 * the moment it does.
 *
 * The rules are plain functions so they can be tested; `showDependents` does
 * the hiding, and remembers each hidden row's parent so the command palette
 * can take someone who searched for a hidden row to the row that reveals it.
 */
import { SETTING_SAVED, settings } from '../../lib/ipc';
import type { AmbientPrefs } from '../ambient/settings';
import type { AutoplayMode } from '../player/next-up';
import type { Spoilers } from '../../library/spoilers';

/** The Next Up card's rows: it shows unless autoplay is Never. */
export const autoplayFollowUpsShown = (mode: AutoplayMode): boolean => mode !== 'never';

/** "Stop autoplay after" and the Next Up countdown: only Always counts down and plays on its own (Ask waits on the card). */
export const countdownRowsShown = (mode: AutoplayMode): boolean => mode === 'always';

/** "When resuming" (which source): starting over isn't resuming. */
export const resumeSourceShown = (resume: unknown): boolean => resume !== 'start-over';

/** Trailer delay and sound: only while trailers play somewhere (title pages or banners). */
export const trailerFollowUpsShown = (hero: boolean, banner: boolean): boolean => hero || banner;

/** Spoilers' "Applies to": only once something is hidden. */
export const spoilerScopeShown = (s: Pick<Spoilers, 'titles' | 'descriptions' | 'thumbnails' | 'ratings' | 'unaired'>): boolean => s.titles || s.descriptions || s.thumbnails || s.ratings || s.unaired;

/** Ambient mode's finer options: only when it starts at all. */
export const ambientFollowUpsShown = (prefs: Pick<AmbientPrefs, 'afterMinutes'>): boolean => prefs.afterMinutes > 0;

const parents = new WeakMap<HTMLElement, HTMLElement>();

/** The row whose choice shows `row`, if it's a dependent row. */
export const dependentParent = (row: HTMLElement): HTMLElement | undefined => parents.get(row);

/**
 * Shows or hides `rows` (which follow `parent`'s choice). If focus was in one
 * that goes, it moves to the parent's control, so it never sits on nothing.
 */
export function showDependents(parent: HTMLElement, rows: readonly HTMLElement[], shown: boolean): void {
  const focused = document.activeElement;
  for (const row of rows) {
    parents.set(row, parent);
    row.hidden = !shown;
  }
  if (shown || !(focused instanceof HTMLElement) || !rows.some((row) => row.contains(focused))) return;
  parent.querySelector<HTMLElement>('[aria-pressed="true"], [role="switch"], button')?.focus({ preventScroll: true });
}

/** Whether `el` is still part of a Settings page (one shown, or kept for later), not one drawn over since. */
export const onSettingsPage = (el: Element): boolean => el.closest('.settings-category') !== null;

/** Listeners on `document` kept by `whileOnPage`, with the control each belongs to. */
interface PageListener {
  owner: Element;
  type: string;
  listener: (event: Event) => void;
  /** Seen on its page once drawn. */
  placed: boolean;
}
const pageListeners = new Set<PageListener>();

/**
 * Listens on `document` for `type` while `owner` is on a Settings page. The listener lets go the next time its
 * event comes after `owner` was drawn over, and also whenever another row starts listening: some events (an
 * update found, the seek bar changed) may not come all session, and until then the row and the page it was drawn
 * on stay in memory, one more each time a Look, theme or accent draws the page again.
 */
export function whileOnPage(owner: Element, type: string, listener: (event: Event) => void): void {
  // Only rows that were on a page: one still being built (its page is put in once drawn) isn't on one yet.
  for (const entry of pageListeners) if (entry.placed && !onSettingsPage(entry.owner)) stop(entry);
  const entry: PageListener = {
    owner,
    type,
    placed: false,
    listener: (event: Event) => (onSettingsPage(owner) ? listener(event) : stop(entry)),
  };
  pageListeners.add(entry);
  document.addEventListener(type, entry.listener);
  // A row is put on its page in the same task that draws it.
  queueMicrotask(() => (entry.placed = onSettingsPage(owner)));
}

function stop(entry: PageListener): void {
  document.removeEventListener(entry.type, entry.listener);
  pageListeners.delete(entry);
}

/**
 * Calls `apply` with `key`'s saved value each time it's saved, from this page
 * or elsewhere (Quick settings writes some of the same settings), so a page
 * that stays built shows what's true. Applying what's already shown is
 * harmless. It stops once `owner` (a control it updates) is no longer on a
 * Settings page: the page was drawn again, with its own.
 */
export function whenSaved(key: string, owner: HTMLElement, apply: (value: unknown) => void): void {
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail !== key) return;
    if (!onSettingsPage(owner)) return document.removeEventListener(SETTING_SAVED, listener);
    void settings
      .get(key)
      .then(apply)
      .catch(() => {});
  };
  document.addEventListener(SETTING_SAVED, listener);
}
