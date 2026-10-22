/**
 * When first-run setup shows, and what Home's "Getting started" card holds.
 * Pure, so the rules can be tested without the app (see rules.test.ts).
 */

/** Setting: true once setup was finished or skipped on this install. */
export const ONBOARDED_KEY = 'onboarding.done';
/** Setting: Home's "Getting started" card; absent until a first-run setup ends. */
export const CHECKLIST_KEY = 'onboarding.checklist';

/**
 * What this install already has. `null` means it couldn't be read, which
 * counts as "has something": a returning user must never be walked through
 * setup because a read failed or ran late.
 */
export interface SetupSignals {
  /** The onboarded flag. */
  done: boolean | null;
  /** Installed addons other than the built-in ones (Cinemeta). */
  ownAddons: number | null;
  profiles: number | null;
  /** Titles in watch history. */
  history: number | null;
  /** Titles saved to the library. */
  library: number | null;
  tmdb: boolean | null;
  stremio: boolean | null;
}

/** A new install: never set up, and nothing in it yet beyond what Orbit comes with. */
export function shouldOnboard(s: SetupSignals): boolean {
  return s.done === false && s.ownAddons === 0 && s.profiles !== null && s.profiles <= 1 && s.history === 0 && s.library === 0 && s.tmdb === false && s.stremio === false;
}

export interface ChecklistState {
  dismissed: boolean;
  /** "Set up profiles" was opened, which counts even if one profile is all they want. */
  profilesSeen: boolean;
}

/** The saved card state, or null when the card was never started (or the value is unreadable). */
export function parseChecklist(value: unknown): ChecklistState | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return { dismissed: v.dismissed === true, profilesSeen: v.profilesSeen === true };
}

export type ChecklistItemId = 'addon' | 'play' | 'profiles';
export interface ChecklistItem {
  id: ChecklistItemId;
  done: boolean;
}

export function checklistItems(state: ChecklistState, facts: { ownAddons: number; history: number; profiles: number }): ChecklistItem[] {
  return [
    { id: 'addon', done: facts.ownAddons > 0 },
    { id: 'play', done: facts.history > 0 },
    { id: 'profiles', done: state.profilesSeen || facts.profiles > 1 },
  ];
}

/**
 * Where "Play something" leads: Movies once an addon that finds streams is in use, and until then to adding
 * one (Orbit comes with none, so Movies would only end at "No stream addons installed").
 */
export const playLeadsTo = (streamAddons: number): 'movies' | 'addons' => (streamAddons > 0 ? 'movies' : 'addons');

/**
 * Home greets a new install with "Welcome to Orbit" rather than the time of day: while the Getting started
 * card (started by first-run setup) is still open and nothing has been watched yet.
 */
export const welcomesNewcomer = (state: ChecklistState | null, history: number): boolean => !!state && !state.dismissed && history === 0;

/** Shown while started, not dismissed and not complete. */
export function checklistVisible(state: ChecklistState | null, items: readonly ChecklistItem[]): boolean {
  return !!state && !state.dismissed && items.some((item) => !item.done);
}

/**
 * Whether setup closes after saving the keys typed but not saved: Finish only once they are
 * (it stays open on one that can't be, with the reason beside it); Skip always, saving what it can.
 */
export async function closesAfterSaving(save: () => Promise<boolean>, skip: boolean): Promise<boolean> {
  if (!skip) return save();
  await save().catch(() => false);
  return true;
}
